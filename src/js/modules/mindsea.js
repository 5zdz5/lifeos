/* =========================================================================
 * LifeOS · 识海工作台
 * 原话库 / 事—版本—阶段 / 时间线 / 关系图 / 自动化 / 长期文档
 * 数据通过 LifeOS.bridge.mindsea 访问：桌面 SQLite，浏览器 localStorage。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  const TABS = [
    ['memories', '原话'], ['events', '事'], ['timeline', '时间线'],
    ['graph', '关系图'], ['automation', '自动化'], ['docs', '长期文档']
  ];
  const CATS = ['', '闲聊', '暧昧', '干活', '知识', '规矩'];
  const state = { tab: 'memories', data: null, docs: [], loading: false, error: '', result: null, selected: null, adding: false, wander: null };
  let rootEl = null;

  const esc = (x) => U.escapeHtml(String(x == null ? '' : x));
  const num = (x) => Number(x || 0).toLocaleString('zh-CN');
  function fmtBytes(n) {
    n = Number(n || 0);
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  }
  function opts(list, current) {
    return list.map((x) => '<option value="' + esc(x) + '"' + (x === (current || '') ? ' selected' : '') + '>' + (x || '未分类') + '</option>').join('');
  }
  function wordHTML(m) {
    return '<article class="ms-word">' +
      '<div class="ms-word-meta"><span class="ms-speaker">' + (Number(m.sp != null ? m.sp : m.speaker) === 1 ? 'LifeOS' : '用户') + '</span>' +
      '<time>' + esc(m.at) + '</time><span>重要度 ' + num(m.s) + '</span>' +
      (m.emo && m.emo.length ? '<span>' + esc(m.emo.join(' · ')) + '</span>' : '') +
      (Number(m.dec) ? '<span class="ms-decision">决定</span>' : '') + '</div>' +
      '<div class="ms-original">' + esc(m.text) + '</div>' +
      '<div class="ms-word-path">' + (m.ev ? '<button data-event="' + esc(m.ev) + '">' + esc(m.ev) + '</button>' : '<span>未挂事</span>') +
      (m.nd ? '<span> / ' + esc(m.nd) + '</span>' : '') + (m.st ? '<span> / ' + esc(m.st) + '</span>' : '') + '</div>' +
      '<div class="ms-correction"><span>纠错仅改归类，不改原话</span>' +
      '<select data-memory="' + num(m.id) + '" data-field="category" aria-label="修改门类">' + opts(CATS, m.cat || m.category || '') + '</select>' +
      '<select data-memory="' + num(m.id) + '" data-field="place" aria-label="修改去处">' +
      [['event', '事上'], ['chat', '闲聊池'], ['trash', '废料池']].map((p) => '<option value="' + p[0] + '"' + (p[0] === (m.place || (m.ev ? 'event' : 'chat')) ? ' selected' : '') + '>' + p[1] + '</option>').join('') + '</select></div></article>';
  }
  function searchPanel() {
    return '<div class="ms-search"><input id="ms-q" class="input" placeholder="检索原话或事名，如：识海" value="">' +
      '<input id="ms-day" class="input" type="date" aria-label="按日期检索" title="格式：年-月-日">' +
      '<select id="ms-emo" class="input" aria-label="按七情检索"><option value="">全部情绪</option>' + ['喜', '怒', '哀', '惧', '爱', '恶', '欲'].map((x) => '<option>' + x + '</option>').join('') + '</select>' +
      '<select id="ms-pool" class="input"><option value="all">全部记忆</option><option value="event">只看事</option><option value="chat">只看闲聊</option></select>' +
      '<button class="btn primary" data-act="search">检索</button><button class="btn ghost" data-act="reset-search">全部</button></div>';
  }
  function addPanel() {
    if (!state.adding) return '';
    return '<div class="ms-add"><div class="ms-section-title">手动写入一条原话</div>' +
      '<textarea id="ms-new-text" class="input" rows="4" placeholder="原样写入需要长期保留的话，不做摘要改写"></textarea>' +
      '<div class="ms-form-grid"><input id="ms-new-event" class="input" placeholder="事名（可空）"><input id="ms-new-version" class="input" placeholder="版本（需有事名）"><input id="ms-new-stage" class="input" placeholder="阶段（需有版本）">' +
      '<select id="ms-new-cat" class="input">' + opts(CATS, '知识') + '</select><input id="ms-new-score" class="input" type="number" min="0" max="100" value="70" aria-label="重要度"><input id="ms-new-decobj" class="input" placeholder="决定对象（勾选决定时必填）"></div>' +
      '<label class="ms-check"><input id="ms-new-dec" type="checkbox"> 这是一条决定</label><div class="btn-row"><button class="btn primary" data-act="save-memory">写入识海</button><button class="btn ghost" data-act="toggle-add">取消</button></div></div>';
  }
  function memoriesHTML() {
    let body = '';
    if (state.result) {
      const r = state.result;
      const eventHits = (r.events || []).map((e) => '<button class="ms-hit" data-event="' + esc(e.name) + '"><b>' + esc(e.name) + '</b><span>' + num(e.hits) + ' 条命中 · ' + num(e.decisions) + ' 条决定</span></button>').join('');
      body = '<div class="ms-result-head">检索命中 ' + num(r.hitCount) + ' 条' + (r.eventCount != null ? '，分布在 ' + num(r.eventCount) + ' 件事' : '') + '</div>' +
        (eventHits ? '<div class="ms-hits">' + eventHits + '</div>' : '') +
        ((r.words || []).length ? r.words.map(wordHTML).join('') : '') +
        (!(r.words || []).length && !eventHits ? '<div class="ms-empty">没有命中。换一个短词、日期或情绪再试。</div>' : '') +
        (r.note ? '<p class="hint">' + esc(r.note) + '</p>' : '');
    } else {
      const words = (state.data.words || []);
      body = words.length ? words.map(wordHTML).join('') : '<div class="ms-empty">识海还是空的。去 Codex 或 AI 助手完成一轮对话，或在上方手动写入第一条原话。</div>';
    }
    return searchPanel() + '<div class="ms-toolbar"><span>' + (state.result ? '检索结果' : '最近原话（最多显示 500 条）') + '</span><button class="btn" data-act="toggle-add">＋ 手动记忆</button></div>' + addPanel() + body;
  }
  function eventDetailHTML() {
    const d = state.selected;
    if (!d) return '<div class="ms-empty">选择左侧的一件事，展开版本、阶段与决定。</div>';
    if (!d.ok) return '<div class="ms-empty">' + esc(d.note || '没有找到这件事') + '</div>';
    const versions = (d.versions || []).map((v) => '<div class="ms-version"><b>' + esc(v.name) + '</b><span>' + num(v.hits) + ' 条</span><div>' + (v.stages || []).map((s) => '<span class="ms-stage">' + esc(s.name) + ' · ' + num(s.hits) + '</span>').join('') + '</div></div>').join('');
    const decisions = (d.decisionsList || []).map((x) => '<div class="ms-decision-row"><time>' + esc(x.at) + '</time><b>' + esc(x.obj) + '</b><p>' + esc(x.text) + '</p></div>').join('');
    return '<div class="ms-detail-head"><div><h3>' + esc(d.name) + '</h3><p>' + esc(d.firstAt) + ' → ' + esc(d.lastAt) + '</p></div><span>' + num(d.hits) + ' 条原话</span></div>' +
      (d.note ? '<p class="hint">' + esc(d.note) + '</p>' : '') + '<h4>版本与阶段</h4>' + (versions || '<div class="ms-empty">这件事还没有版本分层。</div>') + '<h4>决定</h4>' + (decisions || '<div class="ms-empty">还没有标记为决定的原话。</div>');
  }
  function eventsHTML() {
    const events = (state.data.events || []).slice().sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
    return '<div class="ms-events"><div class="ms-event-list">' + (events.length ? events.map((e) => '<button class="ms-event' + (state.selected && state.selected.name === e.name ? ' on' : '') + '" data-event="' + esc(e.name) + '"><span class="ms-event-name">' + esc(e.name) + '</span><span>' + num(e.n) + ' 条 · ' + num(e.dec_count) + ' 决定</span><time>' + esc(e.last_at || '') + '</time></button>').join('') : '<div class="ms-empty">还没有形成「事」。写入时给出事名，识海会自动复用同名事。</div>') + '</div><div class="ms-event-detail">' + eventDetailHTML() + '</div></div>';
  }
  function timelineHTML() {
    const words = (state.data.words || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    let day = '';
    const rows = words.map((m) => {
      const d = String(m.at || '').slice(0, 10);
      const head = d !== day ? '<div class="ms-day">' + esc(d) + '</div>' : '';
      day = d;
      return head + '<button class="ms-time-row" data-memory-jump="' + num(m.id) + '"><time>' + esc(String(m.at || '').slice(11, 16)) + '</time><span class="ms-time-dot"></span><div><b>' + esc(m.ev || '未挂事') + '</b><p>' + esc(m.text) + '</p></div><span>' + (Number(m.sp != null ? m.sp : m.speaker) === 1 ? 'LifeOS' : '用户') + '</span></button>';
    }).join('');
    return '<div class="ms-timeline">' + (rows || '<div class="ms-empty">暂无可展示的时间线。</div>') + '</div>';
  }
  function graphHTML() {
    const events = (state.data.events || []).slice().sort((a, b) => Number(b.n || 0) - Number(a.n || 0)).slice(0, 16);
    if (!events.length) return '<div class="ms-empty">还没有事可连成图谱。</div>';
    const cx = 450, cy = 275, rx = 350, ry = 205;
    const points = events.map((e, i) => {
      const a = -Math.PI / 2 + i * Math.PI * 2 / events.length;
      return { e, x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) };
    });
    const lines = points.map((p) => '<line x1="450" y1="275" x2="' + p.x + '" y2="' + p.y + '" class="ms-graph-line"/>').join('');
    const nodes = points.map((p) => '<g class="ms-graph-node" data-event="' + esc(p.e.name) + '" tabindex="0" role="button"><circle cx="' + p.x + '" cy="' + p.y + '" r="' + Math.min(34, 17 + Math.sqrt(Number(p.e.n || 0)) * 2) + '"/><text x="' + p.x + '" y="' + (p.y - 3) + '">' + esc(String(p.e.name).slice(0, 9)) + '</text><text x="' + p.x + '" y="' + (p.y + 12) + '" class="ms-graph-count">' + num(p.e.n) + ' 条</text></g>').join('');
    return '<div class="ms-graph"><svg viewBox="0 0 900 550" role="img" aria-label="识海事关系图">' + lines + '<g class="ms-graph-core"><circle cx="450" cy="275" r="45"/><text x="450" y="280">识海</text></g>' + nodes + '</svg></div><p class="hint">按原话数量选取前 16 件事；点击节点可展开版本与决定。连线表示归属识海，不伪造事件之间的语义关系。</p>';
  }
  function automationHTML() {
    const c = state.data.capture || {}, stat = c.stat || {}, lib = c.library || {};
    const logs = (state.data.logs || []).map((x) => '<div class="ms-log"><span class="ms-log-dot ' + (x.level === 'fail' ? 'fail' : '') + '"></span><time>' + esc(x.at) + '</time><b>' + esc(x.mode || 'local') + '</b><div>' + esc(x.reason || '') + '<small>处理 ' + num(x.lines) + ' 条 · 写入 ' + num(x.written) + ' 条</small></div></div>').join('');
    const w = state.wander;
    return '<div class="ms-auto-stats"><div><b>' + num(lib.total) + '</b><span>记忆总量</span></div><div><b>' + num(lib.today) + '</b><span>今日新增</span></div><div><b>' + num(stat.runs) + '</b><span>今日成功沉淀</span></div><div><b>' + num(stat.failed) + '</b><span>今日失败</span></div></div>' +
      '<div class="ms-auto-control"><div><h3>每轮结束自动沉淀</h3><p>保留用户与助手原话；离线规则兜底，可选 AI 判分。工具输出与系统提示不进入记忆。</p></div><button class="btn" data-act="memory-settings">' + (S.state.settings.mindseaAuto === false ? '已停用 · 去开启' : '运行中 · 去设置') + '</button></div>' +
      '<div class="ms-wander"><div><h3>541 拍漫游</h3><p>保留上游触发算法，主动点击时真实计算；未伪装成持续后台心跳。</p></div><button class="btn" data-act="wander">计算一次</button></div>' +
      (w ? '<div class="ms-wander-result">当前值 <b>' + num(w.value) + '</b> / ' + num(w.divisor) + ' · ' + (w.hit ? '命中漫游' : '距下一次边界 ' + num(w.remain)) + '<br><small>今日 ' + num(w.state.todayCount) + ' 条 · 距上次说话 ' + num(w.state.sinceSpeakSec) + ' 秒</small></div>' : '') +
      '<h3 class="ms-log-title">沉淀日志</h3><div class="ms-logs">' + (logs || '<div class="ms-empty">还没有沉淀记录。</div>') + '</div>';
  }
  function docsHTML() {
    return '<div class="ms-docs-intro">这些文档会进入桌面 Agent 的系统上下文；它们保存稳定偏好，不替代逐条原话记忆。</div><div class="ms-docs">' + state.docs.map((d) => '<section class="ms-doc"><div class="ms-doc-head"><div><h3>' + esc(d.title) + '</h3><code>' + esc(d.path) + '</code></div><button class="btn" data-doc-save="' + esc(d.key) + '">保存</button></div><textarea class="input" data-doc-text="' + esc(d.key) + '" rows="10" spellcheck="false">' + esc(d.text) + '</textarea></section>').join('') + '</div>';
  }
  function contentHTML() {
    if (state.loading && !state.data) return '<div class="ms-empty">正在打开本机识海…</div>';
    if (state.error && !state.data) return '<div class="ms-empty">识海打开失败：' + esc(state.error) + '</div>';
    if (!state.data) return '';
    if (state.tab === 'events') return eventsHTML();
    if (state.tab === 'timeline') return timelineHTML();
    if (state.tab === 'graph') return graphHTML();
    if (state.tab === 'automation') return automationHTML();
    if (state.tab === 'docs') return docsHTML();
    return memoriesHTML();
  }
  function statsHTML() {
    const c = state.data ? state.data.counts : {};
    return [['memories', '原话'], ['events', '事'], ['versions', '版本'], ['stages', '阶段'], ['decisions', '决定']].map((x) => '<div><b>' + num(c[x[0]]) + '</b><span>' + x[1] + '</span></div>').join('');
  }
  function paint() {
    if (!rootEl) return;
    const content = rootEl.querySelector('#ms-content');
    if (content) content.innerHTML = contentHTML();
    const stats = rootEl.querySelector('#ms-stats');
    if (stats) stats.innerHTML = statsHTML();
    const db = rootEl.querySelector('#ms-db');
    if (db && state.data) db.textContent = state.data.dbPath + ' · ' + fmtBytes(state.data.bytes);
    rootEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === state.tab));
  }
  async function load(keepResult) {
    if (state.loading) return;
    state.loading = true; state.error = ''; paint();
    try {
      state.data = await L.bridge.mindsea.overview();
      state.docs = await L.bridge.mindsea.docs();
      if (!keepResult) state.result = null;
    } catch (e) { state.error = e.message || String(e); }
    state.loading = false; paint();
  }
  async function openEvent(name) {
    try {
      state.selected = await L.bridge.mindsea.event({ name });
      state.tab = 'events'; paint();
    } catch (e) { U.toast(e.message || '读取事失败', 'error'); }
  }
  function download(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'lifeos-mindsea-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function saveMemory() {
    const text = rootEl.querySelector('#ms-new-text').value.trim();
    if (!text) { U.toast('原话不能为空', 'error'); return; }
    const dec = rootEl.querySelector('#ms-new-dec').checked ? 1 : 0;
    const item = { text, speaker: 0, ev: rootEl.querySelector('#ms-new-event').value.trim(), nd: rootEl.querySelector('#ms-new-version').value.trim(), st: rootEl.querySelector('#ms-new-stage').value.trim(), category: rootEl.querySelector('#ms-new-cat').value, s: Number(rootEl.querySelector('#ms-new-score').value), dec, decobj: dec ? rootEl.querySelector('#ms-new-decobj').value.trim() : '' };
    const r = await L.bridge.mindsea.write({ items: [item] });
    if (!r.ok) throw new Error((r.errors || []).join('；'));
    state.adding = false; state.result = null; await load(); U.toast('已原样写入识海');
  }
  async function click(e) {
    const b = e.target.closest('button, [role="button"]');
    if (!b || !rootEl.contains(b)) return;
    if (b.hasAttribute('data-tab')) { state.tab = b.getAttribute('data-tab'); paint(); return; }
    if (b.hasAttribute('data-event')) { await openEvent(b.getAttribute('data-event')); return; }
    if (b.hasAttribute('data-doc-save')) {
      const key = b.getAttribute('data-doc-save'), ta = rootEl.querySelector('[data-doc-text="' + key + '"]');
      await L.bridge.mindsea.writeDoc({ key, text: ta.value }); U.toast('长期文档已保存'); return;
    }
    const act = b.getAttribute('data-act');
    if (act === 'search') {
      const q = rootEl.querySelector('#ms-q').value.trim(), day = rootEl.querySelector('#ms-day').value, emo = rootEl.querySelector('#ms-emo').value;
      if (!q && !day && !emo) { U.toast('至少填写词、日期或情绪中的一项', 'error'); return; }
      state.result = await L.bridge.mindsea.search({ q, day, emo, pool: rootEl.querySelector('#ms-pool').value, limit: 30 }); paint();
    } else if (act === 'reset-search') { state.result = null; paint(); }
    else if (act === 'toggle-add') { state.adding = !state.adding; paint(); }
    else if (act === 'save-memory') { await saveMemory(); }
    else if (act === 'export') { download(await L.bridge.mindsea.exportData()); U.toast('识海备份已导出'); }
    else if (act === 'import') { rootEl.querySelector('#ms-import-file').click(); }
    else if (act === 'memory-settings') { L.app.showView('settings'); }
    else if (act === 'wander') {
      state.wander = await L.bridge.mindsea.wanderNow();
      if (state.wander.hit) await L.bridge.mindsea.recordWander({ startTag: '手动 541 拍', path: (state.data.events || []).slice(0, 3).map((x) => x.name) });
      paint(); if (state.wander.hit) await load(true);
    }
  }
  async function change(e) {
    const el = e.target;
    if (el.id === 'ms-import-file') {
      const f = el.files && el.files[0]; if (!f) return;
      try {
        const r = await L.bridge.mindsea.importData(JSON.parse(await f.text()));
        if (!r.ok) throw new Error((r.errors || []).join('；'));
        U.toast('识海备份已合并，新增 ' + (r.written || 0) + ' 条'); await load();
      } catch (err) { U.toast('导入失败：' + (err.message || err), 'error'); }
      el.value = ''; return;
    }
    if (el.hasAttribute('data-memory')) {
      const patch = { id: Number(el.getAttribute('data-memory')) }; patch[el.getAttribute('data-field')] = el.value;
      const r = await L.bridge.mindsea.update(patch);
      if (!r.ok) { U.toast(r.error || '纠错失败', 'error'); return; }
      U.toast('归类已更新，原话未改动'); await load(true);
    }
  }
  function render() {
    return '<div class="page ms-page"><div class="ms-head"><div><div class="ms-eyebrow">MINDSEA · LOCAL MEMORY</div><h2>识海</h2><p>保留原话，把对话组织成事、版本、阶段与决定。</p></div><div class="btn-row"><button class="btn" data-act="import">导入</button><button class="btn primary" data-act="export">导出识海</button></div></div>' +
      '<input type="file" id="ms-import-file" accept=".json,application/json" hidden>' +
      '<div class="ms-stats" id="ms-stats">' + statsHTML() + '</div><div class="ms-db" id="ms-db">正在读取存储位置…</div>' +
      '<div class="ms-tabs">' + TABS.map((t) => '<button data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div id="ms-content" class="ms-content">' + contentHTML() + '</div></div>';
  }
  function bind(root) {
    rootEl = root;
    root.addEventListener('click', (e) => { click(e).catch((err) => U.toast(err.message || String(err), 'error')); });
    root.addEventListener('change', (e) => { change(e).catch((err) => U.toast(err.message || String(err), 'error')); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ms-q') { e.preventDefault(); const b = root.querySelector('[data-act="search"]'); if (b) b.click(); } });
    load(true);
  }
  L.modules.mindsea = { render, bind };
})(window.LifeOS);
