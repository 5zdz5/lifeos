/* =========================================================================
 * LifeOS · 全局检索面板 UI（W2 · B4）
 *
 * 顶栏按钮或 Ctrl/Cmd+K 打开。聚合 L.search.searchAll 的跨实体结果，
 * 识海侧通过 L.mindsea.exportData() 拿本机原话快照（只读，不改动识海）。
 * 不新增导航视图、不替换既有 ms-search / note-search。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;

  let cachedMindsea = null;

  async function mindseaSnapshot() {
    try {
      if (!L.mindsea || !L.mindsea.exportData) return [];
      const d = await L.mindsea.exportData();
      cachedMindsea = (d && d.data && d.data.memories) || [];
      return cachedMindsea;
    } catch (e) { return cachedMindsea || []; }
  }

  function resultHTML(results, q) {
    if (!q) return '<div class="gs-idle">输入关键词，检索笔记 · 知识库 · 任务 · 日程 · AI 对话 · 识海记忆</div>';
    if (!results.length) return '<div class="gs-empty">没有找到「' + U.escapeHtml(q) + '」相关内容</div>';
    let lastType = null, html = '';
    results.forEach((r, i) => {
      if (r.type !== lastType) {
        html += '<div class="gs-group">' + U.escapeHtml(r.icon + ' ' + r.label) + '</div>';
        lastType = r.type;
      }
      html += '<button class="gs-item" data-gs-i="' + i + '">' +
        '  <div class="gs-item-t">' + L.search.highlight(r.title, q) + '</div>' +
        '  <div class="gs-item-s">' + L.search.highlight(r.snippet, q) + '</div>' +
        '</button>';
    });
    return html;
  }

  function open() {
    const close = U.modal({
      title: '全局检索',
      wide: true,
      bodyHTML: '' +
        '<div class="gs-wrap">' +
        '  <input id="gs-input" class="input gs-input" placeholder="搜索全部内容…（Ctrl/⌘ + K）" autocomplete="off"/>' +
        '  <div class="gs-meta" id="gs-meta"></div>' +
        '  <div class="gs-results" id="gs-results"></div>' +
        '</div>',
      onMount(mRoot) {
        const input = mRoot.querySelector('#gs-input');
        const box = mRoot.querySelector('#gs-results');
        const meta = mRoot.querySelector('#gs-meta');
        let latest = [];
        const run = () => {
          const q = input.value.trim();
          latest = L.search.searchAll(q, S.state, cachedMindsea || []);
          box.innerHTML = resultHTML(latest, q);
          const counts = L.search.groupCounts(latest);
          meta.textContent = q
            ? ('共 ' + latest.length + ' 条 · ' + (Object.keys(counts).map((k) => k + ' ' + counts[k]).join(' · ') || '—'))
            : '按类型分组，点击结果跳转到对应视图';
          box.querySelectorAll('.gs-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              const r = latest[Number(btn.getAttribute('data-gs-i'))];
              if (!r) return;
              close();
              if (r.type === 'note' && L.modules.notes && L.modules.notes.open) L.modules.notes.open(r.id);
              else if (r.type === 'event' && L.modules.calendar && L.modules.calendar.go) {
                const ev = (S.state.events || []).find((e) => e.id === r.id);
                L.modules.calendar.go(ev ? ev.date : U.todayStr());
              } else L.app.showView(r.view);
            });
          });
        };
        input.addEventListener('input', U.debounce(run, 120));
        run();
        // 识海快照异步到位后再刷新一次（首次打开时可能还没缓存）
        mindseaSnapshot().then(() => { if (input.value.trim()) run(); });
      }
    });
    return close;
  }

  L.modules.search = { open: open, resultHTML: resultHTML, mindseaSnapshot: mindseaSnapshot };
})(window.LifeOS);
