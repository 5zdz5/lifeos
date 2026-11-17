/* =========================================================================
 * LifeOS · 双向链接核心（Obsidian 风格 [[Wiki Links]]）
 * 只做索引计算，不改动数据；任何模块都可调用 L.links。
 * 语法： [[笔记标题]]  或  [[笔记标题|显示文本]]
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function targetOf(inner) { return String(inner).split('|')[0].trim(); }
  function labelOf(inner) { const p = String(inner).split('|'); return (p[1] || p[0]).trim(); }

  /* 提取正文中所有链接目标（去重，保持出现顺序） */
  function extract(body) {
    const out = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(body || '')) !== null) {
      const t = targetOf(m[1]);
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  }

  /* 按标题解析到真实笔记（不区分大小写、忽略首尾空格） */
  function resolve(title) {
    const n = norm(title);
    if (!n) return null;
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    for (let i = 0; i < notes.length; i++) {
      if (norm(notes[i].title) === n) return notes[i];
    }
    return null;
  }

  /* 出链： [{ title, note|null }] */
  function outbound(note) {
    return extract(note.body).map((t) => ({ title: t, note: resolve(t) }));
  }

  /* 反向链接：哪些笔记链向了当前笔记 */
  function backlinks(note) {
    const n = norm(note.title);
    if (!n) return [];
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    return notes.filter((x) => x.id !== note.id && extract(x.body).some((t) => norm(t) === n));
  }

  /* 所有链接边 */
  function edges() {
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    const res = [];
    notes.forEach((from) => {
      extract(from.body).forEach((t) => res.push({ from: from, toTitle: t, to: resolve(t) }));
    });
    return res;
  }

  /* 图谱数据：真实笔记节点 + 未创建的虚拟节点 + 边（用节点下标表示） */
  function graph() {
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    const nodes = notes.map((n) => ({ id: n.id, title: n.title, real: true }));
    const idx = {};
    nodes.forEach((n, i) => { idx[norm(n.title)] = i; });

    edges().forEach((e) => {
      if (!e.to) {
        const k = norm(e.toTitle);
        if (!(k in idx)) {
          idx[k] = nodes.length;
          nodes.push({ id: 'v:' + k, title: e.toTitle, real: false });
        }
      }
    });

    const links = edges()
      .map((e) => ({ s: idx[norm(e.from.title)], t: idx[norm(e.toTitle)] }))
      .filter((l) => l.s !== undefined && l.t !== undefined && l.s !== l.t);
    return { nodes: nodes, links: links };
  }

  /* 孤立笔记（既没有出链也没有入链） */
  function orphans() {
    const es = edges();
    const touched = {};
    es.forEach((e) => { touched[e.from.id] = true; if (e.to) touched[e.to.id] = true; });
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    return notes.filter((n) => !touched[n.id]);
  }

  /* ---------------- W2 · B1 反链上下文 / 未链接提及 / B3 安全重命名 ---------------- */

  /* 反链上下文：不只是「谁链了我」，还给出引用所在原文行（Obsidian 式）。
   * 返回 [{ note, snippets: [原文行…] }]，只保留真正含该 wikilink 的笔记。 */
  function backlinkContexts(note) {
    const n = norm(note.title);
    if (!n) return [];
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    return notes.filter((x) => x.id !== note.id).map((x) => {
      const lines = String(x.body || '').split('\n');
      const snippets = lines.filter((line) => {
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (norm(targetOf(m[1])) === n) return true;
        }
        return false;
      }).map((s) => s.trim()).filter(Boolean).slice(0, 3);
      return { note: x, snippets: snippets };
    }).filter((b) => b.snippets.length > 0);
  }

  /* 未链接提及：正文里出现了当前笔记标题，但没有被 [[ ]] 包住。
   * 先剥离所有 wikilink 再找纯文本，避免把已有链接重复计入。 */
  function unlinkedMentions(note) {
    const n = norm(note.title);
    if (n.length < 2) return [];
    const notes = (L.store && L.store.state && L.store.state.notes) || [];
    return notes.filter((x) => {
      if (x.id === note.id) return false;
      const plain = String(x.body || '').replace(/\[\[([^\]]+)\]\]/g, '');
      return plain.toLowerCase().indexOf(n) >= 0;
    }).map((x) => {
      const lines = String(x.body || '').replace(/\[\[([^\]]+)\]\]/g, '').split('\n');
      const hit = lines.find((l) => l.toLowerCase().indexOf(n) >= 0) || '';
      return { note: x, snippet: hit.trim().slice(0, 120) };
    });
  }

  /* 把纯文本里第一次出现的标题包成 [[链接]]（用于「一键转链接」）。
   * 先标记所有 [[ ]] 区间，再在第一个「区间外」的命中处插入，避免破坏已有链接。 */
  function linkifyFirst(body, title) {
    const s = String(body || '');
    const t = String(title || '').trim();
    if (!t) return { body: s, count: 0 };
    const lower = s.toLowerCase(), needle = t.toLowerCase();
    const ranges = [];
    const re = /\[\[[^\]]*\]\]/g;
    let m;
    while ((m = re.exec(s)) !== null) ranges.push([m.index, m.index + m[0].length]);
    const inside = (i) => ranges.some((r) => i >= r[0] && i < r[1]);
    let at = -1, from = 0;
    while ((at = lower.indexOf(needle, from)) >= 0) {
      if (!inside(at)) break;
      from = at + 1;
      at = -1;
    }
    if (at < 0) return { body: s, count: 0 };
    return { body: s.slice(0, at) + '[[' + t + ']]' + s.slice(at + t.length), count: 1 };
  }

  /* 单篇正文内批量改写 wikilink 目标：[[旧]] / [[旧|别名]] → [[新]] / [[新|别名]]。
   * 别名保留；大小写/空格不敏感匹配；同名不改写。纯函数，不碰 state。 */
  function rewriteLinks(body, from, to) {
    const a = norm(from), b = String(to == null ? '' : to);
    if (!a || a === norm(b)) return { body: String(body || ''), count: 0 };
    let count = 0;
    const out = String(body || '').replace(/\[\[([^\]]+)\]\]/g, (m, inner) => {
      const p = inner.split('|');
      if (norm(p[0]) !== a) return m;
      count++;
      return '[[' + b + (p.length > 1 ? '|' + p.slice(1).join('|') : '') + ']]';
    });
    return { body: out, count: count };
  }

  /* 安全重命名：笔记改标题后，把所有指向旧标题的链接同步改写（对齐 obsidian-cli move）。
   * 直接改 state.notes 的 body，返回改动统计；由调用方统一 persist。 */
  function renameNoteLinks(state, noteId, oldTitle, newTitle) {
    let changed = 0;
    const touched = [];
    (state.notes || []).forEach((n) => {
      if (!n || n.id === noteId) return;
      const r = rewriteLinks(n.body, oldTitle, newTitle);
      if (r.count) {
        n.body = r.body;
        n.updatedAt = Date.now();
        changed += r.count;
        touched.push(n.id);
      }
    });
    return { changed: changed, touched: touched };
  }

  L.links = {
    norm: norm, targetOf: targetOf, labelOf: labelOf,
    extract: extract, resolve: resolve, outbound: outbound,
    backlinks: backlinks, edges: edges, graph: graph, orphans: orphans,
    backlinkContexts: backlinkContexts, unlinkedMentions: unlinkedMentions,
    linkifyFirst: linkifyFirst, rewriteLinks: rewriteLinks, renameNoteLinks: renameNoteLinks
  };
})(window.LifeOS);
