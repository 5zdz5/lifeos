/* =========================================================================
 * LifeOS · 全局统一检索核心（W2 · B4）
 *
 * 跨「笔记 / 知识库 / 任务 / 日程 / AI 对话 / 识海记忆」聚合命中。
 * 纯计算：只读取传入的 state 与 mindsea 快照，不改动任何数据、不依赖 DOM。
 * 识海侧不替换既有 ms-search，而是聚合它的结果（方案口径：做聚合而非替换）。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  function has(s, q) { return String(s == null ? '' : s).toLowerCase().indexOf(q) >= 0; }

  /* 生成命中上下文片段：优先截取关键词附近的文字 */
  function snippet(s, q, len) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    const n = len || 90;
    const i = t.toLowerCase().indexOf(q);
    if (i < 0) return t.slice(0, n);
    const start = Math.max(0, i - 24);
    return (start > 0 ? '…' : '') + t.slice(start, start + n) + (start + n < t.length ? '…' : '');
  }

  /* 主入口：searchAll(query, state, mindseaSnapshot)
   * 返回 [{ type, label, icon, title, snippet, view, id }]，按类型分组有序。 */
  function searchAll(query, state, mindsea) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    const st = state || {};
    const out = [];

    (st.notes || []).forEach((n) => {
      if (!n) return;
      const tags = (n.tags || []).join(' ');
      if (has(n.title, q) || has(n.body, q) || has(tags, q)) {
        out.push({ type: 'note', label: '笔记', icon: '✎', view: 'notes', id: n.id,
          title: n.title || '无标题笔记', snippet: snippet(n.body, q) });
      }
    });

    (st.library || []).forEach((x) => {
      if (!x) return;
      const points = Array.isArray(x.points) ? x.points.join(' ') : '';
      if (has(x.title, q) || has(x.summary, q) || has(points, q)) {
        out.push({ type: 'library', label: '知识库', icon: '▤', view: 'library', id: x.id,
          title: x.title || '未命名条目', snippet: snippet(x.summary || points, q) });
      }
    });

    (st.tasks || []).forEach((t) => {
      if (t && (has(t.title, q) || has(t.note, q))) {
        out.push({ type: 'task', label: '任务', icon: '✓', view: 'tasks', id: t.id,
          title: t.title || '无标题任务', snippet: snippet(t.note, q) });
      }
    });

    (st.events || []).forEach((e) => {
      if (e && (has(e.title, q) || has(e.note, q))) {
        out.push({ type: 'event', label: '日程', icon: '◷', view: 'calendar', id: e.id,
          title: e.title || '未命名日程', snippet: snippet((e.date || '') + ' ' + (e.note || ''), q) });
      }
    });

    (st.aiThread || []).forEach((m) => {
      if (m && has(m.content, q)) {
        out.push({ type: 'ai', label: 'AI 对话', icon: '◇', view: 'ai', id: null,
          title: m.role === 'user' ? '我：' + snippet(m.content, q, 40) : 'AI：' + snippet(m.content, q, 40),
          snippet: snippet(m.content, q) });
      }
    });

    // 识海快照：兼容 { memories: [...] } / { words: [...] } / 数组三种形态
    const ms = mindsea || {};
    const rows = Array.isArray(ms) ? ms :
      (Array.isArray(ms.memories) ? ms.memories : (Array.isArray(ms.words) ? ms.words : []));
    rows.forEach((r) => {
      if (r && has(r.text, q)) {
        out.push({ type: 'mindsea', label: '识海记忆', icon: '◉', view: 'mindsea', id: r.id || null,
          title: snippet(r.text, q, 46), snippet: snippet((r.at ? r.at + ' · ' : '') + r.text, q) });
      }
    });

    // 稳定性：按类型固定顺序 + 组内保持原顺序，避免结果跳动
    const order = { note: 0, library: 1, task: 2, event: 3, ai: 4, mindsea: 5 };
    out.sort((a, b) => (order[a.type] - order[b.type]));
    return out;
  }

  /* 分组统计，供面板头部显示「笔记 3 · 知识库 1 · 识海 2」 */
  function groupCounts(results) {
    const m = {};
    (results || []).forEach((r) => { m[r.label] = (m[r.label] || 0) + 1; });
    return m;
  }

  /* 高亮关键词（返回已转义的安全 HTML，调用方直接 innerHTML 用）。
   * 按关键词把原文切成「普通段 / 命中段」，逐段 escapeHtml 后再拼装，
   * 保证关键词含 < > & 等特殊字符时也不会破坏 HTML 或注入脚本。 */
  function highlight(text, query) {
    const esc = (L.utils && L.utils.escapeHtml) ? L.utils.escapeHtml :
      ((s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const t = String(text == null ? '' : text);
    const q = String(query == null ? '' : query).trim();
    if (!q) return esc(t.slice(0, 120));
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t.slice(0, 120));
    const from = Math.max(0, i - 24);
    const raw = (from > 0 ? '…' : '') + t.slice(from, from + 120);
    const lower = raw.toLowerCase(), needle = q.toLowerCase();
    let pos = 0, at, out = '';
    while ((at = lower.indexOf(needle, pos)) >= 0) {
      out += esc(raw.slice(pos, at)) + '<mark>' + esc(raw.slice(at, at + q.length)) + '</mark>';
      pos = at + q.length;
    }
    out += esc(raw.slice(pos));
    return out;
  }

  L.search = { searchAll: searchAll, groupCounts: groupCounts, highlight: highlight, snippet: snippet };
})(window.LifeOS);
