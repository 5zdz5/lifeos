/* =========================================================================
 * 用户体验回归测试（零依赖）
 * 第二轮 UX 修复后新增：弹窗键盘契约、AI 演示回复、演示诚实化、
 * 窄屏导航、示例内容可清除、日历日程、多标签同步、视觉破损修复。
 * 源码层静态断言 + 最小浏览器环境里的真实数据层测试。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src');
const JS = path.join(ROOT, 'js');

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
  body: { appendChild() {} },
  querySelector() { return null; }
};
global.URL.createObjectURL = () => 'blob:mock';
global.URL.revokeObjectURL = () => {};
global.requestAnimationFrame = (fn) => fn();

const L = global.LifeOS = {};
eval(fs.readFileSync(path.join(JS, 'utils.js'), 'utf8'));
L.utils.uid = () => 'ux-' + Math.random().toString(36).slice(2, 9);
L.buildInfo = { version: 'vTEST', builtAt: 'test' };
L.bridge = {
  mode: 'browser',
  getDefaultState: () => ({
    tasks: [], habits: [], notes: [], library: [], events: [], aiThread: [],
    settings: {
      aiBaseUrl: 'https://api.openai.com/v1', aiKey: '', aiModel: 'gpt-4o-mini',
      userName: '', theme: 'auto', mindseaAuto: true, mindseaAI: false
    }
  }),
  async load() { return null; },
  async save(state) { mem['lifeos-data'] = JSON.stringify(state); return true; }
};
eval(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'));
eval(fs.readFileSync(path.join(JS, 'stats.js'), 'utf8'));
// 真实种子模块（只调用纯逻辑部分）
eval(fs.readFileSync(path.join(JS, 'seed-library.js'), 'utf8'));

const S = L.store;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = (f) => read('js/' + f);
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
  await S.init();

  console.log('\n=== A. 弹窗键盘契约 ===');
  const utils = js('utils.js');
  ok('支持 ESC 关闭', /e\.key === 'Escape'/.test(utils) && /close\(\)/.test(utils));
  ok('输入框 Enter 提交主操作', /e\.key === 'Enter'/.test(utils) && /data-act="save"/.test(utils));
  ok('排除 textarea/select/button 上的 Enter', /\/\^\(TEXTAREA\|SELECT\|BUTTON\|A\)\$/.test(utils));
  ok('打开后自动聚焦首个输入框', /first\.focus/.test(utils) && /requestAnimationFrame/.test(utils));
  ok('关闭时移除 keydown 监听', /removeEventListener\('keydown', onKey/.test(utils));
  ok('重复关闭有幂等保护', /if \(closed\) return/.test(utils));

  console.log('\n=== B. AI 演示回复空引号修复 ===');
  const ai = js('modules/ai.js');
  ok('流式占位 assistant 不发给模型', /m !== streamingMsg/.test(ai) && /role === 'assistant' && !m\.content/.test(ai));
  const bridgeSrc = js('bridge.js');
  ok('mockReply 取最后一条 user 而非数组末位', /reverse\(\)\.find\(\(m\) => m && m\.role === 'user'\)/.test(bridgeSrc));
  ok('不再出现「配 Key 就能真写本机文件」误导', !/配置真实 API Key 后，Agent 会真实读写本机文件并执行命令/.test(bridgeSrc));
  ok('明确声明网页版不接触本机磁盘', /不接触本机磁盘/.test(bridgeSrc));
  ok('演示回放开头有明确提示', /【演示回放】/.test(bridgeSrc));
  ok('演示结束说明未按指令产出文件', /并没有按你的要求创建对应文件/.test(bridgeSrc));
  ok('AI 助手演示状态条醒目化', /ai-status-bar.*demo/.test(ai) && /示例回复/.test(ai));
  ok('操作说明不再塞进 placeholder', !/placeholder="[^"]*Enter 发送/.test(ai));

  console.log('\n=== C. 演示模式诚实化与设置页 ===');
  const settings = js('modules/settings.js');
  ok('不再使用「数据 100% 在本机」绝对化措辞', !/数据 100% 在本机/.test(settings));
  ok('说明「仅存本机 ≠ 有访问控制」', /不等于「有访问控制」|不等于.*访问控制/.test(settings));
  ok('设置页说明网页版能力边界', /关于网页版的能力边界/.test(settings));
  ok('设置页可清除示例内容', /#s-clear-seed/.test(settings) && /seedLibrary\.clear/.test(settings));
  ok('导出后记录提醒已完成', /lifeos-backup-tip-done/.test(settings));
  const codex = js('modules/codex.js');
  ok('Codex 首屏不再承诺「一步步做到通过为止」（网页版）', /网页版是演示回放/.test(codex));
  ok('运行回执标注演示回放', /演示回放 · 未改动本机/.test(codex));
  const html = read('index.html');
  ok('顶栏常驻演示标识', /demo-pill/.test(html));
  ok('去掉重复的「数据仅存本机」badge', !/class="local-badge"/.test(html));
  ok('设置页明示真实执行需桌面版', /Electron 桌面版/.test(settings));

  console.log('\n=== D. 窄屏导航与深色可读性 ===');
  ok('有菜单按钮与遮罩', /id="nav-toggle"/.test(html) && /id="nav-scrim"/.test(html));
  const app = js('app.js');
  ok('菜单可开合且点导航自动收起', /closeNavDrawer/.test(app) && /classList\.toggle\('open'\)/.test(app));
  ok('多标签 storage 同步', /addEventListener\('storage'/.test(app));
  ok('通用 data-go 跨视图跳转', /querySelectorAll\('\[data-go\]'\)/.test(app));
  const css = read('css/finesse.css');
  ok('窄屏抽屉展开时恢复文字标签', /\.sidebar\.open \.nav-item \.nav-text \{ display: inline/.test(css));
  ok('深色次要文字对比度提高', /\[data-theme="dark"\] \{[\s\S]*?--muted: #a9bcb8/.test(css));
  ok('深色分组标签不再过暗', /\[data-theme="dark"\] \.nav-group \{ opacity: \.85/.test(css));
  ok('识海统计卡裁切已修', /overflow: visible !important/.test(css) && /\.ms-stats > div \{ border-right: 0 !important/.test(css));
  ok('底部 badge 深色底统一', /\.ai-status, \.mode-badge \{[\s\S]*?background: var\(--rail-2\)/.test(css));

  console.log('\n=== E. 示例内容可清除 ===');
  const seed = js('seed-library.js');
  ok('提供 clear/count/isSeedItem', /clear: clear/.test(seed) && /count: count/.test(seed) && /isSeedItem: isSeedItem/.test(seed));
  ok('clear 只删 seed- 前缀条目', /filter\(\(it\) => !isSeedItem\(it\)\)/.test(seed));
  ok('清除后打标记防灌回', /markSeeded\(\)/.test(seed));
  const appSrc = js('app.js');
  ok('总览知识条目排除示例', /seedLibrary\.isSeedItem/.test(appSrc));
  const lib = js('modules/library.js');
  ok('知识库标注示例并提供清除入口', /kb-seed/.test(lib) && /#kb-clear-seed/.test(lib));
  ok('总览不再把新用户导向演示 AI', !/data-go="ai"/.test(appSrc));
  ok('有只提醒一次的导出备份提示', /lifeos-backup-tip-done/.test(appSrc) && /dash-export/.test(appSrc));
  // 真实逻辑
  S.state.library.push({ id: 'seed-1', title: '示例' }, { id: 'mine-1', title: '我采集的' });
  ok('count 只数示例条目', L.seedLibrary.count(S) === 1);
  const removed = L.seedLibrary.clear(S);
  ok('clear 保留用户自己的条目', removed === 1 && S.state.library.length === 1 && S.state.library[0].id === 'mine-1');
  ok('clear 后不会重新灌入', L.seedLibrary.ensure(S) === 0);

  console.log('\n=== F. 日历真正能记日程 ===');
  const cal = js('modules/calendar.js');
  const storeSrc = js('store.js');
  const statsSrc = js('stats.js');
  ok('默认状态含 events', /events: \[\]/.test(js('bridge.js')));
  ok('ENTITY_KEYS 登记 events（备份/快照/导入自动带上）', /'library', 'events', 'aiThread'/.test(storeSrc));
  ok('日历有新增日程弹窗', /function openEventEditor/.test(cal) && /S\.addEvent/.test(cal));
  ok('日历有删除日程入口', /data-del-event/.test(cal));
  ok('日程计入活跃度（热力图也会亮）', /\(st\.events \|\| \[\]\)\.forEach/.test(statsSrc));
  ok('日程明细不与活动聚合重复', /filter\(\(it\) => it\.type !== 'event'\)/.test(cal));
  ok('导入时校验日程日期格式', /data\.events\.filter\(\(e\) => e && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(storeSrc));
  ok('导出 counts 含日程', /events: \(s\.events \|\| \[\]\)\.length/.test(storeSrc));
  // 真实逻辑
  const ev = S.addEvent({ date: '2026-11-11', title: '交方案', time: '15:00' });
  ok('addEvent 写入并可查', S.state.events.length === 1 && S.state.events[0].title === '交方案');
  ok('非法日期回退到今天', S.addEvent({ date: 'not-a-date', title: '坏日期' }).date === L.utils.todayStr());
  const act = L.stats.activity();
  ok('活动聚合包含日程', !!act['2026-11-11'] && act['2026-11-11'].items.some((i) => i.type === 'event' && /交方案/.test(i.label)));
  const backup = S.exportPayload();
  ok('备份含 events', Array.isArray(backup.data.events) && backup.counts.events === 2);
  const imported = S.parseImport(JSON.stringify({
    data: { events: [{ id: 'x1', date: '2026-12-01', title: '合法' }, { id: 'x2', date: '<script>', title: '非法' }] }
  }));
  ok('导入过滤非法日程日期', imported.data.events.length === 1 && imported.data.events[0].date === '2026-12-01');
  S.removeEvent(ev.id);
  ok('removeEvent 生效', S.state.events.length === 1);

  console.log('\n=== G. 表单与空态体验 ===');
  const habits = js('modules/habits.js');
  const tasks = js('modules/tasks.js');
  const notes = js('modules/notes.js');
  const graph = js('modules/graph.js');
  ok('习惯默认色已是主题 Teal', !/#6c8cff/.test(habits) && /#176c6b/.test(habits));
  ok('习惯图标字段有说明', /1 个字符/.test(habits));
  ok('日期控件有中文格式提示', /格式：年-月-日/.test(tasks) && /格式：年-月-日/.test(cal));
  ok('任务/习惯/笔记/图谱空态都有行动按钮',
    /empty-new-task/.test(tasks) && /empty-new-habit/.test(habits) &&
    /empty-new-note/.test(notes) && /data-go="notes"/.test(graph));
  ok('笔记编辑器有保存状态与保存按钮', /e-save-state/.test(notes) && /#e-save/.test(notes) && /function doSave|const doSave/.test(notes));
  ok('返回时清理未编辑的空笔记草稿', /无标题笔记/.test(notes) && /S\.removeNote\(id\)/.test(notes));
  const settingsSrc = js('modules/settings.js');
  ok('日期控件有中文实时回显',
    /U\.cnDate/.test(tasks) && /U\.cnDate/.test(cal) &&
    /date-cn/.test(tasks) && /date-cn/.test(cal) &&
    /^2026年11月11日 · 周[日一二三四五六]$/.test(L.utils.cnDate('2026-11-11')));
  ok('中文日期对非法输入返回空', L.utils.cnDate('not-a-date') === '' && L.utils.cnDate('') === '');
  ok('设置页提供「仅本次会话保存密钥」', /s-key-session/.test(settingsSrc) && /aiKeySessionOnly/.test(settingsSrc));
  ok('设置页说明备份不含密钥', /备份与本地快照都不含密钥/.test(settingsSrc));

  console.log('\n════════════════════════════════');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
