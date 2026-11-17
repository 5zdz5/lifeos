/* 识海集成测试：浏览器适配、真实 SQLite、Agent 记忆工具与原话完整性。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');

let pass = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  pass++; console.log('  ✅ ' + name);
}
function browserHarness() {
  const values = {};
  const context = {
    console,
    Date, JSON, Math, Number, String, Array, Object, Set, Map, Promise, RegExp, Error,
    localStorage: {
      getItem: (k) => Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null,
      setItem: (k, v) => { values[k] = String(v); },
      removeItem: (k) => { delete values[k]; }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/mindsea.js'), 'utf8'), context);
  return { memory: context.LifeOS.mindsea, values };
}

(async () => {
  console.log('\n=== A. 浏览器本地识海 ===');
  const browser = browserHarness();
  const m = browser.memory;
  let r = await m.write({ items: [
    { text: '以后识海就用本地 SQLite。', at: '2026-11-09 10:00:00', speaker: 0, ev: '识海改造', nd: 'v1', st: '实施', s: 90, dec: 1, decobj: '存储方式', category: '规矩', emo: ['喜'] },
    { text: '今天继续验证搜索。', at: '2026-11-10 09:00:00', speaker: 1, s: 50, category: '闲聊' }
  ] });
  ok('浏览器原话与层级真实写入', r.ok && r.written === 2 && r.created.events.includes('识海改造'));
  const found = await m.search({ q: 'SQLite', pool: 'all' });
  ok('词轴检索命中事和原话', found.hitCount === 1 && found.events[0].name === '识海改造');
  ok('事池检索直接列出命中原话', found.words.some((x) => x.text === '以后识海就用本地 SQLite。'));
  const emo = await m.search({ emo: '喜', pool: 'event' });
  ok('七情位图可反查', emo.hitCount === 1);
  const ev = await m.event({ name: '识海' });
  ok('模糊事名展开版本、阶段与决定', ev.ok && ev.versions[0].stages[0].name === '实施' && ev.decisionsList[0].obj === '存储方式');
  const id = r.ids[0];
  await m.update({ id, category: '知识', place: 'chat' });
  const after = (await m.overview()).words.find((x) => x.id === id);
  ok('纠错只改归类，不改原话', after.text === '以后识海就用本地 SQLite。' && after.cat === '知识' && after.place === 'chat');
  const tail = await m.tail();
  ok('最近原话进入新任务回忆', tail.includes('以后识海就用本地 SQLite。'));
  const exported = await m.exportData();
  const other = browserHarness().memory;
  const imported = await other.importData(exported);
  ok('独立备份可合并导入另一本地库', imported.ok && imported.written === 2);
  await m.writeDoc({ key: 'user', text: '用户喜欢简洁回答。' });
  ok('长期文档可编辑持久化', (await m.docs()).find((d) => d.key === 'user').text === '用户喜欢简洁回答。');
  const wander = await m.wanderNow();
  ok('541 拍算法真实计算', wander.divisor === 541 && Number.isInteger(wander.value));
  const longText = '原话-' + '完'.repeat(1400);
  const cap = await m.capture({ messages: [{ role: 'user', text: longText, ts: Date.now() }], settings: {} });
  ok('离线自动沉淀保留超过 1200 字的原话', cap.written === 1 && (await m.overview()).words.some((x) => x.text === longText));
  const noisy = await m.capture({ messages: [{ role: 'user', text: '<system-reminder>隐藏</system-reminder>', ts: Date.now() }], settings: {} });
  ok('纯系统注入不会沉淀', noisy.written === 0);

  console.log('\n=== B. 桌面真实 SQLite ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-mindsea-test-'));
  const { createMindSeaService } = require(path.join(ROOT, 'mindsea-service.cjs'));
  const service = await createMindSeaService({ baseDir: tmp });
  try {
    const captured = await service.capture({ settings: {}, messages: [
      { role: 'user', text: '我们决定把识海原话存进本地 SQLite，并支持断网检索。', ts: Date.now() },
      { role: 'assistant', text: '已经接入事、版本、阶段、决定与三轴查询，接下来运行自动化测试验证。', ts: Date.now() + 1000 }
    ] });
    ok('桌面离线沉淀实际写库', captured.ok && captured.written === 2 && fs.existsSync(path.join(tmp, 'sea2.db')));
    const desktopSearch = await service.search({ q: '断网检索', pool: 'all' });
    ok('SQLite 三轴查询可读回', desktopSearch.hitCount >= 1 && desktopSearch.events.some((e) => e.name === '识海改造'));
    ok('桌面检索结果直接列出命中原话', (desktopSearch.words || []).some((x) => String(x.text).includes('断网检索')));
    const veryLong = '桌面原话-' + '海'.repeat(1500);
    const direct = await service.write({ items: [{ text: veryLong, speaker: 0, ev: '长文测试', s: 70 }] });
    ok('SQLite 写入路径不让模型回抄或截成 1200 字', direct.ok && (await service.search({ q: '桌面原话', pool: 'all' })).hitCount === 1);
    const overview = await service.overview();
    const stored = overview.words.find((x) => x.text.startsWith('桌面原话-'));
    ok('桌面原话完整保存', stored.text === veryLong);
    await service.update({ id: stored.id, category: '知识' });
    ok('SQLite 纠错不碰原文', (await service.overview()).words.find((x) => x.id === stored.id).text === veryLong);
    const backup = await service.exportData();
    ok('桌面备份含 SQLite 实体', backup.data.memories.length >= 3 && backup.data.events.length >= 2);
    ok('数据库不是内存伪装', fs.statSync(path.join(tmp, 'sea2.db')).size > 0 && overview.mode === 'electron');
  } finally { await service.close(); }

  console.log('\n=== C. Agent 记忆工具 ===');
  const agent = require(path.join(ROOT, 'agent-core.js'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-memory-agent-'));
  let seenSystem = '';
  const memory = {
    async docs() { return [{ title: '用户', text: '回答要简洁' }]; },
    async tail() { return '【识海 · 最近原话】\n· 用户：上次选择本地优先'; },
    async search(args) { return { ok: true, q: args.q, events: [{ name: 'LifeOS 编程', hits: 1 }] }; },
    async event() { return { ok: true }; },
    async write() { return { ok: true }; }
  };
  const result = await agent.runAgent({
    root: ws, user: '上次决定了什么？', includeMemoryTail: true, memory,
    chat: async (messages) => {
      seenSystem = messages[0].content;
      if (!messages.some((x) => x.role === 'tool')) return { text: '', toolCalls: [{ id: 'm1', name: 'memory_search', args: { q: '决定', pool: 'all' } }] };
      return { text: '查到一条相关决定。', toolCalls: [] };
    }
  });
  ok('Agent 注入长期文档与最近原话', seenSystem.includes('回答要简洁') && seenSystem.includes('上次选择本地优先'));
  ok('Agent 真实执行 memory_search', result.events.some((e) => e.type === 'tool' && e.name === 'memory_search') && result.finalAnswer === '查到一条相关决定。');
  ok('OpenAI 工具清单含三个记忆工具', agent.toOpenAITools(true).filter((t) => t.function.name.startsWith('memory_')).length === 3);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n✅ 识海测试通过：' + pass + ' 项');
})().catch((e) => { console.error('❌ 识海测试失败：', e); process.exit(1); });
