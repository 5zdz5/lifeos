/* =========================================================================
 * Codex Agent 后端引擎单测：文件系统 / 路径安全 / 命令执行 / 代码运行 / agent 循环
 * 直接 require 真实 agent-core.js（纯 Node，无需模拟浏览器）
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const agent = require('../agent-core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-agent-'));
  console.log('工作区：' + root);

  console.log('\n=== A. 文件系统 ===');
  agent.writeFile(root, 'a/b.txt', 'hello');
  ok('writeFile 自动创建父目录并可读回', agent.readFile(root, 'a/b.txt') === 'hello');
  const listing = agent.listDir(root, '.');
  ok('listDir 返回目录树（a 为 dir）', listing.length === 1 && listing[0].name === 'a' && listing[0].type === 'dir');
  ok('listDir 递归含子文件', listing[0].children && listing[0].children[0].name === 'b.txt');
  agent.mkdirp(root, 'x/y/z');
  ok('mkdirp 递归创建目录', fs.existsSync(path.join(root, 'x/y/z')));
  agent.renamePath(root, 'a/b.txt', 'a/c.txt');
  ok('rename 生效', agent.readFile(root, 'a/c.txt') === 'hello');
  ok('rename 后旧路径不存在', throws(() => agent.readFile(root, 'a/b.txt')));
  agent.removePath(root, 'a');
  ok('remove 删除目录', throws(() => agent.readFile(root, 'a/c.txt')));
  ok('remove 拒绝删除根目录', throws(() => agent.removePath(root, '.')));

  console.log('\n=== B. 路径越界防护 ===');
  ok('resolveIn 拒绝 ../ 越界', throws(() => agent.resolveIn(root, '../secret')));
  ok('readFile 拒绝绝对越界路径', throws(() => agent.readFile(root, '/etc/passwd')));
  ok('writeFile 拒绝越界写入', throws(() => agent.writeFile(root, '../../evil.txt', 'x')));
  ok('readFile 拒绝 .. 拼接越界', throws(() => agent.readFile(root, 'a/../../etc/passwd')));

  console.log('\n=== C. 命令执行 ===');
  const r1 = await agent.runCommand(root, 'echo hello-agent');
  ok('命令执行返回 stdout', r1.code === 0 && r1.stdout.indexOf('hello-agent') >= 0, JSON.stringify(r1));
  const r2 = await agent.runCommand(root, 'pwd');
  ok('命令在工作区目录执行', r2.stdout.trim() === path.resolve(root), r2.stdout.trim());
  const r3 = await agent.runCommand(root, 'sleep 3', { timeout: 400 });
  ok('超时命令被强制终止', r3.note && r3.note.indexOf('超时') >= 0, JSON.stringify(r3));

  console.log('\n=== D. 代码运行 ===');
  const js = await agent.runCode(root, { language: 'js', code: 'console.log(2 + 3);' });
  ok('JS 运行（node）输出 5', js.stdout.indexOf('5') >= 0, JSON.stringify(js));
  const py = await agent.runCode(root, { language: 'python', code: 'print("hi-py")' });
  if (agent.hasPython3()) {
    ok('Python 运行（python3）输出 hi-py', py.stdout.indexOf('hi-py') >= 0, JSON.stringify(py));
  } else {
    ok('未安装 python3 时给出明确提示', py.note && py.note.indexOf('python3') >= 0, JSON.stringify(py));
  }
  const tmpLeft = fs.readdirSync(path.join(root, '.lifeos-tmp')).length;
  ok('运行后临时文件已清理', tmpLeft === 0, '剩余 ' + tmpLeft + ' 个');

  console.log('\n=== E. Agent 循环（注入假 chat） ===');
  let call = 0;
  const events = [];
  async function chat(messages) {
    call++;
    // 校验消息结构合理性：system + user + (tool 回传)
    if (call === 1) return { text: '先看目录', toolCalls: [{ id: 'c1', name: 'list_files', args: { path: '.' } }] };
    if (call === 2) return { text: '写结果文件', toolCalls: [{ id: 'c2', name: 'write_file', args: { path: 'out/result.txt', content: 'done-by-agent' } }] };
    return { text: '任务完成', toolCalls: [] };
  }
  const res = await agent.runAgent({ root, user: '创建一个 out/result.txt', chat, onStep: (e) => events.push(e) });
  ok('agent 循环返回最终答案', res.finalAnswer === '任务完成', res.finalAnswer);
  ok('agent 循环步数正确', res.steps === 3, 'steps=' + res.steps);
  ok('agent 真实写入了文件', agent.readFile(root, 'out/result.txt') === 'done-by-agent');
  ok('产生 assistant 与 tool 事件', events.some(e => e.type === 'assistant') && events.some(e => e.type === 'tool'));
  ok('tool 事件记录了工具名', events.some(e => e.type === 'tool' && e.name === 'write_file'));

  console.log('\n=== F. 工具执行直接调用 ===');
  const t = await agent.executeTool(root, 'run_code', { language: 'js', code: 'console.log(7*6)' });
  ok('executeTool run_code 输出 42', t.indexOf('42') >= 0, t);
  ok('executeTool 未知工具抛错', await (async () => {
    try { await agent.executeTool(root, 'nope', {}); return false; } catch (e) { return true; }
  })());

  console.log('\n=== G. 最大步数保护 ===');
  async function loopChat() { return { text: '继续', toolCalls: [{ id: 'x', name: 'list_files', args: {} }] }; }
  const loop = await agent.runAgent({ root, user: '无限循环', maxSteps: 3, chat: loopChat });
  ok('达到最大步数后返回兜底文案', loop.finalAnswer.indexOf('最大步数') >= 0, loop.finalAnswer);
  ok('步数等于 maxSteps', loop.steps === 3, 'steps=' + loop.steps);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
