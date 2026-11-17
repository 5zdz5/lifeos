/* =========================================================================
 * LifeOS · 习惯打卡模块
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;

  /* 计算连续打卡天数（含今天，向前数） */
  function streak(habit) {
    const c = habit.checkins || {};
    let n = 0;
    let d = new Date();
    while (true) {
      const off = d.getTimezoneOffset() * 60000;
      const key = new Date(d.getTime() - off).toISOString().slice(0, 10);
      if (c[key]) { n++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return n;
  }

  /* 近 30 天完成率 */
  function rate30(habit) {
    const c = habit.checkins || {};
    let done = 0;
    for (let i = 0; i < 30; i++) {
      if (c[U.dateStrOffset(i)]) done++;
    }
    return Math.round((done / 30) * 100);
  }

  function heatmap(habit) {
    let cells = '';
    for (let i = 29; i >= 0; i--) {
      const date = U.dateStrOffset(i);
      const on = (habit.checkins || {})[date];
      cells += '<button class="hm-cell' + (on ? ' on' : '') + '" data-date="' + date + '" title="' + date + (on ? ' · 已打卡' : '') + '" style="' + (on ? 'background:' + U.safeColor(habit.color) + ';border-color:' + U.safeColor(habit.color) + ';' : '') + '"></button>';
    }
    return '<div class="heatmap">' + cells + '</div>';
  }

  function habitCard(h) {
    const st = streak(h);
    const rt = rate30(h);
    const todayOn = (h.checkins || {})[U.todayStr()];
    return '' +
      '<div class="habit-card" data-id="' + U.escapeHtml(h.id) + '" style="--hc:' + U.safeColor(h.color) + '">' +
      '  <div class="habit-head">' +
      '    <span class="habit-emoji">' + U.escapeHtml(h.emoji || '◆') + '</span>' +
      '    <div class="habit-name">' + U.escapeHtml(h.name) + '</div>' +
      '    <button class="icon-btn" data-act="edit" title="编辑">✎</button>' +
      '    <button class="icon-btn danger" data-act="del" title="删除">×</button>' +
      '  </div>' +
      '  <div class="habit-stats">' +
      '    <div class="stat"><div class="stat-num">' + st + '</div><div class="stat-label">连续天数</div></div>' +
      '    <div class="stat"><div class="stat-num">' + rt + '%</div><div class="stat-label">30天完成率</div></div>' +
      '  </div>' +
      heatmap(h) +
      '  <button class="btn ' + (todayOn ? 'ghost' : 'primary') + ' checkin-btn" data-act="today">' +
      (todayOn ? '✓ 今日已打卡（点击取消）' : '今日打卡') + '</button>' +
      '</div>';
  }

  function render() {
    const habits = S.state.habits;
    return '' +
      '<div class="page">' +
      '  <div class="toolbar">' +
      '    <div class="page-sub">坚持微小习惯，积累长期复利 ◆</div>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn primary" id="add-habit">+ 新建习惯</button>' +
      '  </div>' +
      '  <div class="habit-grid">' +
      habits.map(habitCard).join('') +
      (habits.length === 0 ? '<div class="empty">还没有习惯，创建一个开始你的打卡之旅吧。<button class="empty-state-btn" id="empty-new-habit">＋ 新建习惯</button></div>' : '') +
      '  </div>' +
      '</div>';
  }

  function openEditor(habit) {
    const isNew = !habit;
    const h = habit || { name: '', emoji: '◆', color: '#176c6b' };
    U.modal({
      title: isNew ? '新建习惯' : '编辑习惯',
      bodyHTML: '' +
        '<div class="form">' +
        '  <div class="form-row">' +
        '    <div style="flex:0 0 72px"><label>图标</label><input id="f-emoji" class="input" value="' + U.escapeHtml(h.emoji || '◆') + '" maxlength="2" title="填 1 个字符作为图标"/>' +
        '      <span class="form-hint">1 个字符</span></div>' +
        '    <div style="flex:1"><label>名称</label><input id="f-name" class="input" value="' + U.escapeHtml(h.name) + '" placeholder="如：阅读 30 分钟"/></div>' +
        '  </div>' +
        '  <label>颜色</label><input id="f-color" class="input" type="color" value="' + U.escapeHtml(h.color || '#176c6b') + '"/>' +
        '  <span class="form-hint">默认是本应用主题色，点色条可自定义。</span>' +
        '  <div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
        '    <button class="btn primary" data-act="save">保存</button></div>' +
        '</div>',
      onMount(root, close) {
        root.querySelector('[data-act="save"]').addEventListener('click', () => {
          const name = root.querySelector('#f-name').value.trim();
          if (!name) { U.toast('请填写名称', 'error'); return; }
          const patch = { name, emoji: root.querySelector('#f-emoji').value || '◆', color: root.querySelector('#f-color').value };
          if (isNew) S.addHabit(patch); else S.updateHabit(h.id, patch);
          U.toast(isNew ? '已创建习惯' : '已保存');
          close();
          L.app.refresh();
        });
        root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      }
    });
  }

  function bind(root) {
    root.querySelector('#add-habit').addEventListener('click', () => openEditor(null));
    const emptyNew = root.querySelector('#empty-new-habit');
    if (emptyNew) emptyNew.addEventListener('click', () => openEditor(null));
    root.querySelectorAll('.habit-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      card.querySelector('[data-act="today"]').addEventListener('click', () => { S.toggleHabitCheckin(id, U.todayStr()); L.app.refresh(); });
      card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(S.state.habits.find((x) => x.id === id)));
      card.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (await U.confirm('确定删除该习惯？打卡记录将一并清除。')) { S.removeHabit(id); L.app.refresh(); }
      });
      card.querySelectorAll('.hm-cell').forEach((cell) => {
        cell.addEventListener('click', () => { S.toggleHabitCheckin(id, cell.getAttribute('data-date')); L.app.refresh(); });
      });
    });
  }

  L.modules.habits = { render, bind };
})(window.LifeOS);
