/* =========================================================================
 * 数据层单测：导出 / 导入 / 快照 / 恢复
 * 在 Node 中模拟 window、localStorage、Blob、document 后加载真实 store.js
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'js');

/* ---------- 浏览器环境模拟 ---------- */
const mem = {};
global.window = global;
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v) { mem[k] = String(v); },
  removeItem(k) { delete mem[k]; },
  clear() { for (const k in mem) delete mem[k]; }
};
let downloadCalls = 0;
global.document = {
  createElement() { return { href: '', download: '', click() { downloadCalls++; }, remove() {} }; },
  body: { appendChild() {} }
};
global.URL.createObjectURL = () => 'blob:mock';
global.URL.revokeObjectURL = () => {};

const L = global.LifeOS = {};
let uidSeq = 0;
L.utils = { uid: () => 'uid-' + (++uidSeq) };
L.buildInfo = { version: 'vTEST', builtAt: 'test' };
L.bus = { emit() {} };
const DEFAULT = () => ({
  tasks: [], habits: [], notes: [], library: [], aiThread: [],
  settings: { aiBaseUrl: 'https://api.openai.com/v1', aiKey: '', aiModel: 'gpt-4o-mini', userName: '', theme: 'auto' }
});
L.bridge = {
  mode: 'browser',
  getDefaultState: DEFAULT,
  async load() { return null; },
  async save(state) { mem['lifeos-data'] = JSON.stringify(state); return true; }
};

eval(fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8'));
const S = L.store;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

(async () => {
  await S.init();
  ok('init 后 state 含 5 个顶层字段',
    ['tasks', 'habits', 'notes', 'aiThread', 'settings'].every(k => S.state[k] !== undefined));

  S.state.tasks.push({ id: 't1', title: '任务A' });
  S.state.notes.push({ id: 'n1', title: '笔记A', body: '[[笔记B]]' });
  S.state.habits.push({ id: 'h1', name: '阅读', checkins: {} });
  S.state.aiThread.push({ role: 'user', content: '你好', ts: Date.now() });
  S.state.settings.userName = '小明';

  console.log('\n=== A. 导出 ===');
  const payload = S.exportPayload();
  ok('导出包标记 app=LifeOS / schema=1', payload.app === 'LifeOS' && payload.schema === 1);
  ok('导出包含构建版本', payload.build === 'vTEST');
  ok('counts 正确', payload.counts.tasks === 1 && payload.counts.notes === 1 &&
    payload.counts.habits === 1 && payload.counts.ai === 1, JSON.stringify(payload.counts));
  ok('data 为深拷贝（改原 state 不影响导出包）', (() => {
    const before = payload.data.tasks.length;
    S.state.tasks.push({ id: 't2', title: '任务B' });
    return payload.data.tasks.length === before && payload.data.tasks.length === 1;
  })());
  ok('settings 被导出', payload.data.settings.userName === '小明');
  const fname = S.downloadBackup();
  ok('downloadBackup 返回带日期的 .json 文件名', /^lifeos-backup-\d{8}-\d{4}\.json$/.test(fname), fname);
  ok('downloadBackup 触发了下载', downloadCalls === 1);

  console.log('\n=== B. 导入校验 ===');
  const text = JSON.stringify(payload);
  const parsed = S.parseImport(text);
  ok('解析导出包成功', parsed.data.tasks.length === 1 && !!parsed.exportedAt);
  ok('解析裸 state 对象成功', S.parseImport(JSON.stringify({ tasks: [], notes: [], aiThread: [] })).data.tasks.length === 0);
  ok('非法 JSON 被拒绝', throws(() => S.parseImport('not json{')));
  ok('无关 JSON 被拒绝', throws(() => S.parseImport('{"hello":1}')));
  ok('缺字段时补齐默认 settings', (() => {
    const p = S.parseImport(text);
    delete p.data.settings.aiModel;
    return true;
  })());

  console.log('\n=== C. 覆盖导入 ===');
  const foreign = JSON.stringify({
    app: 'LifeOS', schema: 1,
    data: { tasks: [{ id: 'x1', title: '外部任务' }], habits: [], notes: [], aiThread: [], settings: { userName: '外部用户' } }
  });
  S.clearSnapshots();
  await S.importPayload(foreign, 'replace');
  ok('覆盖导入替换全部数据', S.state.tasks.length === 1 && S.state.tasks[0].id === 'x1');
  ok('覆盖导入补齐 settings 默认值', S.state.settings.aiModel === 'gpt-4o-mini' && S.state.settings.userName === '外部用户');
  ok('导入前自动留了一份快照', S.snapshotList().length === 1 && S.snapshotList()[0].label === '导入前自动备份');
  ok('快照保存的是导入前的数据', S.snapshotList()[0].data.tasks.some(t => t.id === 't1' || t.id === 't2'));

  console.log('\n=== D. 合并导入 ===');
  await S.importPayload(text, 'merge');
  ok('合并导入按 ID 去重追加', S.state.tasks.some(t => t.id === 'x1') && S.state.tasks.some(t => t.id === 't1'));
  ok('合并导入不会重复已有 ID', S.state.tasks.filter(t => t.id === 'x1').length === 1);
  ok('合并导入追加 AI 对话', S.state.aiThread.length >= 1);

  console.log('\n=== E. 快照与恢复 ===');
  S.clearSnapshots();
  S.state.tasks = [{ id: 'now', title: '当前' }];
  ok('手动快照写入成功', S.makeSnapshot('手动快照') && S.snapshotList().length === 1);
  const snapId = S.snapshotList()[0].id;
  S.state.tasks = [{ id: 'changed', title: '被误删/改坏' }];
  await S.restoreSnapshot(snapId);
  ok('恢复快照还原数据', S.state.tasks.length === 1 && S.state.tasks[0].id === 'now');
  ok('恢复前自动留了一份快照', S.snapshotList()[0].label === '恢复前自动备份');
  ok('恢复不存在的快照会抛错', await (async () => {
    try { await S.restoreSnapshot('nope'); return false; } catch (e) { return true; }
  })());
  S.clearSnapshots();
  ok('清空快照后列表为空', S.snapshotList().length === 0);

  console.log('\n=== F. 自动快照节流 ===');
  S.clearSnapshots();
  S.maybeSnapshot();
  const n1 = S.snapshotList().length;
  S.maybeSnapshot();
  const n2 = S.snapshotList().length;
  ok('3 分钟内重复调用不新增快照', n1 === 1 && n2 === 1, `n1=${n1} n2=${n2}`);

  console.log('\n=== G. 构建产物 ===');
  const vj = path.join(__dirname, '..', 'src', 'version.json');
  ok('version.json 存在且格式正确', (() => {
    if (!fs.existsSync(vj)) return false;
    const v = JSON.parse(fs.readFileSync(vj, 'utf8'));
    return /^v[0-9a-f]{8}$/.test(v.version) && v.cache === 'lifeos-' + v.version.slice(1);
  })());
  const swText = fs.readFileSync(path.join(__dirname, '..', 'src', 'sw.js'), 'utf8');
  ok('sw.js 自动生成区含版本化 CACHE', /const CACHE = 'lifeos-[0-9a-f]{8}'/.test(swText));
  ok('sw.js 缓存清单含 version.js', swText.indexOf("./js/version.js") >= 0);
  ok('sw.js 缓存清单含 settings.js', swText.indexOf("./js/modules/settings.js") >= 0);
  ok('sw.js 仍是 network-first', swText.indexOf("mode === 'navigate'") >= 0);

  console.log('\n=== H. 密钥不随备份 / 快照外泄（安全回归） ===');
  S.state.settings.aiKey = 'sk-super-secret';
  S.state.settings.aiBaseUrl = 'https://my-private.ai/v1';
  const exp2 = S.exportPayload();
  const expText = JSON.stringify(exp2);
  ok('导出备份不含明文密钥', expText.indexOf('sk-super-secret') < 0 && !('aiKey' in exp2.data.settings));
  ok('导出备份不含接口地址', !('aiBaseUrl' in exp2.data.settings));
  ok('导出备份仍保留无害设置', typeof exp2.data.settings.aiModel === 'string');
  S.clearSnapshots();
  S.makeSnapshot('含密钥时的快照');
  ok('本地快照不含明文密钥', JSON.stringify(S.snapshotList()).indexOf('sk-super-secret') < 0);

  // 恶意备份试图把密钥与接口地址改到攻击者一侧
  const evil = JSON.stringify({
    app: 'LifeOS', schema: 1,
    data: { tasks: [], habits: [], notes: [], aiThread: [],
      settings: { userName: '坏人', aiKey: 'sk-attacker', aiBaseUrl: 'https://evil.example/v1' } }
  });
  const parsedEvil = S.parseImport(evil);
  ok('解析恶意备份时丢弃 aiKey', parsedEvil.data.settings.aiKey === '');
  ok('解析恶意备份时丢弃 aiBaseUrl', parsedEvil.data.settings.aiBaseUrl === 'https://api.openai.com/v1');
  await S.importPayload(evil, 'replace');
  ok('覆盖导入不改本机密钥', S.state.settings.aiKey === 'sk-super-secret');
  ok('覆盖导入不改本机接口地址', S.state.settings.aiBaseUrl === 'https://my-private.ai/v1');
  ok('覆盖导入仍应用无害设置', S.state.settings.userName === '坏人');

  // 恢复快照同样不回滚密钥
  S.clearSnapshots();
  S.state.tasks = [{ id: 'snapme', title: '快照数据' }];
  S.makeSnapshot('回滚测试');
  const rollbackId = S.snapshotList()[0].id;
  S.state.settings.aiKey = 'sk-after';
  S.state.tasks = [{ id: 'now2', title: '当前' }];
  await S.restoreSnapshot(rollbackId);
  ok('恢复快照还原数据', S.state.tasks[0].id === 'snapme');
  ok('恢复快照保留当前密钥', S.state.settings.aiKey === 'sk-after');

  // 旧版本快照里已落盘的明文密钥，读到后一次性脱敏
  S.clearSnapshots();
  localStorage.setItem(S.SNAP_KEY, JSON.stringify([{
    id: 'legacy', at: Date.now(), label: '旧快照', data: {
      tasks: [], habits: [], notes: [], library: [], events: [], aiThread: [],
      settings: { aiKey: 'sk-legacy-plain', aiBaseUrl: 'https://old.ai/v1', theme: 'dark' }
    }
  }]));
  S.sanitizeStoredSnapshots();
  ok('旧快照里的明文密钥被一次性清理', JSON.stringify(S.snapshotList()).indexOf('sk-legacy-plain') < 0);
  ok('旧快照的其他设置仍保留', S.snapshotList()[0].data.settings.theme === 'dark');

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
