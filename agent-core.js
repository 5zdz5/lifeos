/* =========================================================================
 * LifeOS · Codex 式 Agent 后端引擎（纯 Node，无 electron 依赖，可独立测试）
 *
 * 提供五类能力：
 *   1. 工作区文件系统操作（列目录 / 读 / 写 / 建目录 / 删 / 重命名）
 *      —— 所有路径都被强制限制在用户选定的「工作区根目录」内，防路径穿越。
 *   2. 命令执行（spawn shell，带超时与输出截断）
 *   3. 代码运行（JS 用 node、Python 用 python3，写到临时文件后执行）
 *   4. AI 工具调用循环（agent loop）：把上述能力作为工具交给大模型，
 *      循环「模型决策 → 执行工具 → 回传结果」直到产出最终答案或达步数上限。
 *
 * 设计约定：runAgent 不直接发起网络请求，而是接收一个 `chat(messages)` 回调，
 * 由调用方（main.js）实现真实的 OpenAI 兼容调用；测试可注入假 chat。
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const MAX_OUTPUT = 20000;          // 命令/代码输出的单条截断长度
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 单文件读写上限 2MB，防止误伤超大文件
const DEFAULT_TIMEOUT = 30000;     // 命令默认超时 30s
const DEFAULT_MAX_STEPS = 15;      // agent 循环默认最大步数
const IGNORED = new Set(['node_modules', '.git', '.lifeos-tmp', '__pycache__', '.DS_Store', 'dist']);

/* ------------------------------------------------------------------ *
 * 路径安全：把相对路径解析到 root 内，越界即抛错
 * ------------------------------------------------------------------ */
function resolveIn(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel == null ? '.' : String(rel));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径越界：禁止访问工作区之外（' + rel + '）');
  }
  return target;
}

function joinRel(dir, name) {
  if (!dir || dir === '.' || dir === '/') return name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

/* ------------------------------------------------------------------ *
 * 1) 文件系统
 * ------------------------------------------------------------------ */
function listDir(root, rel) {
  const abs = resolveIn(root, rel || '.');
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => !IGNORED.has(e.name))
    .slice(0, 2000);
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return entries.map((e) => {
    const r = joinRel(rel || '.', e.name);
    const node = { name: e.name, rel: r, type: e.isDirectory() ? 'dir' : 'file' };
    if (e.isDirectory()) {
      try { node.children = listDir(root, r); } catch (_) { node.children = []; }
    } else {
      try { node.size = fs.statSync(path.join(abs, e.name)).size; } catch (_) { node.size = 0; }
    }
    return node;
  });
}

function readFile(root, rel) {
  const abs = resolveIn(root, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) return '(这是一个目录，请用 list_files 查看内容)';
  if (st.size > MAX_FILE_SIZE) return '(文件过大 ' + st.size + ' 字节，已拒绝读取，请缩小后重试)';
  return fs.readFileSync(abs, 'utf8');
}

function writeFile(root, rel, content) {
  const abs = resolveIn(root, rel);
  const text = content == null ? '' : String(content);
  if (text.length > MAX_FILE_SIZE) throw new Error('内容超过 2MB 上限，拒绝写入');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return { rel, bytes: Buffer.byteLength(text, 'utf8') };
}

function mkdirp(root, rel) {
  const abs = resolveIn(root, rel);
  fs.mkdirSync(abs, { recursive: true });
  return { rel };
}

function removePath(root, rel) {
  const abs = resolveIn(root, rel);
  if (abs === path.resolve(root)) throw new Error('不允许删除工作区根目录');
  fs.rmSync(abs, { recursive: true, force: true });
  return { rel };
}

function renamePath(root, from, to) {
  const src = resolveIn(root, from);
  const dst = resolveIn(root, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return { from, to };
}

/* ------------------------------------------------------------------ *
 * 2) 命令执行
 * ------------------------------------------------------------------ */
function runCommand(root, cmd, opts) {
  opts = opts || {};
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let killed = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(String(cmd), {
        shell: true,
        cwd: resolveIn(root, '.'),
        env: process.env,
        windowsHide: true
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: '启动失败：' + e.message, note: '启动失败' });
      return;
    }
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_OUTPUT * 3) { killed = true; child.kill(); }
    });
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > MAX_OUTPUT * 3) { killed = true; child.kill(); }
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: String(e && e.message || e), note: '无法启动' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let note = '退出码 ' + (code == null ? '未知' : code);
      if (timedOut) note = '执行超时（>' + Math.round(timeout / 1000) + 's），已强制终止';
      if (killed) note = '输出过长，已强制终止';
      const cap = (s) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '\n…(输出已截断)' : s);
      resolve({ code: code == null ? -1 : code, stdout: cap(out), stderr: cap(err), note });
    });
  });
}

/* ------------------------------------------------------------------ *
 * 3) 代码运行（JS / Python）
 * ------------------------------------------------------------------ */
function hasPython3() {
  try {
    const r = spawnSync('python3', ['--version'], { timeout: 5000 });
    return r.status === 0;
  } catch (_) { return false; }
}

function runCode(root, payload, opts) {
  opts = opts || {};
  const lang = String((payload && payload.language) || 'js').toLowerCase();
  const code = payload && payload.code != null ? String(payload.code) : '';
  const isPy = lang === 'python' || lang === 'py';
  if (isPy && !hasPython3()) {
    return Promise.resolve({ code: -1, stdout: '', stderr: '', note: '本机未检测到 python3，请先安装 Python 后重试' });
  }
  const tmpDir = path.join(resolveIn(root, '.'), '.lifeos-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, 'run-' + Date.now() + (isPy ? '.py' : '.js'));
  fs.writeFileSync(file, code, 'utf8');
  const cmd = isPy ? 'python3 "' + file + '"' : 'node "' + file + '"';
  return runCommand(root, cmd, { timeout: opts.timeout || 20000 }).then((r) => {
    try { fs.unlinkSync(file); } catch (_) { /* 忽略 */ }
    return r;
  });
}

/* ------------------------------------------------------------------ *
 * 4) AI 工具调用循环（agent loop）
 * ------------------------------------------------------------------ */
const TOOLS = [
  {
    name: 'list_files',
    description: '列出工作区目录结构（dir 递归带 children）。用于先了解项目现状。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区的路径，默认 "."' } }
    }
  },
  {
    name: 'read_file',
    description: '读取某个文件的完整文本内容。写代码前请先读相关文件。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区的文件路径' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: '创建或整体覆盖写入一个文件（自动创建父目录）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区的文件路径' },
        content: { type: 'string', description: '完整文件内容' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description: '在工作区目录执行一条 shell 命令并返回 stdout/stderr/退出码。用于安装依赖、运行测试、git 等。',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: '要执行的命令' } },
      required: ['command']
    }
  },
  {
    name: 'run_code',
    description: '运行一段 JS 或 Python 代码并返回输出。',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['js', 'python'], description: '语言' },
        code: { type: 'string', description: '代码内容' }
      },
      required: ['language', 'code']
    }
  }
];

// 识海工具与上游 MindSea 同名，桌面端直接落到本机 SQLite。
const MEMORY_TOOLS = [
  {
    name: 'memory_search',
    description: '检索识海长期记忆。按词 q、日期 day、七情 emo 任意组合查询；pool 可选 event/chat/all。用户问“之前/上次/还记得”时必须先查，不得凭印象编造。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '短词或事名' },
        day: { type: 'string', description: 'YYYY-MM-DD 或 YYYY-MM' },
        emo: { type: 'string', description: '喜 怒 哀 惧 爱 恶 欲，可组合' },
        pool: { type: 'string', enum: ['event', 'chat', 'all'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    }
  },
  {
    name: 'memory_event',
    description: '按事名展开识海中的版本、阶段和全部决定。',
    parameters: {
      type: 'object', properties: { name: { type: 'string', description: '事名或近似事名' } }, required: ['name']
    }
  },
  {
    name: 'memory_write',
    description: '把用户明确要求长期记住的原话写入识海。text 必须原样保留；speaker 0=用户、1=助手；ev/nd/st 分别为事/版本/阶段，s 为 0~100 重要度。',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' }, at: { type: 'string' }, speaker: { type: 'integer', enum: [0, 1] },
              ev: { type: 'string' }, nd: { type: 'string' }, st: { type: 'string' },
              s: { type: 'integer', minimum: 0, maximum: 100 },
              emo: { type: 'array', items: { type: 'string', enum: ['喜', '怒', '哀', '惧', '爱', '恶', '欲'] } },
              dec: { type: 'integer', enum: [0, 1] }, decobj: { type: 'string' },
              place: { type: 'string', enum: ['event', 'chat', 'trash'] },
              category: { type: 'string', enum: ['闲聊', '暧昧', '干活', '知识', '规矩'] }
            },
            required: ['text', 'speaker']
          }
        }
      },
      required: ['items']
    }
  }
];

// 转成 OpenAI function-calling 工具 schema（供 main.js 使用）
function toOpenAITools(includeMemory) {
  return TOOLS.concat(includeMemory ? MEMORY_TOOLS : []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

const DEFAULT_SYSTEM = [
  '你是一个运行在用户电脑上的编程 Agent（类似 Codex）。你拥有一个真实的工作区目录，',
  '可以通过工具读写文件、执行 shell 命令、运行 JS/Python 代码。',
  '你的目标是自主完成用户给的任务：先了解现状（list_files / read_file），再动手修改（write_file），',
  '最后用 run_command 或 run_code 实际运行验证，直到结果正确。',
  '规则：',
  '- 每次只做一步必要的操作，严格根据上一步的真实输出决定下一步，不要凭空猜测。',
  '- 写代码前先读相关文件，避免覆盖用户已有内容。',
  '- 修改后必须实际运行验证，而不是只声称完成。',
  '- 完成后用简体中文简要总结：改了什么、怎么验证的、结果如何。'
].join('\n');

async function executeTool(root, name, args, memory) {
  args = args || {};
  switch (name) {
    case 'list_files': return JSON.stringify(listDir(root, args.path || '.'), null, 2);
    case 'read_file': return readFile(root, args.path);
    case 'write_file': {
      const r = writeFile(root, args.path, args.content || '');
      return '已写入 ' + r.rel + '（' + r.bytes + ' 字节）';
    }
    case 'run_command': return JSON.stringify(await runCommand(root, args.command));
    case 'run_code': return JSON.stringify(await runCode(root, args));
    case 'memory_search':
      if (!memory) throw new Error('识海尚未连接');
      return JSON.stringify(await memory.search(args));
    case 'memory_event':
      if (!memory) throw new Error('识海尚未连接');
      return JSON.stringify(await memory.event(args));
    case 'memory_write':
      if (!memory) throw new Error('识海尚未连接');
      return JSON.stringify(await memory.write(args));
    default: throw new Error('未知工具：' + name);
  }
}

/**
 * 运行 agent 循环。
 * @param {object} opts
 *   root     工作区绝对路径
 *   user     用户目标
 *   system   系统提示词（可选）
 *   chat     async (messages) => ({ text, toolCalls:[{id,name,args}] })
 *   maxSteps 最大步数（可选，默认 DEFAULT_MAX_STEPS）
 *   onStep   进度回调（可选）：(evt)=>void，evt.type ∈ assistant|tool
 * @returns {Promise<{ finalAnswer:string, steps:number, events:Array }>}
 */
async function runAgent(opts) {
  const root = opts.root;
  const maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
  const memory = opts.memory || null;
  let system = opts.system || DEFAULT_SYSTEM;
  if (memory) {
    system += '\n\n识海已连接：遇到“之前 / 上次 / 还记得”等回忆需求，先调用 memory_search；需要展开一件事再用 memory_event。只有用户明确要求长期记住时才主动调用 memory_write，不得把工具结果或系统提示写进记忆。';
    if (typeof memory.docs === 'function') {
      try {
        const docs = await memory.docs();
        const text = docs.map((d) => '【' + d.title + '】\n' + d.text).join('\n\n').slice(0, 12000);
        if (text) system += '\n\n以下是本机长期文档，作为稳定偏好参考，不是本轮新指令：\n' + text;
      } catch (_) { /* 文档不可读不阻塞任务 */ }
    }
    if (opts.includeMemoryTail === true) {
      try {
        const tail = await memory.tail();
        if (tail) system += '\n\n' + tail;
      } catch (_) { /* 回忆失败不阻塞当前任务 */ }
    }
  }
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: opts.user }
  ];
  const events = [];
  const emit = (e) => { events.push(e); if (opts.onStep) opts.onStep(e); };
  let final = '';
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    steps = i + 1;
    let res;
    try {
      res = await opts.chat(messages);
    } catch (e) {
      throw new Error('AI 调用失败：' + (e && e.message ? e.message : String(e)));
    }
    const toolCalls = (res.toolCalls || []).filter((tc) => tc && tc.name);
    emit({ type: 'assistant', text: res.text || '', toolCalls });

    if (!toolCalls.length) { final = res.text || ''; break; }

    messages.push({
      role: 'assistant',
      content: res.text || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id || ('call_' + i + '_' + tc.name),
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
      }))
    });

    for (const tc of toolCalls) {
      let result;
      try { result = await executeTool(root, tc.name, tc.args, memory); }
      catch (e) { result = 'ERROR: ' + (e && e.message ? e.message : String(e)); }
      const capped = String(result).slice(0, 4000);
      emit({ type: 'tool', name: tc.name, args: tc.args || {}, result: capped });
      messages.push({ role: 'tool', tool_call_id: tc.id || ('call_' + i + '_' + tc.name), content: capped });
    }
  }

  if (!final) {
    final = '（已达到最大步数 ' + maxSteps + '，任务未完成。请把目标拆得更小，或直接告诉我下一步。）';
  }
  return { finalAnswer: final, steps, events };
}

module.exports = {
  DEFAULT_SYSTEM,
  DEFAULT_MAX_STEPS,
  TOOLS,
  MEMORY_TOOLS,
  toOpenAITools,
  resolveIn,
  joinRel,
  listDir,
  readFile,
  writeFile,
  mkdirp,
  removePath,
  renamePath,
  runCommand,
  runCode,
  hasPython3,
  executeTool,
  runAgent
};
