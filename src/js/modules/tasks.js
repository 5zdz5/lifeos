/* =========================================================================
 * LifeOS · 任务待办模块
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;

  const PRIORITY = {
    high: { label: '高', cls: 'p-high' },
    medium: { label: '中', cls: 'p-medium' },
    low: { label: '低', cls: 'p-low' }
  };
  const STATUS = {
    todo: '待办',
    doing: '进行中',
    done: '已完成'
  };

  const local = { filter: 'all', search: '' };

  function tagsStr(tags) {
    return (tags || []).map((t) => '<span class="tag">#' + U.escapeHtml(t) + '</span>').join('');
  }

  function taskCard(t) {
    const p = PRIORITY[t.priority] || PRIORITY.medium;
    const overdue = t.due && t.status !== 'done' && t.due < U.todayStr();
    return '' +
      '<div class="task-card ' + (t.status === 'done' ? 'is-done' : '') + '" data-id="' + t.id + '">' +
      '  <button class="task-check ' + (t.status === 'done' ? 'checked' : '') + '" data-act="toggle" title="切换完成">' +
      (t.status === 'done' ? '✓' : '') + '</button>' +
      '  <div class="task-main">' +
      '    <div class="task-title">' + U.escapeHtml(t.title) + '</div>' +
      '    <div class="task-meta">' +
      '      <span class="badge ' + p.cls + '">' + p.label + '</span>' +
      (t.due ? '<span class="due' + (overdue ? ' overdue' : '') + '">▦ ' + U.fmtDate(t.due) + (overdue ? ' 逾期' : '') + '</span>' : '') +
      tagsStr(t.tags) +
      '    </div>' +
      '  </div>' +
      '  <div class="task-actions">' +
      '    <select class="mini-select" data-act="status">' +
      Object.keys(STATUS).map((k) => '<option value="' + k + '"' + (t.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>').join('') +
      '    </select>' +
      '    <button class="icon-btn" data-act="edit" title="编辑">✎</button>' +
      '    <button class="icon-btn danger" data-act="del" title="删除">×</button>' +
      '  </div>' +
      '</div>';
  }

  function render() {
    const tasks = S.state.tasks;
    const visible = tasks.filter((t) => {
      if (local.filter !== 'all' && t.status !== local.filter) return false;
      if (local.search) {
        const q = local.search.toLowerCase();
        const hay = (t.title + ' ' + (t.note || '') + ' ' + (t.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    const todos = visible.filter((t) => t.status !== 'done');
    const dones = visible.filter((t) => t.status === 'done');

    const counts = {
      all: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      done: tasks.filter((t) => t.status === 'done').length
    };

    return '' +
      '<div class="page">' +
      '  <div class="toolbar">' +
      '    <div class="filters">' +
      ['all', 'todo', 'doing', 'done'].map((f) =>
        '<button class="chip' + (local.filter === f ? ' active' : '') + '" data-filter="' + f + '">' +
        (f === 'all' ? '全部' : STATUS[f]) + ' <span class="count">' + counts[f] + '</span></button>'
      ).join('') +
      '    </div>' +
      '    <div class="spacer"></div>' +
      '    <input class="search" id="task-search" placeholder="搜索任务…" value="' + U.escapeHtml(local.search) + '"/>' +
      '    <button class="btn primary" id="add-task">+ 新建任务</button>' +
      '  </div>' +
      '  <div class="task-list">' +
      (todos.length ? '<div class="section-label">进行中 · ' + todos.length + '</div>' + todos.map(taskCard).join('') : '') +
      (dones.length ? '<div class="section-label">已完成 · ' + dones.length + '</div>' + dones.map(taskCard).join('') : '') +
      (visible.length === 0 ? '<div class="empty">还没有任务，先记下第一件要做的事吧。<button class="empty-state-btn" id="empty-new-task">＋ 新建任务</button></div>' : '') +
      '  </div>' +
      '</div>';
  }

  function openEditor(task) {
    const isNew = !task;
    const t = task || { title: '', note: '', priority: 'medium', status: 'todo', due: '', tags: [] };
    U.modal({
      title: isNew ? '新建任务' : '编辑任务',
      bodyHTML: '' +
        '<div class="form">' +
        '  <label>标题</label><input id="f-title" class="input" value="' + U.escapeHtml(t.title) + '" placeholder="要做什么？"/>' +
        '  <div class="form-row">' +
        '    <div><label>优先级</label><select id="f-priority" class="input">' +
        Object.keys(PRIORITY).map((k) => '<option value="' + k + '"' + (t.priority === k ? ' selected' : '') + '>' + PRIORITY[k].label + '优先级</option>').join('') +
        '    </select></div>' +
        '    <div><label>状态</label><select id="f-status" class="input">' +
        Object.keys(STATUS).map((k) => '<option value="' + k + '"' + (t.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>').join('') +
        '    </select></div>' +
        '    <div><label>截止日期</label><input id="f-due" class="input" type="date" lang="zh-CN" value="' + U.escapeHtml(t.due || '') + '"/><span class="form-hint">格式：年-月-日</span><span class="form-hint date-cn" id="f-due-cn"></span></div>' +
        '  </div>' +
        '  <label>标签（逗号分隔）</label><input id="f-tags" class="input" value="' + U.escapeHtml((t.tags || []).join(', ')) + '" placeholder="工作, 重要"/>' +
        '  <label>备注</label><textarea id="f-note" class="input" rows="3" placeholder="补充说明…">' + U.escapeHtml(t.note || '') + '</textarea>' +
        '  <div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
        '    <button class="btn primary" data-act="save">保存</button></div>' +
        '</div>',
      onMount(root, close) {
        const dueEl = root.querySelector('#f-due');
        const cnEl = root.querySelector('#f-due-cn');
        const syncCN = () => { const cn = U.cnDate(dueEl.value); cnEl.textContent = cn ? '当前选择：' + cn : ''; };
        dueEl.addEventListener('input', syncCN);
        dueEl.addEventListener('change', syncCN);
        syncCN();
        root.querySelector('[data-act="save"]').addEventListener('click', () => {
          const title = root.querySelector('#f-title').value.trim();
          if (!title) { U.toast('请填写标题', 'error'); return; }
          const tags = root.querySelector('#f-tags').value.split(',').map((s) => s.trim()).filter(Boolean);
          const patch = {
            title,
            priority: root.querySelector('#f-priority').value,
            status: root.querySelector('#f-status').value,
            due: root.querySelector('#f-due').value || null,
            tags,
            note: root.querySelector('#f-note').value
          };
          if (isNew) S.addTask(patch); else S.updateTask(t.id, patch);
          U.toast(isNew ? '已创建任务' : '已保存');
          close();
          L.app.refresh();
        });
        root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      }
    });
  }

  function bind(root) {
    root.querySelectorAll('[data-filter]').forEach((b) => {
      b.addEventListener('click', () => { local.filter = b.getAttribute('data-filter'); L.app.refresh(); });
    });
    const search = root.querySelector('#task-search');
    if (search) search.addEventListener('input', U.debounce(() => { local.search = search.value; L.app.refresh(); }, 250));

    root.querySelector('#add-task').addEventListener('click', () => openEditor(null));
    const emptyNew = root.querySelector('#empty-new-task');
    if (emptyNew) emptyNew.addEventListener('click', () => openEditor(null));

    root.querySelectorAll('.task-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      card.querySelector('[data-act="toggle"]').addEventListener('click', () => {
        const t = S.state.tasks.find((x) => x.id === id);
        S.updateTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
        L.app.refresh();
      });
      const statusSel = card.querySelector('[data-act="status"]');
      statusSel.addEventListener('change', () => { S.updateTask(id, { status: statusSel.value }); L.app.refresh(); });
      card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(S.state.tasks.find((x) => x.id === id)));
      card.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (await U.confirm('确定删除该任务？')) { S.removeTask(id); L.app.refresh(); }
      });
    });
  }

  /* 从总览点具体任务时定位并短暂高亮，而不是只跳到列表顶部 */
  function focusTask(id) {
    local.filter = 'all';
    local.search = '';
    // 自己保证切到任务视图，不依赖调用方先 showView
    if (L.app.current !== 'tasks') L.app.showView('tasks');
    else L.app.refresh();
    requestAnimationFrame(() => {
      const el = Array.prototype.slice.call(document.querySelectorAll('.task-card'))
        .find((x) => x.getAttribute('data-id') === id);
      if (!el) return;
      el.classList.add('task-focus');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => el.classList.remove('task-focus'), 2000);
    });
  }

  L.modules.tasks = { render, bind, focusTask };
})(window.LifeOS);
