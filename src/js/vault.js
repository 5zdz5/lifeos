/* =========================================================================
 * LifeOS · Markdown Vault 互通（W2 · B3）
 *
 * 纯文本优先：笔记可以导出为带 YAML frontmatter 的 .md，也可以从 .md 导入。
 * 本模块是自包含纯函数，不依赖 DOM / store，便于单测与桌面端复用。
 *
 * 安全：导入的文本一律视为不可信，先去掉控制字符、限长；危险协议交给
 * 渲染层 U.safeUrl / U.escapeHtml 与 store 的 cleanEntity 两道防线。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  function cleanText(v, max) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .slice(0, max || 200000);
  }

  function yamlQuote(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/[\r\n]/g, ' ').slice(0, 500) + '"';
  }
  function yamlUnquote(s) {
    const t = String(s || '').trim();
    if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
      return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return t.replace(/^['"]|['"]$/g, '');
  }

  /* 单篇笔记 → .md 文本（frontmatter: title / tags / created / updated） */
  function noteToMarkdown(note) {
    const n = note || {};
    const title = cleanText(n.title || '无标题笔记', 200);
    const tags = Array.isArray(n.tags) ? n.tags.map((t) => cleanText(t, 60)) : [];
    const lines = ['---', 'title: ' + yamlQuote(title)];
    if (tags.length) lines.push('tags: [' + tags.map(yamlQuote).join(', ') + ']');
    if (n.createdAt) lines.push('created: ' + new Date(n.createdAt).toISOString());
    if (n.updatedAt) lines.push('updated: ' + new Date(n.updatedAt).toISOString());
    lines.push('---', '', '# ' + title, '', cleanText(n.body || ''));
    return lines.join('\n');
  }

  /* .md 文本 → 笔记数据（不含 id / 时间戳，交给 store.addNote 补齐）。
   * 兼容两种来源：① 本应用导出的 frontmatter ② 普通 .md（取首个 # 标题或文件名）。 */
  function markdownToNote(text, filename) {
    const raw = cleanText(text).replace(/\r\n/g, '\n');
    let body = raw, title = '', tags = [];
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    if (fm) {
      body = raw.slice(fm[0].length);
      fm[1].split('\n').forEach((l) => {
        const mt = /^title:\s*(.*)$/.exec(l);
        if (mt) title = yamlUnquote(mt[1]);
        const tg = /^tags:\s*\[(.*)\]\s*$/.exec(l);
        if (tg) tags = tg[1].split(',').map(yamlUnquote).filter(Boolean);
      });
    }
    const h = /^#\s+(.+)$/m.exec(body);
    if (h) {
      if (!title) title = h[1].trim();
      body = body.replace(h[0], '').replace(/^\n+/, '');
    }
    if (!title) title = String(filename || '').replace(/\.md$/i, '').trim() || '导入的笔记';
    return {
      title: cleanText(title, 200),
      body: cleanText(body.trim(), 200000),
      tags: tags.slice(0, 50).map((t) => cleanText(t, 60))
    };
  }

  /* 全库导出：{ filename, content }[]，文件名做安全化（去路径分隔与危险字符） */
  function safeFilename(title, used) {
    let base = String(title || '无标题笔记')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ').trim().slice(0, 60) || '笔记';
    let name = base + '.md', i = 2;
    const seen = used || Object.create(null);
    while (seen[name]) { name = base + '-' + (i++) + '.md'; }
    seen[name] = true;
    return name;
  }

  function exportNotes(notes) {
    const used = Object.create(null);
    return (notes || []).map((n) => ({
      filename: safeFilename(n && n.title, used),
      content: noteToMarkdown(n)
    }));
  }

  L.vault = {
    noteToMarkdown: noteToMarkdown,
    markdownToNote: markdownToNote,
    exportNotes: exportNotes,
    safeFilename: safeFilename
  };
})(window.LifeOS);
