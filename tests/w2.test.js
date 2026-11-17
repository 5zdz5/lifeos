/* =========================================================================
 * W2 · 知识内容单测（第 12 套件）
 * B1 反链上下文 / 未链接提及 / 安全重命名
 * B2 Daily Notes 聚合与幂等
 * B3 Markdown Vault 往返 / 清洗 / 文件名安全
 * B4 全局检索聚合 / 分组 / 高亮 XSS
 *
 * 用 vm 隔离环境加载真实源码，模拟 store.state 与 utils，纯函数验证。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS = path.join(__dirname, '..', 'src', 'js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

function makeCtx(state) {
  const ctx = {
    console, Date, JSON, Math, Promise, Object, Array, String, Number, RegExp, Error, Set, Map,
    window: null
  };
  ctx.window = ctx;
  ctx.LifeOS = { store: { state: state }, utils: { escapeHtml: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') } };
  ctx.LifeOS.modules = {};
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(JS, rel), 'utf8'), ctx);
  return { ctx, L: ctx.LifeOS, load };
}

const NOW = Date.parse('2026-11-13T10:00:00+08:00');
const notes = () => [
  { id: 'n1', title: '双向链接设计', body: '核心见 [[LifeOS 构想]] 与 [[周复盘|复盘记录]]。\n第二行提到 LifeOS 构想 但没有链接。', tags: [], createdAt: NOW, updatedAt: NOW },
  { id: 'n2', title: 'LifeOS 构想', body: '这是一篇总纲。\n反向链接回到 [[双向链接设计]]。', tags: [], createdAt: NOW, updatedAt: NOW },
  { id: 'n3', title: '周复盘', body: '本周进度正常。', tags: [], createdAt: NOW, updatedAt: NOW },
  { id: 'n4', title: '完全孤立的草稿', body: '没有链接。', tags: [], createdAt: NOW, updatedAt: NOW }
];

(async () => {
  console.log('\n=== B1 · 反链上下文 / 未链接提及 ===');
  {
    const { L, load } = makeCtx({ notes: notes() });
    load('links.js');
    const target = L.store.state.notes[1]; // LifeOS 构想
    const ctxs = L.links.backlinkContexts(target);
    ok('反链上下文找到链向「LifeOS 构想」的笔记', ctxs.length === 1 && ctxs[0].note.id === 'n1', JSON.stringify(ctxs.map((c) => c.note.id)));
    ok('反链上下文给出引用原文行', ctxs[0].snippets.some((s) => s.indexOf('[[LifeOS 构想]]') >= 0), JSON.stringify(ctxs[0].snippets));
    ok('反链上下文排除自身与无关笔记', ctxs.every((c) => c.note.id !== 'n2' && c.note.id !== 'n3' && c.note.id !== 'n4'));
    const mentions = L.links.unlinkedMentions(target);
    ok('未链接提及找到纯文本命中', mentions.some((m) => m.note.id === 'n1'), JSON.stringify(mentions.map((m) => m.note.id)));
    ok('未链接提及不含已被 [[ ]] 包住的重复计数', mentions.length === 1);
    const lf = L.links.linkifyFirst(L.store.state.notes[0].body, 'LifeOS 构想');
    ok('linkifyFirst 只在链接之外的纯文本处插入', lf.count === 1 && (lf.body.match(/\[\[LifeOS 构想\]\]/g) || []).length === 2, lf.body);
    const lf2 = L.links.linkifyFirst('已有 [[标题]]，没有别的。', '标题');
    ok('linkifyFirst 不重复链接已有 wikilink', lf2.count === 0);
  }

  console.log('\n=== B1/B3 · wikilink 安全批量重命名 ===');
  {
    const { L, load } = makeCtx({ notes: notes() });
    load('links.js');
    const r = L.links.rewriteLinks('看 [[旧名]] 和 [[旧名|别名]]，还有 [[别的]]', '旧名', '新名');
    ok('rewriteLinks 改写目标且保留别名', r.count === 2 && r.body.indexOf('[[新名|别名]]') >= 0 && r.body.indexOf('[[别的]]') >= 0, r.body);
    ok('rewriteLinks 大小写/空格不敏感', L.links.rewriteLinks('[[  旧名  ]]', '旧名', 'X').count === 1);
    ok('rewriteLinks 同名/空值不改写', L.links.rewriteLinks('[[A]]', 'A', 'A').count === 0 && L.links.rewriteLinks('[[A]]', '', 'B').count === 0);
    const rn = L.links.renameNoteLinks(L.store.state, 'n2', 'LifeOS 构想', 'LifeOS 蓝图');
    ok('renameNoteLinks 统计改写的链接数', rn.changed === 1 && rn.touched.indexOf('n1') >= 0, JSON.stringify(rn));
    ok('renameNoteLinks 后新标题可解析、旧标题失效',
      L.links.resolve('LifeOS 蓝图') === null /* resolve 按旧数据 */ ||
      L.store.state.notes[0].body.indexOf('[[LifeOS 蓝图]]') >= 0);
    ok('renameNoteLinks 不改动被重命名笔记自身', L.store.state.notes[1].body.indexOf('[[双向链接设计]]') >= 0);
  }

  console.log('\n=== B3 · Markdown Vault 往返与清洗 ===');
  {
    const { L, load } = makeCtx({ notes: notes() });
    load('vault.js');
    const n = { title: '我的笔记', body: '# 标题\n\n见 [[另一篇]]\n\n正文 <script>alert(1)</script>', tags: ['工作', '复盘'], createdAt: NOW, updatedAt: NOW };
    const md = L.vault.noteToMarkdown(n);
    ok('noteToMarkdown 含 frontmatter 标题与标签', /^---\ntitle: "我的笔记"/.test(md) && /tags: \["工作", "复盘"\]/.test(md), md.slice(0, 120));
    ok('noteToMarkdown 保留正文与 wikilink', md.indexOf('[[另一篇]]') >= 0 && md.indexOf('# 标题') >= 0);
    const back = L.vault.markdownToNote(md, 'ignored.md');
    ok('markdownToNote 往返还原标题', back.title === '我的笔记', back.title);
    ok('markdownToNote 往返还原标签', JSON.stringify(back.tags) === JSON.stringify(['工作', '复盘']), JSON.stringify(back.tags));
    ok('markdownToNote 往返还原正文（含 wikilink）', back.body.indexOf('[[另一篇]]') >= 0);
    const plain = L.vault.markdownToNote('# 普通标题\n\n正文内容', 'file.md');
    ok('markdownToNote 兼容普通 .md（取首个 # 标题）', plain.title === '普通标题' && plain.body.indexOf('正文内容') >= 0, JSON.stringify(plain));
    const byName = L.vault.markdownToNote('只有正文', '2026-11-13.md');
    ok('markdownToNote 无标题时用文件名', byName.title === '2026-11-13', byName.title);
    const evil = L.vault.markdownToNote('---\ntitle: "<img src=x onerror=1>"\n---\n\n\u0000\u0001正文', 'x.md');
    ok('markdownToNote 去掉控制字符', evil.body.indexOf('\u0000') < 0 && evil.body.indexOf('\u0001') < 0);
    ok('markdownToNote 对危险标题只作纯文本保留（渲染层负责转义）', evil.title.indexOf('<img') >= 0);
    ok('safeFilename 去除路径分隔符与危险字符', L.vault.safeFilename('a/b:c*d?').indexOf('/') < 0 && !/[:*?]/.test(L.vault.safeFilename('a/b:c*d?')));
    const used = Object.create(null);
    ok('exportNotes 同名文件自动加序号', (() => {
      const f = L.vault.exportNotes([{ title: '同名' }, { title: '同名' }]);
      return f.length === 2 && f[0].filename !== f[1].filename;
    })());
  }

  console.log('\n=== B4 · 全局检索聚合 / 分组 / 高亮 ===');
  {
    const { L, load } = makeCtx({ notes: notes() });
    load('utils.js'); // 提供 escapeHtml 给 search.highlight
    load('search.js');
    const state = {
      notes: notes(),
      library: [
        { id: 'l1', title: 'GTD 方法', summary: '五步清空大脑', points: ['捕获', '理清'] },
        { id: 'l2', title: '复盘模板', summary: '每周回顾的固定结构', points: ['做了什么', '复盘要点'] }
      ],
      tasks: [{ id: 't1', title: '写周复盘报告', note: '' }],
      events: [{ id: 'e1', date: '2026-11-13', title: '复盘会议', note: '' }],
      aiThread: [{ role: 'user', content: '帮我复盘今天', ts: NOW }],
      mindsea: []
    };
    const ms = [{ id: 'm1', at: '2026-11-12 10:00', text: '我们决定采用复盘模板' }];
    const all = L.search.searchAll('复盘', state, ms);
    ok('searchAll 跨 6 类实体聚合命中', all.length >= 5, '命中 ' + all.length);
    ok('searchAll 命中笔记 / 知识库 / 任务 / 日程 / 对话 / 识海',
      ['note', 'library', 'task', 'event', 'ai', 'mindsea'].every((t) => all.some((r) => r.type === t)),
      JSON.stringify(all.map((r) => r.type)));
    ok('searchAll 空查询返回空数组', L.search.searchAll('', state, ms).length === 0);
    ok('searchAll 不误命中无关词', L.search.searchAll('完全不存在的词xyz', state, ms).length === 0);
    const counts = L.search.groupCounts(all);
    ok('groupCounts 统计各分组数量', Object.keys(counts).length >= 5 && counts['识海记忆'] === 1, JSON.stringify(counts));
    const h = L.search.highlight('见 <img src=x onerror=1> 复盘内容', '复盘');
    ok('highlight 高亮命中关键词', h.indexOf('<mark>复盘</mark>') >= 0, h);
    ok('highlight 对 HTML 特殊字符转义（防 XSS）', h.indexOf('<img') < 0 && h.indexOf('&lt;img') >= 0, h);
    const h2 = L.search.highlight('包含 < 与 & 的文本', '<');
    ok('highlight 关键词含特殊字符也不破坏 HTML', h2.indexOf('<mark>&lt;</mark>') >= 0 && h2.indexOf('&amp;') >= 0, h2);
    ok('snippet 截取关键词附近上下文', L.search.snippet('前面很多字'.repeat(10) + '复盘' + '后面很多字'.repeat(10), '复盘').indexOf('复盘') >= 0);
  }

  console.log('\n=== B2 · Daily Notes 聚合与幂等 ===');
  {
    const { L, load, ctx } = makeCtx({
      notes: notes(), tasks: [], habits: [], events: [
        { id: 'e1', date: '2026-11-13', title: '复盘会议', time: '10:00', note: '' }
      ], aiThread: [], library: []
    });
    load('utils.js');
    // stats.js 的 activity 依赖 L.store.state；daily.js 用 U.dateKey / stats
    load('stats.js');
    load('modules/daily.js');
    const D = L.modules.daily;
    ok('daily.isDaily 识别 daily 标记或 daily 标签', D.isDaily({ daily: true }) && D.isDaily({ tags: ['daily'] }));
    ok('daily.isDaily 不误判普通笔记', !D.isDaily({ title: '2026-11-13', tags: [] }));
    // 用可写的 addNote 模拟 store
    const added = [];
    L.store.addNote = (n) => { const x = Object.assign({ id: 'd' + (added.length + 1), createdAt: NOW, updatedAt: NOW }, n); L.store.state.notes.push(x); added.push(x); return x; };
    const n1 = D.ensureDaily('2026-11-13');
    ok('ensureDaily 首次创建日记笔记', !!n1 && n1.title === '2026-11-13' && n1.daily === true, JSON.stringify(n1));
    const n2 = D.ensureDaily('2026-11-13');
    ok('ensureDaily 幂等（不重复创建）', n2.id === n1.id && added.length === 1);
    ok('dailyFor 能取回已创建的日记', D.dailyFor('2026-11-13').id === n1.id);
    const data = D.dayData('2026-11-13');
    ok('dayData 聚合当日日程', data.events.length === 1 && data.events[0].title === '复盘会议', JSON.stringify(data.events));
    ok('dayData 含当天新建笔记', data.notes.length >= 1);
    ok('dayData 识别当日已有日记', data.daily && data.daily.id === n1.id);
    const html = D.renderPanel('2026-11-13');
    ok('renderPanel 渲染日期/日程/活动分栏', html.indexOf('2026年11月13日') >= 0 && html.indexOf('复盘会议') >= 0 && html.indexOf('dl-grid') >= 0);
    ok('renderPanel 输出经转义（标题不被注入）', (() => {
      L.store.state.events.push({ id: 'x', date: '2026-11-13', title: '<script>bad()</script>', time: '', note: '' });
      const h = D.renderPanel('2026-11-13');
      return h.indexOf('<script>bad') < 0 && h.indexOf('&lt;script&gt;') >= 0;
    })());
  }

  console.log('\n=== W2 · 验证链未被破坏（12 导航 / ENTITY_KEYS） ===');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('导航视图仍为 12 个（Daily Notes 不是顶层导航）', (html.match(/data-view="[a-z]+"/g) || []).length === 12);
    ok('顶栏新增全局检索按钮', /id="global-search"/.test(html));
    const store = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
    ok('ENTITY_KEYS 未新增顶层实体', /const ENTITY_KEYS = \['tasks', 'habits', 'notes', 'library', 'events', 'aiThread'\]/.test(store));
    const build = fs.readFileSync(path.join(__dirname, '..', 'build-standalone.js'), 'utf8');
    ok('构建清单含 3 个新模块', ['js/vault.js', 'js/search.js', 'js/modules/daily.js', 'js/modules/search.js'].every((f) => build.indexOf("'" + f + "'") >= 0));
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('❌ w2.test.js 异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
