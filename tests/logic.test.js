/* =========================================================================
 * LifeOS 逻辑单测：双向链接 / Markdown / 活动聚合
 * 在 Node 中模拟最小 window 环境后加载真实源码执行。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'js');

global.window = global;
const L = global.LifeOS = {};

eval(fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8'));

L.store = {
  state: {
    tasks: [
      { id: 't1', title: '整理周计划', status: 'done', due: '2026-11-09', createdAt: Date.now() - 3 * 86400000, updatedAt: Date.now() - 86400000 },
      { id: 't2', title: '写日报', status: 'todo', due: '2026-11-10', createdAt: Date.now(), updatedAt: Date.now() }
    ],
    habits: [
      { id: 'h1', name: '阅读', emoji: '📖', checkins: { '2026-11-09': true, '2026-11-08': true } }
    ],
    notes: [
      { id: 'n1', title: 'LifeOS 构想', body: '参考 [[双向链接设计]] 与 [[周复盘|复盘记录]]，还有 [[未创建的页面]]。', tags: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n2', title: '双向链接设计', body: '反向链接回到 [[LifeOS 构想]]。', tags: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n3', title: '周复盘', body: '被 n1 链入，所以不是孤立笔记。', tags: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n4', title: '完全孤立的草稿', body: '既没有出链，也没有任何笔记链向我。', tags: [], createdAt: Date.now(), updatedAt: Date.now() }
    ],
    aiThread: [{ role: 'user', content: '你好', ts: Date.now() }],
    settings: {}
  }
};

eval(fs.readFileSync(path.join(ROOT, 'links.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'stats.js'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== A. 双向链接 ===');
const n1 = L.store.state.notes[0];
const extracted = L.links.extract(n1.body);
ok('提取 3 个出链', extracted.length === 3, JSON.stringify(extracted));
ok('别名 [[周复盘|复盘记录]] 解析目标为「周复盘」', extracted.indexOf('周复盘') >= 0);
ok('resolve 命中已存在笔记', L.links.resolve('双向链接设计').id === 'n2');
ok('resolve 大小写/空格不敏感', L.links.resolve('  lifeos 构想 ') !== null);
ok('resolve 未创建返回 null', L.links.resolve('未创建的页面') === null);
const backs = L.links.backlinks(n1);
ok('反向链接找到 1 篇（双向链接设计）', backs.length === 1 && backs[0].id === 'n2', JSON.stringify(backs.map(x => x.title)));
const g = L.links.graph();
ok('图谱节点 = 4 真实 + 1 虚拟', g.nodes.length === 5 && g.nodes.filter(v => !v.real).length === 1, JSON.stringify(g.nodes.map(v => v.title)));
ok('图谱边数 = 4', g.links.length === 4, JSON.stringify(g.links));
ok('孤立笔记仅「完全孤立的草稿」1 篇', L.links.orphans().length === 1 && L.links.orphans()[0].id === 'n4', JSON.stringify(L.links.orphans().map(n => n.title)));

console.log('\n=== B. Markdown [[ ]] 渲染 ===');
const html = L.utils.markdown('见 [[双向链接设计]] 和 [[周复盘|复盘]]');
ok('渲染为 wikilink <a>', (html.match(/class="wikilink"/g) || []).length === 2, html);
ok('别名显示为「复盘」', html.indexOf('>复盘</a>') >= 0, html);
ok('data-wiki 保留目标', html.indexOf('data-wiki="双向链接设计"') >= 0, html);
ok('普通 markdown 链接未被破坏', L.utils.markdown('[百度](https://b.com)').indexOf('href="https://b.com"') >= 0);

console.log('\n=== C. 活动统计 ===');
const map = L.stats.activity();
ok('今日有活动', !!map[L.utils.todayStr()], JSON.stringify(Object.keys(map)));
ok('习惯打卡计入 2026-11-09', (map['2026-11-09'] && map['2026-11-09'].count > 0));
ok('任务截止计入 2026-11-10', (map['2026-11-10'] && map['2026-11-10'].items.some(i => i.type === 'due')));
ok('AI 对话计入', Object.values(map).some(d => d.items.some(i => i.type === 'ai')));
ok('level 分档 0/1/2/3/4', [0, 1, 2, 4, 9].map(L.stats.level).join(',') === '0,1,2,3,4');
const days = L.stats.daysBack(365);
ok('daysBack(365) 长度 365 且以今天结尾', days.length === 365 && days[364] === L.utils.todayStr());
const sk = L.stats.streaks(map, days);
ok('streaks 返回 current/longest 数值', typeof sk.current === 'number' && typeof sk.longest === 'number', JSON.stringify(sk));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
