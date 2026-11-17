/* =========================================================================
 * LifeOS · 日历月视图
 * 按日聚合任务截止 / 创建 / 完成、习惯打卡、笔记、AI 对话与用户日程。
 * 支持上/下月、回到今天、点击某天查看当日明细，并可手动新增/删除日程。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  const ST = L.stats;

  const today = new Date();
  const local = {
    year: today.getFullYear(),
    month: today.getMonth(),          // 0-11
    selected: U.todayStr()
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayKey() { return U.todayStr(); }

  /* 生成 6×7 网格（周一为每周第一天） */
  function buildGrid() {
    const first = new Date(local.year, local.month, 1);
    const startOffset = (first.getDay() + 6) % 7; // 周一=0
    const daysInMonth = new Date(local.year, local.month + 1, 0).getDate();
    const daysPrev = new Date(local.year, local.month, 0).getDate();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const slot = i - startOffset + 1;
      if (slot < 1) {
        const d = daysPrev + slot;
        const pm = local.month === 0 ? 11 : local.month - 1;
        const py = local.month === 0 ? local.year - 1 : local.year;
        cells.push({ key: dateKey(py, pm, d), day: d, other: true });
      } else if (slot > daysInMonth) {
        const d = slot - daysInMonth;
        const nm = local.month === 11 ? 0 : local.month + 1;
        const ny = local.month === 11 ? local.year + 1 : local.year;
        cells.push({ key: dateKey(ny, nm, d), day: d, other: true });
      } else {
        cells.push({ key: dateKey(local.year, local.month, slot), day: slot, other: false });
      }
    }
    return cells;
  }

  const TYPE_ICON = { task: '✓', done: '✔', due: '▦', habit: '◆', note: '✎', edit: '✎', ai: '◇', event: '◷' };
  const TYPE_LABEL = { task: '创建任务', done: '完成任务', due: '任务截止', habit: '习惯打卡', note: '新建笔记', edit: '编辑笔记', ai: 'AI 对话', event: '日程' };

  function dayEvents(key) {
    return (S.state.events || [])
      .filter((e) => e && e.date === key)
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }

  function eventHTML(e) {
    return '<div class="cal-event">' +
      '<span class="ce-time">' + U.escapeHtml(e.time || '全天') + '</span>' +
      '<span class="ce-main"><span class="ce-title">' + U.escapeHtml(e.title || '未命名日程') + '</span>' +
      (e.note ? '<span class="ce-note">' + U.escapeHtml(e.note) + '</span>' : '') + '</span>' +
      '<button class="ce-del" data-del-event="' + U.escapeHtml(e.id) + '" title="删除日程" aria-label="删除日程">×</button>' +
      '</div>';
  }

  function dayDetail(key) {
    const evs = dayEvents(key);
    // 活动聚合里已含 event，明细中过滤掉，避免和日程卡片重复显示
    const map = ST.activity();
    const items = ((map[key] && map[key].items) || []).filter((it) => it.type !== 'event');
    if (!evs.length && !items.length) {
      return '<div class="cal-empty">这一天还没有记录。点上方「＋ 添加日程」记一件事吧。</div>';
    }
    let html = '';
    if (evs.length) html += '<div class="cal-ev-head">日程 · ' + evs.length + '</div>' + evs.map(eventHTML).join('');
    if (items.length) {
      html += '<div class="cal-ev-head">当日活动</div>' + items.map((it) =>
        '<div class="cal-item"><span class="ci-icon">' + (TYPE_ICON[it.type] || '•') + '</span>' +
        '<span class="ci-label">' + U.escapeHtml(it.label) + '</span>' +
        '<span class="ci-type">' + (TYPE_LABEL[it.type] || it.type) + '</span></div>'
      ).join('');
    }
    return html;
  }

  /* 新增日程：让日历从「只读聚合」变成真正能记录的日历 */
  function openEventEditor(date) {
    U.modal({
      title: '新建日程',
      bodyHTML: '' +
        '<div class="form">' +
        '  <label>标题</label><input id="ev-title" class="input" placeholder="要做什么？"/>' +
        '  <div class="form-row">' +
        '    <div><label>日期</label><input id="ev-date" class="input" type="date" lang="zh-CN" value="' + U.escapeHtml(date) + '"/><span class="form-hint">格式：年-月-日</span><span class="form-hint date-cn" id="ev-date-cn"></span></div>' +
        '    <div><label>时间（可选）</label><input id="ev-time" class="input" type="time" value=""/></div>' +
        '  </div>' +
        '  <label>备注（可选）</label><textarea id="ev-note" class="input" rows="2" placeholder="补充说明…"></textarea>' +
        '  <div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
        '    <button class="btn primary" data-act="save">保存</button></div>' +
        '</div>',
      onMount(root, close) {
        const dateEl = root.querySelector('#ev-date');
        const cnEl = root.querySelector('#ev-date-cn');
        const syncCN = () => { const cn = U.cnDate(dateEl.value); cnEl.textContent = cn ? '当前选择：' + cn : ''; };
        dateEl.addEventListener('input', syncCN);
        dateEl.addEventListener('change', syncCN);
        syncCN();
        root.querySelector('[data-act="save"]').addEventListener('click', () => {
          const titleEl = root.querySelector('#ev-title');
          const title = titleEl.value.trim();
          if (!title) { U.toast('请填写日程标题', 'error'); titleEl.focus(); return; }
          const d = root.querySelector('#ev-date').value || date;
          S.addEvent({ date: d, title, time: root.querySelector('#ev-time').value, note: root.querySelector('#ev-note').value });
          local.selected = d;
          U.toast('日程已添加');
          close();
          L.app.refresh();
        });
        root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      }
    });
  }

  function render() {
    const map = ST.activity();
    const cells = buildGrid();
    const weekNames = ['一', '二', '三', '四', '五', '六', '日'];

    const heads = weekNames.map((w) => '<div class="cal-week">' + w + '</div>').join('');
    const grid = cells.map((c) => {
      const info = map[c.key];
      const cnt = info ? info.count : 0;
      const lv = ST.level(cnt);
      const types = info ? Array.from(new Set(info.items.map((i) => i.type))).slice(0, 3) : [];
      const dots = types.map((t) => '<i class="cal-dot d-' + t + '" title="' + (TYPE_LABEL[t] || t) + '"></i>').join('');
      const evN = dayEvents(c.key).length;
      const evDots = evN ? '<span class="cc-events">' + '<i></i>'.repeat(Math.min(evN, 3)) + '</span>' : '';
      const cls = 'cal-cell' +
        (c.other ? ' other' : '') +
        (c.key === todayKey() ? ' today' : '') +
        (c.key === local.selected ? ' selected' : '') +
        (cnt ? ' lv' + lv : '');
      return '' +
        '<button class="' + cls + '" data-date="' + c.key + '">' +
        '  <span class="cc-day">' + c.day + '</span>' +
        (cnt ? '<span class="cc-count">' + cnt + '</span>' : '') +
        '  <span class="cc-dots">' + dots + '</span>' +
        evDots +
        '</button>';
    }).join('');

    const selDate = new Date(local.selected + 'T00:00:00');
    const selLabel = isNaN(selDate.getTime()) ? local.selected :
      (selDate.getMonth() + 1) + '月' + selDate.getDate() + '日 · 周' + U.weekday(local.selected);

    return '' +
      '<div class="page cal-page">' +
      '  <div class="toolbar">' +
      '    <button class="btn ghost" id="cal-prev">‹ 上月</button>' +
      '    <button class="btn ghost" id="cal-today">今天</button>' +
      '    <button class="btn ghost" id="cal-next">下月 ›</button>' +
      '    <div class="cal-title">' + local.year + '年 ' + (local.month + 1) + '月</div>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn primary btn-xs" id="cal-new-event">＋ 新建日程</button>' +
      '    <div class="cal-legend"><span class="cl-l">少</span><i class="lg lg0"></i><i class="lg lg1"></i><i class="lg lg2"></i><i class="lg lg3"></i><i class="lg lg4"></i><span class="cl-l">多</span></div>' +
      '  </div>' +
      '  <div class="cal-wrap">' +
      '    <div class="cal-grid">' + heads + grid + '</div>' +
      '    <div class="cal-side">' +
      '      <div class="cs-head">' + U.escapeHtml(selLabel) + '</div>' +
      '      <div class="cs-actions">' +
      '        <button class="btn primary btn-xs cs-add" id="cal-add-event">＋ 添加日程</button>' +
      '        <button class="btn ghost btn-xs" id="cal-open-daily" title="查看/创建这一天的每日笔记">✎ 当日日记</button>' +
      '      </div>' +
      '      <div class="cs-body">' + dayDetail(local.selected) + '</div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function bind(root) {
    root.querySelector('#cal-prev').addEventListener('click', () => {
      local.month--; if (local.month < 0) { local.month = 11; local.year--; }
      L.app.refresh();
    });
    root.querySelector('#cal-next').addEventListener('click', () => {
      local.month++; if (local.month > 11) { local.month = 0; local.year++; }
      L.app.refresh();
    });
    root.querySelector('#cal-today').addEventListener('click', () => {
      const d = new Date();
      local.year = d.getFullYear(); local.month = d.getMonth(); local.selected = U.todayStr();
      L.app.refresh();
    });
    root.querySelectorAll('.cal-cell').forEach((c) => {
      c.addEventListener('click', () => { local.selected = c.getAttribute('data-date'); L.app.refresh(); });
    });
    const add = () => openEventEditor(local.selected);
    const toolbarAdd = root.querySelector('#cal-new-event');
    const sideAdd = root.querySelector('#cal-add-event');
    if (toolbarAdd) toolbarAdd.addEventListener('click', add);
    if (sideAdd) sideAdd.addEventListener('click', add);
    // W2 · B2：从日历某天直达每日笔记
    const dailyBtn = root.querySelector('#cal-open-daily');
    if (dailyBtn && L.modules.daily) {
      dailyBtn.addEventListener('click', () => L.modules.daily.go(local.selected));
    }
    root.querySelectorAll('[data-del-event]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (await U.confirm('删除这个日程？', '删除')) {
          S.removeEvent(btn.getAttribute('data-del-event'));
          L.app.refresh();
        }
      });
    });
  }

  /* 供热力图点击格子时跳转并选中某天 */
  function go(date) {
    const d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    local.year = d.getFullYear();
    local.month = d.getMonth();
    local.selected = date;
    L.app.showView('calendar');
  }

  L.modules.calendar = { render, bind, go };
})(window.LifeOS);
