/* =========================================================================
 * LifeOS · Daily Notes 每日笔记（W2 · B2）
 *
 * 设计：不新增顶层实体（不动 ENTITY_KEYS / 备份链 / 12 个导航视图）。
 * 「每天的日记」就是一篇标题为 YYYY-MM-DD、带 daily 标记的普通笔记，
 * 于是导出、快照、导入、双链、检索全部自动复用既有链路。
 *
 * 视图聚合：当日日程(events) + 当日活动(stats.activity) + 当天创建/编辑的笔记
 *          + 当天任务/习惯打卡，与日历 dayDetail 口径一致。
 * 入口：日历某天「查看当日日记」、笔记列表工具栏「每日笔记」。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;

  const TAG = 'daily';
  const local = { date: null };

  function isDaily(n) {
    return !!n && (n.daily === true || (Array.isArray(n.tags) && n.tags.indexOf(TAG) >= 0));
  }
  function dailyFor(date) {
    return (S.state.notes || []).find((n) => isDaily(n) && n.title === date) || null;
  }

  /* 取某天的聚合数据（纯读取） */
  function dayData(date) {
    const st = S.state;
    const map = (L.stats && L.stats.activity) ? L.stats.activity() : {};
    const acts = ((map[date] && map[date].items) || []).filter((it) => it.type !== 'event');
    const events = (st.events || []).filter((e) => e && e.date === date)
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    const notes = (st.notes || []).filter((n) => U.dateKey(n.createdAt) === date);
    const tasks = (st.tasks || []).filter((t) => t.due === date || U.dateKey(t.createdAt) === date);
    const habits = (st.habits || []).filter((h) => (h.checkins || {})[date]);
    return { date: date, acts: acts, events: events, notes: notes, tasks: tasks, habits: habits, daily: dailyFor(date) };
  }

  /* 创建/打开某天的日记笔记；已存在则直接打开编辑器 */
  function ensureDaily(date) {
    let n = dailyFor(date);
    if (!n) {
      const body = '# ' + date + ' · ' + U.cnDate(date) + '\n\n## 今日安排\n\n## 记录\n\n';
      n = S.addNote({ title: date, body: body, tags: [TAG], daily: true });
    }
    return n;
  }

  function open(date) {
    local.date = date || U.todayStr();
    const n = ensureDaily(local.date);
    // 复用笔记编辑器：设置 notes 模块的当前笔记并打开编辑器
    if (L.modules.notes && L.modules.notes.open) L.modules.notes.open(n.id);
    return n;
  }

  /* 外部（日历）入口：切到笔记列表并高亮该天 */
  function go(date) {
    local.date = date || U.todayStr();
    L.app.showView('notes');
    if (L.modules.notes && L.modules.notes.showDaily) L.modules.notes.showDaily(local.date);
  }

  function renderPanel(date) {
    const d = dayData(date);
    const cn = U.cnDate(date) || date;
    const evHTML = d.events.length
      ? d.events.map((e) =>
        '<div class="dl-row"><span class="dl-ic">◷</span><span class="dl-t">' + U.escapeHtml(e.time || '全天') + ' · ' + U.escapeHtml(e.title || '') + '</span></div>').join('')
      : '<div class="dl-empty">这一天没有日程</div>';
    const actHTML = d.acts.length
      ? d.acts.slice(0, 12).map((it) =>
        '<div class="dl-row"><span class="dl-ic">' + U.escapeHtml(it.icon || '•') + '</span><span class="dl-t">' + U.escapeHtml(it.label || '') + '</span></div>').join('')
      : '<div class="dl-empty">这一天还没有活动记录</div>';
    const noteHTML = d.notes.length
      ? d.notes.map((n) =>
        '<button class="dl-note" data-daily-note="' + U.escapeHtml(n.id) + '">✎ ' + U.escapeHtml(n.title || '无标题') + '</button>').join('')
      : '<div class="dl-empty">这一天没有新建笔记</div>';

    return '' +
      '<div class="page daily-page">' +
      '  <div class="toolbar">' +
      '    <button class="btn ghost" id="dl-back">← 返回笔记</button>' +
      '    <input class="input" id="dl-date" type="date" lang="zh-CN" value="' + U.escapeHtml(date) + '"/>' +
      '    <span class="form-hint date-cn" id="dl-date-cn"></span>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn primary" id="dl-open">' + (d.daily ? '打开当日日记' : '创建当日日记') + '</button>' +
      '  </div>' +
      '  <div class="dl-head"><h2>' + U.escapeHtml(cn) + '</h2>' +
      '    <span class="hint">按日聚合日程、活动与笔记 · 日记本身是一篇普通笔记，随备份一起导出</span></div>' +
      '  <div class="dl-grid">' +
      '    <div class="dl-col"><div class="dl-col-h">日程 · ' + d.events.length + '</div>' + evHTML + '</div>' +
      '    <div class="dl-col"><div class="dl-col-h">当日活动 · ' + d.acts.length + '</div>' + actHTML + '</div>' +
      '    <div class="dl-col"><div class="dl-col-h">当天笔记 · ' + d.notes.length + '</div>' + noteHTML + '</div>' +
      '  </div>' +
      '  <div class="dl-summary">任务 ' + d.tasks.length + ' · 打卡 ' + d.habits.length +
      ' · 日记 ' + (d.daily ? '已创建' : '未创建') + '</div>' +
      '</div>';
  }

  function bindPanel(root, date) {
    const dateEl = root.querySelector('#dl-date');
    const cnEl = root.querySelector('#dl-date-cn');
    const sync = () => { const c = U.cnDate(dateEl.value); cnEl.textContent = c ? '当前选择：' + c : ''; };
    dateEl.addEventListener('input', () => { sync(); local.date = dateEl.value; L.app.refresh(); });
    dateEl.addEventListener('change', () => { sync(); local.date = dateEl.value; L.app.refresh(); });
    sync();
    root.querySelector('#dl-back').addEventListener('click', () => {
      if (L.modules.notes && L.modules.notes.showList) L.modules.notes.showList();
      L.app.refresh();
    });
    root.querySelector('#dl-open').addEventListener('click', () => open(local.date || date));
    root.querySelectorAll('[data-daily-note]').forEach((b) => {
      b.addEventListener('click', () => {
        if (L.modules.notes && L.modules.notes.open) L.modules.notes.open(b.getAttribute('data-daily-note'));
      });
    });
  }

  L.modules.daily = {
    TAG: TAG,
    isDaily: isDaily,
    dailyFor: dailyFor,
    dayData: dayData,
    ensureDaily: ensureDaily,
    open: open,
    go: go,
    renderPanel: renderPanel,
    bindPanel: bindPanel,
    getDate: () => local.date || U.todayStr(),
    setDate: (d) => { local.date = d; }
  };
})(window.LifeOS);
