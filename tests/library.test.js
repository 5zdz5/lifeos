/* =========================================================================
 * 知识库单测：数据层纳入备份 / 采集引擎真实整理 / 种子内容
 * 在 Node 中模拟 window、localStorage、fetch 后加载真实的 store / capture / seed 文件
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
global.document = {
  createElement() { return { href: '', download: '', click() {}, remove() {} }; },
  body: { appendChild() {} }
};
global.URL.createObjectURL = () => 'blob:mock';
global.URL.revokeObjectURL = () => {};

let MOCK_AI_TEXT = '';
let MOCK_URL_TEXT = '';
let MOCK_FETCH_FAIL = false;
global.fetch = async (url, opts) => {
  if (MOCK_FETCH_FAIL) throw new TypeError('Failed to fetch');
  if (String(url).indexOf('/chat/completions') >= 0) {
    return { ok: true, status: 200, async text() { return ''; }, async json() { return { choices: [{ message: { content: MOCK_AI_TEXT } }] }; } };
  }
  return { ok: true, status: 200, async text() { return MOCK_URL_TEXT; } };
};

const L = global.LifeOS = {};
let uidSeq = 0;
L.utils = { uid: () => 'uid-' + (++uidSeq) };
L.buildInfo = { version: 'vTEST', builtAt: 'test' };
L.bus = { emit() {} };
const DEFAULT = () => ({
  tasks: [], habits: [], notes: [], library: [], aiThread: [],
  settings: { aiBaseUrl: 'https://mock.ai/v1', aiKey: '', aiModel: 'gpt-4o-mini', userName: '', theme: 'auto' }
});
L.bridge = {
  mode: 'browser',
  getDefaultState: DEFAULT,
  async load() { return null; },
  async save(state) { mem['lifeos-data'] = JSON.stringify(state); return true; }
};

eval(fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'capture.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'seed-library.js'), 'utf8'));
const S = L.store, CP = L.capture, SEED = L.seedLibrary;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
async function throwsWith(fn, kw) {
  try { await fn(); return false; }
  catch (e) { return !kw || String(e.message).indexOf(kw) >= 0; }
}

(async () => {
  await S.init();

  console.log('\n=== A. 知识库数据层 ===');
  ok('init 后 state 含 library 数组', Array.isArray(S.state.library));
  const it = S.addLibraryItem({ title: '测试条目', summary: '摘要', points: ['要点1'], tags: ['标签A'] });
  ok('addLibraryItem 补齐默认字段', !!it.id && !!it.createdAt && it.noteId === null && Array.isArray(it.points));
  ok('addLibraryItem 写入 state', S.state.library.length === 1);
  S.updateLibraryItem(it.id, { summary: '改过的摘要' });
  ok('updateLibraryItem 生效', S.state.library[0].summary === '改过的摘要');
  ok('hasLibrarySource 按 URL 去重', (() => {
    S.addLibraryItem({ title: '外部', source: { type: 'url', label: 'x', url: 'https://a.b/c', fetchedAt: 1 } });
    return S.hasLibrarySource('https://a.b/c') && !S.hasLibrarySource('https://a.b/d');
  })());
  S.removeLibraryItem(it.id);
  ok('removeLibraryItem 只删指定条目', S.state.library.length === 1 && S.state.library[0].title === '外部');

  console.log('\n=== B. 备份链路必须带上知识库（防漏） ===');
  S.state.library = [];
  S.addLibraryItem({ title: '要备份的知识', points: ['A', 'B'], source: { type: 'ai', label: 'AI 整理' } });
  const payload = S.exportPayload();
  ok('exportPayload.counts.library 正确', payload.counts.library === 1, JSON.stringify(payload.counts));
  ok('exportPayload.data.library 含条目', payload.data.library.length === 1 && payload.data.library[0].title === '要备份的知识');
  ok('导出包是深拷贝', (() => {
    const n = payload.data.library.length;
    S.state.library.push({ id: 'x', title: '后来加的' });
    return payload.data.library.length === n;
  })());
  const text = JSON.stringify(payload);
  const parsed = S.parseImport(text);
  ok('parseImport 还原 library', parsed.data.library.length === 1 && parsed.data.library[0].title === '要备份的知识');
  ok('旧格式备份（无 library）仍可导入且不报错', (() => {
    try { return S.parseImport(JSON.stringify({ tasks: [], notes: [], aiThread: [] })).data.library.length === 0; }
    catch (e) { return false; }
  })());
  ok('仅有知识库的备份也能被识别', (() => {
    try { return S.parseImport(JSON.stringify({ library: [{ id: 'k', title: '只有知识' }] })).data.library.length === 1; }
    catch (e) { return false; }
  })());

  S.clearSnapshots();
  S.state.library = [];
  await S.importPayload(text, 'replace');
  ok('覆盖导入还原知识库', S.state.library.length === 1 && S.state.library[0].title === '要备份的知识');
  await S.importPayload(text, 'merge');
  ok('合并导入按 ID 去重', S.state.library.filter((x) => x.title === '要备份的知识').length === 1);
  ok('导入前快照含知识库', S.snapshotList()[0].data.library.length >= 1);
  S.clearSnapshots();
  S.state.library = [{ id: 'snap-k', title: '快照时的知识' }];
  S.makeSnapshot('测试');
  const snapId = S.snapshotList()[0].id;
  S.state.library = [];
  await S.restoreSnapshot(snapId);
  ok('恢复快照还原知识库', S.state.library.length === 1 && S.state.library[0].id === 'snap-k');
  S.clearSnapshots();

  console.log('\n=== C. 本地确定性整理（真的从文本抽取，不是假数据） ===');
  const src = '# 番茄工作法\n\n- 25 分钟专注\n- 5 分钟休息\n- 每 4 个番茄休息 15 分钟\n\n正文说明文字。 #专注 #时间管理';
  const lo = CP.localOrganize(src, { source: { type: 'paste', label: '粘贴' } });
  ok('抽取到 Markdown 标题', lo.title === '番茄工作法', lo.title);
  ok('抽取到 3 条列表要点', lo.points.length === 3 && lo.points[0] === '25 分钟专注', JSON.stringify(lo.points));
  ok('抽取到 #标签', lo.tags.length === 2 && lo.tags[0] === '专注', JSON.stringify(lo.tags));
  ok('摘要由要点组成且不为空', lo.summary.length > 0 && lo.summary.indexOf('25 分钟') >= 0);
  ok('原文被保留（截断上限内）', lo.raw.indexOf('番茄工作法') >= 0);
  const noList = CP.localOrganize('第一句讲清了概念。第二句给出一个例子。第三句是可执行建议。', {});
  ok('无列表时按句切分要点', noList.points.length >= 2, JSON.stringify(noList.points));

  console.log('\n=== D. AI JSON 容错解析 ===');
  ok('剥掉 ```json 围栏与尾随解释文字', (() => {
    const j = CP.parseAIJson('```json\n{"title":"A","points":["1"],"tags":[]}\n```\n以上为结果');
    return j.title === 'A';
  })());
  ok('支持数组返回', (() => {
    const j = CP.parseAIJson('好的，结果如下：\n[{"title":"A"},{"title":"B"}]');
    return Array.isArray(j) && j.length === 2;
  })());
  ok('非 JSON 内容明确报错', (() => { try { CP.parseAIJson('抱歉我无法回答'); return false; } catch (e) { return true; } })());
  ok('toItem 兜底与截断', (() => {
    const x = CP.toItem({ title: 'X'.repeat(200), points: null, tags: 'notarray' }, {});
    return x.title.length === 80 && Array.isArray(x.points) && Array.isArray(x.tags) && x.source.type === 'manual';
  })());

  console.log('\n=== E. 三条采集通道 ===');
  ok('无 Key 时 AI 主题采集明确报错（不假装有结果）',
    await throwsWith(() => CP.collectTopic('番茄工作法', S.state.settings), 'API Key'));
  ok('非 http 地址明确报错',
    await throwsWith(() => CP.collectUrl('ftp://x', S.state.settings, {}), 'http'));

  MOCK_URL_TEXT = JSON.stringify({ id: 11743, hitokoto: '循此苦旅，终抵繁星。', from: '拉丁古谚', from_who: '' });
  const urlItems = await CP.collectUrl('https://v1.hitokoto.cn/?c=k&encode=json', S.state.settings, {});
  ok('URL 通道真实解析公开 JSON 接口', urlItems.length === 1 && urlItems[0].summary === '循此苦旅，终抵繁星。');
  ok('URL 条目标注真实来源与类型', urlItems[0].source.type === 'url' && urlItems[0].source.url.indexOf('hitokoto') >= 0);

  const pasteItems = await CP.collectText(src, '', S.state.settings, { useAI: false });
  ok('粘贴通道无需 Key、无需联网即可产出条目', pasteItems.length === 1 && pasteItems[0].title === '番茄工作法');

  S.state.settings.aiKey = 'sk-test';
  MOCK_AI_TEXT = '```json\n[{"title":"AI 整理的卡片","summary":"摘要","points":["要点一","要点二"],"tags":["AI"]}]\n```';
  const topicItems = await CP.collectTopic('间隔重复', S.state.settings);
  ok('AI 主题采集解析数组 JSON', topicItems.length === 1 && topicItems[0].title === 'AI 整理的卡片');
  ok('AI 条目标注 ai 来源', topicItems[0].source.type === 'ai');

  MOCK_URL_TEXT = '<html><head><title>测试页面</title></head><body><p>这是关于知识管理的正文内容。</p></body></html>';
  const aiUrlItems = await CP.collectUrl('https://example.com/article', S.state.settings, { useAI: true });
  ok('URL + AI 整理走模型通道', aiUrlItems.length === 1 && aiUrlItems[0].title === 'AI 整理的卡片');
  ok('URL + AI 整理保留来源 URL', aiUrlItems[0].source.url === 'https://example.com/article');

  MOCK_FETCH_FAIL = true;
  ok('CORS/网络失败给出可操作的中文提示',
    await throwsWith(() => CP.collectUrl('https://blocked.example.com', S.state.settings, {}), '跨域'));
  MOCK_FETCH_FAIL = false;

  console.log('\n=== F. 联网刷新与去重 ===');
  S.state.library = [];
  MOCK_URL_TEXT = JSON.stringify({ id: 1, hitokoto: '第一句', from: '出处A', from_who: '' });
  let r = await CP.refreshSources();
  ok('刷新源产出 3 条（已登记 3 个公开源）', r.added.length === 3, JSON.stringify(r.errors));
  r.added.forEach((x) => S.addLibraryItem(x));
  r = await CP.refreshSources();
  ok('重复刷新全部跳过（不堆积）', r.added.length === 0 && r.skipped.length === 3, JSON.stringify(r));
  MOCK_FETCH_FAIL = true;
  r = await CP.refreshSources();
  ok('源不可达时逐条记录错误而非整批崩掉', r.errors.length === 3 && r.added.length === 0);
  MOCK_FETCH_FAIL = false;

  console.log('\n=== G. 种子知识库内容（不空泛） ===');
  ok('内置条目数量 >= 15', SEED.items.length >= 15, String(SEED.items.length));
  ok('每条都有标题与非空摘要', SEED.items.every((x) => x.title && x.summary && x.summary.length >= 4));
  ok('方法学条目含具体要点（>=3 条）', SEED.items.filter((x) => (x.points || []).length >= 3).length >= 12);
  ok('条目都带来源标注', SEED.items.every((x) => x.source && x.source.label));
  ok('含真实抓取条目并带 URL', SEED.items.some((x) => x.source.type === 'url' && /^https?:\/\//.test(x.source.url)));
  ok('ensure 首次注入且只注入一次', (() => {
    S.state.library = [];
    try { localStorage.removeItem(SEED.SEED_KEY); } catch (e) {}
    const n = SEED.ensure(S);
    const n2 = SEED.ensure(S);
    return n === SEED.items.length && n2 === 0 && S.state.library.length === n;
  })());

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
