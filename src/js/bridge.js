/* =========================================================================
 * LifeOS · 运行环境桥接层
 * - Electron：通过 window.electronAPI 与 Node 主进程通信（数据落盘 + AI + Agent）
 * - 浏览器：localStorage 持久化 + fetch 调 AI；Agent 用「虚拟文件系统 + 隔离 JS 运行环境」
 *   提供可演示的等价能力（真实文件/命令执行仅在 Electron 桌面版可用）
 * 上层 UI 只依赖 LifeOS.bridge，无需关心运行环境。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  function getDefaultState() {
    return {
      tasks: [],
      habits: [],
      notes: [],
      library: [],          // 知识库条目（全部存于本机）
      events: [],           // 日历日程（用户手动添加，随备份一起导出）
      aiThread: [],
      settings: {
        aiBaseUrl: 'https://api.openai.com/v1',
        aiKey: '',
        aiKeySessionOnly: false,  // 网页版：仅本次会话保存密钥，不写入长期存储
        aiModel: 'gpt-4o-mini',
        userName: '',
        theme: 'auto',
        mindseaAuto: true,
        mindseaAI: false
      }
    };
  }

  function hasElectron() {
    return typeof window !== 'undefined' && !!window.electronAPI;
  }

  /* ---------------- 会话密钥：不写入长期存储 ----------------
   * 勾选「仅本次会话保存」后，明文 Key 只放 sessionStorage（关闭标签页即失效），
   * localStorage 里对应字段始终为空。运行时 state 仍是唯一真值，因此上层所有
   * 读取点（都读 settings.aiKey）无需改动，只需在 save/load 两端做转换。 */
  const SESSION_KEY = 'lifeos-session-key';
  function readSessionKey() {
    try { return (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) || ''; }
    catch (_) { return ''; }
  }
  function writeSessionKey(v) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (v) sessionStorage.setItem(SESSION_KEY, v);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) { /* 隐私模式等场景不可写时静默降级 */ }
  }

  /* ---------------- 浏览器模式：AI mock ---------------- */
  function mockReply(messages) {
    // 取最后一条「用户」消息，而不是数组最后一条（末尾可能是流式占位 assistant）
    const lastUser = messages.slice().reverse().find((m) => m && m.role === 'user');
    const userMsg = lastUser ? String(lastUser.content || '') : '';
    const sys = messages.find((m) => m.role === 'system');
    const hasContext = sys && sys.content.indexOf('【我的任务】') >= 0;

    let body = '';
    if (/计划|规划|安排|今天/.test(userMsg) && hasContext) {
      const lines = sys.content.split('\n').filter((l) => /^-\s/.test(l));
      body = '根据你的任务与习惯，建议今天的安排如下：\n\n';
      lines.slice(0, 6).forEach((l, i) => { body += (i + 1) + '. ' + l.replace(/^-\s/, '') + '\n'; });
      if (lines.length === 0) body += '目前没有待办任务，可以享受一个轻松的休息日。\n';
      body += '\n提示：在「设置」中填入真实 API Key 后，我会结合你的上下文给出更个性化的建议。';
    } else {
      body = '【演示模式】当前未配置 API Key，这是本地生成的示例回复。\n\n' +
        '你刚才说：“' + userMsg.slice(0, 80) + '”。\n' +
        '在「设置」中填入 OpenAI 兼容接口的 API Key（以及自定义 Base URL / 模型），这里就会返回真实的大模型回复。';
    }
    return body;
  }

  async function streamMock(text, cb) {
    for (let i = 0; i < text.length; i++) {
      cb({ type: 'chunk', data: text[i] });
      await new Promise((r) => setTimeout(r, 6));
    }
    cb({ type: 'done', data: text });
  }

  async function browserAI(payload, cb) {
    const { messages, settings } = payload;
    if (!settings || !settings.aiKey) {
      await streamMock(mockReply(messages), cb);
      return;
    }
    const base = (settings.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    try {
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.aiKey },
        body: JSON.stringify({ model: settings.aiModel || 'gpt-4o-mini', messages, stream: true, temperature: 0.7 })
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        cb({ type: 'error', data: 'AI 接口错误 ' + resp.status + ' ' + t.slice(0, 200) });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (d) { full += d; cb({ type: 'chunk', data: d }); }
          } catch (e) { /* 忽略分片 */ }
        }
      }
      cb({ type: 'done', data: full });
    } catch (err) {
      cb({ type: 'error', data: '调用失败：' + (err && err.message ? err.message : String(err)) });
    }
  }

  /* ---------------- 浏览器模式：虚拟文件系统（Agent 演示用） ---------------- */
  const VFS_KEY = 'lifeos-vfs';

  function defaultVFS() {
    return {
      files: {
        'README.md': '# LifeOS 工作区\n\n这是一个「浏览器演示工作区」。\n\n- 点左侧文件树打开文件\n- 编辑后点「保存」\n- 点「运行」执行当前 JS 文件\n\n> 真实读写本机文件、执行命令与 Python，请使用 Electron 桌面版。\n',
        'hello.js': 'function greet(name) {\n  return "你好，" + name + "！";\n}\n\nconsole.log(greet("世界"));\nconsole.log("2 + 3 =", 2 + 3);\n',
        'src/utils.js': '// 示例：求和工具\nexport function sum(arr) {\n  return arr.reduce((a, b) => a + b, 0);\n}\n'
      }
    };
  }

  function vfsLoad() {
    try {
      const raw = DB.getItem(VFS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* 损坏则重置 */ }
    const d = defaultVFS();
    DB.setItem(VFS_KEY, JSON.stringify(d));
    return d;
  }

  function vfsSave(vfs) { DB.setItem(VFS_KEY, JSON.stringify(vfs)); }

  function sortTree(nodes) {
    nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : (a.type === 'dir' ? -1 : 1));
    nodes.forEach((n) => { if (n.children) sortTree(n.children); });
    return nodes;
  }

  function vfsList(files) {
    const tree = [];
    const dirMap = {};
    Object.keys(files).sort().forEach((p) => {
      const parts = p.split('/');
      let cur = tree;
      let curRel = '';
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        const rel = curRel ? curRel + '/' + seg : seg;
        curRel = rel;
        if (i === parts.length - 1) {
          cur.push({ name: seg, rel, type: 'file' });
        } else {
          let dir = dirMap[rel];
          if (!dir) {
            dir = { name: seg, rel, type: 'dir', children: [] };
            dirMap[rel] = dir;
            cur.push(dir);
          }
          cur = dir.children;
        }
      }
    });
    return sortTree(tree);
  }

  function vfsRemove(files, rel) {
    const isDir = Object.keys(files).some((p) => p.startsWith(rel + '/'));
    if (isDir) {
      Object.keys(files).forEach((p) => { if (p === rel || p.startsWith(rel + '/')) delete files[p]; });
    } else {
      delete files[rel];
    }
    return files;
  }

  function vfsRename(files, from, to) {
    const out = {};
    Object.keys(files).forEach((p) => {
      let np = p;
      if (p === from) np = to;
      else if (p.startsWith(from + '/')) np = to + p.slice(from.length);
      out[np] = files[p];
    });
    return out;
  }

  /* 浏览器演示用 JS 执行：放进 sandbox iframe + 独立 Worker。
   * iframe 不给 allow-same-origin → opaque origin，脚本读不到父页 DOM / localStorage /
   * Cookie；Worker 在独立线程，可被 terminate 中断死循环。绝不在本页用 new Function
   * 执行用户代码——那能直接拿到本页的 API Key 并联网外传。 */
  function runJSSandbox(code) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined' || typeof Worker === 'undefined' || typeof Blob === 'undefined') {
        resolve({ code: -1, stdout: '', stderr: '', note: '当前环境不支持隔离执行' });
        return;
      }
      const token = 'lifeos-run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.display = 'none';
      let settled = false;
      let timer = null;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve(r);
      };
      const onMessage = (e) => {
        const d = e.data;
        if (!d || d.token !== token) return;   // token 随机且只存在于 srcdoc 内，不可伪造
        const logs = Array.isArray(d.logs) ? d.logs.map((x) => String(x)).join('\n') : '';
        if (d.timeout) finish({ code: -1, stdout: logs, stderr: '执行超时（超过 3 秒）', note: '已终止隔离运行' });
        else if (d.ok) finish({ code: 0, stdout: logs || '(无输出)', stderr: '', note: '在隔离线程中执行完成，未接触本机数据' });
        else finish({ code: -1, stdout: logs, stderr: String(d.err || '执行出错'), note: '执行出错' });
      };
      window.addEventListener('message', onMessage);

      const workerSrc = [
        "self.onmessage = function (ev) {",
        "  var logs = [];",
        "  function fmt(v) {",
        "    if (typeof v === 'string') return v;",
        "    try { return JSON.stringify(v); } catch (e) { return String(v); }",
        "  }",
        "  var c = {",
        "    log: function () { logs.push(Array.prototype.slice.call(arguments).map(fmt).join(' ')); },",
        "    warn: function () { logs.push('WARN ' + Array.prototype.slice.call(arguments).map(fmt).join(' ')); },",
        "    error: function () { logs.push('ERROR ' + Array.prototype.slice.call(arguments).map(fmt).join(' ')); }",
        "  };",
        "  try {",
        "    (new Function('console', ev.data.code))(c);",
        "    self.postMessage({ ok: true, logs: logs });",
        "  } catch (e) {",
        "    self.postMessage({ ok: false, logs: logs, err: String(e && e.message || e) });",
        "  }",
        "};"
      ].join('\n');

      const scriptBody = [
        "(function(){",
        "  var TOKEN=" + JSON.stringify(token) + ";",
        "  var CODE=" + JSON.stringify(String(code == null ? '' : code)).replace(/</g, '\\u003c') + ";",
        "  var SRC=" + JSON.stringify(workerSrc) + ";",
        "  var w;",
        "  try{ w=new Worker(URL.createObjectURL(new Blob([SRC],{type:'text/javascript'}))); }",
        "  catch(e){ parent.postMessage({token:TOKEN,ok:false,err:'无法创建隔离线程: '+e.message},'*'); return; }",
        "  var done=false;",
        "  function reply(d){ if(done)return; done=true; try{w.terminate()}catch(e){} d.token=TOKEN; parent.postMessage(d,'*'); }",
        "  w.onmessage=function(e){ reply(e.data||{}); };",
        "  w.onerror=function(e){ reply({ok:false,err:String(e.message||'运行出错')}); };",
        "  w.postMessage({code:CODE});",
        "  setTimeout(function(){ reply({ok:false,timeout:true,logs:[]}); },3000);",
        "})();"
      ].join('\n');

      iframe.srcdoc = '<!doctype html><meta charset="utf-8"><script>' + scriptBody + '<' + '/script>';
      document.body.appendChild(iframe);
      timer = setTimeout(() => finish({ code: -1, stdout: '', stderr: '', note: '隔离执行无响应，已终止' }), 5000);
    });
  }

  function mockRunCommand(cmd) {
    const c = String(cmd || '').trim();
    if (!c) return { code: 0, stdout: '', stderr: '', note: '空命令' };
    const vfs = vfsLoad();
    const files = Object.keys(vfs.files).sort();
    const parts = c.split(/\s+/);
    const head = parts[0];
    if (head === 'pwd') return { code: 0, stdout: '/demo-workspace', stderr: '', note: '退出码 0' };
    if (head === 'ls' || head === 'dir') {
      return { code: 0, stdout: files.join('\n') || '(空目录)', stderr: '', note: '退出码 0' };
    }
    if (head === 'echo') {
      return { code: 0, stdout: parts.slice(1).join(' '), stderr: '', note: '退出码 0' };
    }
    if (head === 'cat') {
      const p = parts[1];
      const content = p && vfs.files[p];
      return content != null
        ? { code: 0, stdout: content, stderr: '', note: '退出码 0' }
        : { code: 1, stdout: '', stderr: 'cat: ' + (p || '') + ': 文件不存在', note: '退出码 1' };
    }
    return {
      code: -1, stdout: '', stderr: '',
      note: '浏览器演示模式不支持执行「' + head + '」。可用命令：pwd / ls / echo / cat。真实命令执行请使用 Electron 桌面版。'
    };
  }

  function mockAgent(payload, cb) {
    return (async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const user = payload.user || '';
      const vfs = vfsLoad();
      const listing = vfsList(vfs.files);
      const emit = (e) => cb({ type: 'event', data: e });

      if (/之前|上次|还记得|识海|记忆/.test(user) && L.mindsea) {
        try {
          const query = user.replace(/.*(?:识海|记忆)/, '').replace(/[？?，。：:]/g, ' ').trim();
          const words = query.split(/\s+/).filter((x) => x.length >= 2 && !/^(我们|之前|上次|哪些|什么|做过|重要|决定|查一下|先检索再回答)$/.test(x));
          const q = words[0] || '决定';
          emit({ type: 'assistant', text: '先检索本机识海，不凭印象回答。', toolCalls: [{ id: 'memory-local', name: 'memory_search', args: { q, pool: 'all' } }] });
          const found = await L.mindsea.search({ q, pool: 'all', limit: 10 });
          emit({ type: 'tool', name: 'memory_search', args: { q, pool: 'all' }, result: JSON.stringify(found, null, 2) });
          const lines = (found.words || []).map((m) => '- ' + m.at + '：' + m.text).concat((found.events || []).map((ev) => '- ' + ev.name + '：' + ev.hits + ' 条原话，' + ev.decisions + ' 条决定'));
          cb({ type: 'done', data: { finalAnswer: lines.length ? '本机识海检索到：\n\n' + lines.join('\n') : '本机识海没有命中「' + q + '」。没有相关记录时我不会编造回忆。', steps: 2 } });
        } catch (e) { cb({ type: 'error', data: '识海检索失败：' + (e.message || e) }); }
        return;
      }

      if (payload.mode === 'chat') {
        emit({ type: 'assistant', text: '', toolCalls: [] });
        cb({
          type: 'done',
          data: {
            finalAnswer: '【演示模式】关于「' + user.slice(0, 60) + '」——当前未配置 API Key，这是本地示例回复，不会改动任何文件。\n\n在「设置」中填入 OpenAI 兼容接口的 Key 后可获得真实模型的文字解答；真实读写本机文件与执行命令需运行 Electron 桌面版（网页版永远不接触本机磁盘）。',
            steps: 1
          }
        });
        return;
      }

      // 固定演示回放：明确告知用户这四步是预置流程，不会按指令产出对应文件
      emit({ type: 'assistant', text: '【演示回放】接下来是预置的 4 步流程，用于展示 Agent 的执行形态；它不会按你的指令生成对应文件。', toolCalls: [{ id: '1', name: 'list_files', args: { path: '.' } }] });
      await delay(220);
      emit({ type: 'tool', name: 'list_files', args: { path: '.' }, result: JSON.stringify(listing, null, 2) });

      emit({ type: 'assistant', text: '读一下 README 了解这个项目。', toolCalls: [{ id: '2', name: 'read_file', args: { path: 'README.md' } }] });
      await delay(220);
      emit({ type: 'tool', name: 'read_file', args: { path: 'README.md' }, result: vfs.files['README.md'] || '' });

      const summary = '# 任务摘要（演示产物）\n\n目标：' + user + '\n\n> 由浏览器固定演示流程生成，并非按上述目标完成的结果。\n> 网页版只写虚拟工作区，不接触本机磁盘；真实读写文件与执行命令需运行 Electron 桌面版。\n';
      emit({ type: 'assistant', text: '生成一份摘要文件。', toolCalls: [{ id: '3', name: 'write_file', args: { path: 'AGENT-SUMMARY.md', content: summary } }] });
      await delay(220);
      vfs.files['AGENT-SUMMARY.md'] = summary;
      vfsSave(vfs);
      emit({ type: 'tool', name: 'write_file', args: { path: 'AGENT-SUMMARY.md', content: summary }, result: '已写入 AGENT-SUMMARY.md（' + summary.length + ' 字符）' });

      emit({ type: 'assistant', text: '', toolCalls: [] });
      cb({
        type: 'done',
        data: {
          finalAnswer: '【演示回放结束】上面 4 步是固定流程，写入的 AGENT-SUMMARY.md 只是演示产物，并没有按你的要求创建对应文件。\n\n网页版使用虚拟工作区，不接触本机磁盘、不执行命令与 Python；配置 API Key 只能让文字回复来自真实模型。需要真实干活请运行 Electron 桌面版。',
          steps: 4
        }
      });
    })();
  }

  /* ---------------- 识海：桌面 SQLite / 浏览器本地库 ---------------- */
  const mindsea = {};
  ['search', 'event', 'write', 'update', 'tail', 'capture', 'overview', 'docs', 'writeDoc', 'wanderNow', 'recordWander', 'exportData', 'importData'].forEach((action) => {
    mindsea[action] = async (payload) => {
      if (bridge.mode === 'electron') return await window.electronAPI.mindseaCall(action, payload || {});
      if (!L.mindsea || typeof L.mindsea[action] !== 'function') throw new Error('识海浏览器适配层未加载');
      return await L.mindsea[action](payload || {});
    };
  });

  /* ---------------- 桥接对象 ---------------- */
  const bridge = {
    mode: hasElectron() ? 'electron' : 'browser',
    getDefaultState,

    async load() {
      if (this.mode === 'electron') {
        const s = await window.electronAPI.getState();
        return s || getDefaultState();
      }
      const raw = DB.getItem('lifeos-data');
      let state = getDefaultState();
      if (raw) { try { state = JSON.parse(raw); } catch (e) { /* 损坏则重置 */ } }
      // 会话密钥只在内存里补回，长期存储里始终为空
      const sk = readSessionKey();
      if (sk && state && state.settings) state.settings.aiKey = sk;
      return state;
    },

    async save(state) {
      if (this.mode === 'electron') {
        return await window.electronAPI.saveState(state);
      }
      const out = Object.assign({}, state);
      if (out.settings) {
        out.settings = Object.assign({}, out.settings);
        if (out.settings.aiKeySessionOnly === true) {
          writeSessionKey(out.settings.aiKey || '');
          out.settings.aiKey = '';   // 长期存储里不留明文
        } else {
          writeSessionKey('');
        }
      }
      DB.setItem('lifeos-data', JSON.stringify(out));
      return true;
    },

    initAI(cb) {
      if (this.mode === 'electron') window.electronAPI.initAI(cb);
      // 浏览器模式由 aiChat 内部驱动
    },

    async aiChat(payload) {
      if (this.mode === 'electron') {
        window.electronAPI.aiChat(payload);
        return;
      }
      const cb = this._aiCb || ((e) => console.log('ai event', e));
      await browserAI(payload, cb);
    },

    /* ---------------- 识海 ---------------- */
    mindsea,

    /* ---------------- Agent（Codex 式） ---------------- */
    agent: {
      async getRoot() {
        if (bridge.mode === 'electron') return await window.electronAPI.agentGetRoot();
        return { root: '(浏览器演示工作区)', listing: vfsList(vfsLoad().files) };
      },

      async openWorkspace() {
        if (bridge.mode === 'electron') return await window.electronAPI.agentOpenWorkspace();
        return { root: '(浏览器演示工作区)', listing: vfsList(vfsLoad().files) };
      },

      async list(rel) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentList(rel);
        return vfsList(vfsLoad().files);
      },

      async read(rel) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentRead(rel);
        const vfs = vfsLoad();
        const c = vfs.files[rel];
        if (c == null) throw new Error('文件不存在：' + rel);
        return c;
      },

      async write(rel, content) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentWrite(rel, content);
        const vfs = vfsLoad();
        vfs.files[rel] = String(content == null ? '' : content);
        vfsSave(vfs);
        return { rel, bytes: String(content || '').length };
      },

      async mkdir(rel) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentMkdir(rel);
        // 虚拟文件系统目录隐式存在
        return { rel };
      },

      async remove(rel) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentRemove(rel);
        const vfs = vfsLoad();
        vfs.files = vfsRemove(vfs.files, rel);
        vfsSave(vfs);
        return { rel };
      },

      async rename(from, to) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentRename(from, to);
        const vfs = vfsLoad();
        vfs.files = vfsRename(vfs.files, from, to);
        vfsSave(vfs);
        return { from, to };
      },

      async runCommand(cmd) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentRunCommand(cmd);
        return mockRunCommand(cmd);
      },

      async runCode(payload) {
        if (bridge.mode === 'electron') return await window.electronAPI.agentRunCode(payload);
        const lang = String((payload && payload.language) || 'js').toLowerCase();
        if (lang === 'python' || lang === 'py') {
          return { code: -1, stdout: '', stderr: '', note: '浏览器演示模式不支持运行 Python，请使用 Electron 桌面版（本机需安装 python3）。' };
        }
        return runJSSandbox(payload && payload.code != null ? String(payload.code) : '');
      },

      runAgent(payload, cb) {
        if (bridge.mode === 'electron') {
          window.electronAPI.initAgent(cb);
          window.electronAPI.agentRun(payload);
          return;
        }
        mockAgent(payload, cb);
      }
    }
  };

  // 保存浏览器模式下的 AI 回调引用
  const origInit = bridge.initAI.bind(bridge);
  bridge.initAI = function (cb) {
    this._aiCb = cb;
    origInit(cb);
  };

  L.bridge = bridge;
})(window.LifeOS);
