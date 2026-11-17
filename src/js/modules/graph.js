/* =========================================================================
 * LifeOS · 知识图谱（Obsidian Graph View 风格）
 * 用轻量力导向布局绘制 [[双向链接]] 关系；点击节点打开对应笔记。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  const LK = L.links;

  const W = 900, H = 560;

  /* 概念 3：知识小屋布局。把节点沿「屋顶 + 墙 + 地基」的坐标放置，
   * 让内化出来的卡片在画布上真的长成一间屋子。纯坐标分配，不改数据结构。 */
  const layoutMode = { value: 'force' }; // 'force' | 'house'
  function houseLayout(nodes) {
    const n = nodes.length;
    // 小屋轮廓：屋顶顶点 → 屋檐两端 → 左右墙 → 地基，按序循环铺开
    const slots = [];
    const cx = W / 2;
    slots.push([cx, 80]);                         // 屋顶尖
    slots.push([cx - 150, 190], [cx + 150, 190]); // 屋檐
    slots.push([cx - 210, 300], [cx + 210, 300]); // 墙外沿
    slots.push([cx - 140, 430], [cx, 470], [cx + 140, 430]); // 地基
    slots.push([cx - 80, 250], [cx + 80, 250]);   // 窗
    slots.push([cx - 60, 360], [cx + 60, 360]);   // 门侧
    if (n > slots.length) {
      // 超出轮廓的节点：沿地基下方均匀补充第二排
      for (let i = slots.length; i < n; i++) {
        const k = i - slots.length;
        slots.push([cx - 240 + (k % 8) * 68, 500 + Math.floor(k / 8) * 34]);
      }
    }
    nodes.forEach((v, i) => {
      const s = slots[i % slots.length];
      v.x = s[0]; v.y = s[1];
    });
    return nodes;
  }

  /* 轻量力导向：初始环形 + 若干次迭代（斥力 / 弹簧 / 向心） */
  function layout(nodes, links) {
    const n = nodes.length;
    const cx = W / 2, cy = H / 2;
    nodes.forEach((v, i) => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2;
      const r = 150 + (n > 12 ? 60 : 0);
      v.x = cx + Math.cos(a) * r;
      v.y = cy + Math.sin(a) * r;
      v.vx = 0; v.vy = 0;
    });
    const ITER = 160;
    for (let it = 0; it < ITER; it++) {
      // 斥力
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      // 弹簧
      links.forEach((l) => {
        const a = nodes[l.s], b = nodes[l.t];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 130) * 0.012;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      });
      // 向心 + 阻尼 + 边界
      nodes.forEach((v) => {
        v.vx += (cx - v.x) * 0.0022;
        v.vy += (cy - v.y) * 0.0022;
        v.vx *= 0.82; v.vy *= 0.82;
        v.x += v.vx; v.y += v.vy;
        v.x = Math.max(70, Math.min(W - 70, v.x));
        v.y = Math.max(40, Math.min(H - 40, v.y));
      });
    }
  }

  function render() {
    const g = LK.graph();
    const eCount = g.links.length;
    const orphanCount = LK.orphans().length;

    if (g.nodes.length === 0) {
      return '' +
        '<div class="page graph-page">' +
        '  <div class="toolbar"><div class="page-sub">知识图谱 · 用 [[双向链接]] 把笔记连成网络 ◇</div></div>' +
        '  <div class="empty">还没有笔记。写几篇并在正文里用 [[标题]] 互相链接，图谱就会出现。<button class="empty-state-btn" data-go="notes">去写笔记 →</button></div>' +
        '</div>';
    }

    // 概念 3：按模式选布局。小屋模式让卡片长成屋子；力导向为默认探索视图。
    if (layoutMode.value === 'house') houseLayout(g.nodes);
    else layout(g.nodes, g.links);
    const virtualCount = g.nodes.filter((v) => !v.real).length;

    const lines = g.links.map((l) => {
      const a = g.nodes[l.s], b = g.nodes[l.t];
      /* W3：把真实边长写成 CSS 变量，供 stroke-dashoffset 生长动画使用；
       * 交错序号 --motion-i 由 bind() 统一用 U.stagger 写入 */
      const len = Math.max(1, Math.round(Math.sqrt(
        (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))));
      return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
        '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
        '" class="g-edge" style="--g-len:' + len + '"/>';
    }).join('');

    const dots = g.nodes.map((v) => {
      const r = v.real ? 11 : 7;
      const label = v.title.length > 12 ? v.title.slice(0, 12) + '…' : v.title;
      const attrs = v.real
        ? 'class="g-node real" data-open="' + U.escapeHtml(v.id) + '"'
        : 'class="g-node virtual" data-wiki="' + U.escapeHtml(v.title) + '"';
      return '' +
        '<g ' + attrs + ' transform="translate(' + v.x.toFixed(1) + ',' + v.y.toFixed(1) + ')">' +
        '  <circle r="' + r + '"/>' +
        '  <text y="' + (r + 15) + '" text-anchor="middle">' + U.escapeHtml(label) + '</text>' +
        '</g>';
    }).join('');

    return '' +
      '<div class="page graph-page">' +
      '  <div class="toolbar">' +
      '    <div class="page-sub">知识图谱 · 点击节点打开笔记 ◇</div>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn ghost' + (layoutMode.value === 'house' ? ' on' : '') + '" id="graph-house" ' +
      'title="让知识卡片连成一间小屋（概念 3）">⌂ 知识小屋</button>' +
      '    <button class="btn ghost" id="graph-relayout">↻ 重新布局</button>' +
      '  </div>' +
      (layoutMode.value === 'house'
        ? '  <div class="house-note">⌂ 小屋布局：每篇笔记是一张卡片，连线勾勒出屋顶与墙。回到「知识库」点「吞入内化」会让新卡片自动连进来。</div>'
        : '') +
      '  <div class="graph-stats">' +
      '    <div class="gs"><b data-count="' + g.nodes.filter((v) => v.real).length + '">' + g.nodes.filter((v) => v.real).length + '</b><span>笔记</span></div>' +
      '    <div class="gs"><b data-count="' + eCount + '">' + eCount + '</b><span>链接</span></div>' +
      '    <div class="gs"><b data-count="' + orphanCount + '">' + orphanCount + '</b><span>孤立笔记</span></div>' +
      '    <div class="gs"><b data-count="' + virtualCount + '">' + virtualCount + '</b><span>待创建</span></div>' +
      '  </div>' +
      '  <div class="graph-canvas' + (layoutMode.value === 'house' ? ' house-mode' : '') + '"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      lines + dots +
      '  </svg></div>' +
      '  <div class="graph-tip">实线圆 = 已有笔记；虚线圆 = [[链接]] 指向但尚未创建的笔记，点击即可创建。</div>' +
      '</div>';
  }

  function bind(root) {
    const btn = root.querySelector('#graph-relayout');
    if (btn) btn.addEventListener('click', () => L.app.refresh());
    const houseBtn = root.querySelector('#graph-house');
    if (houseBtn) houseBtn.addEventListener('click', () => {
      layoutMode.value = layoutMode.value === 'house' ? 'force' : 'house';
      if (layoutMode.value === 'house' && L.pet) L.pet.observe('house'); // 行为沉淀
      if (L.app) L.app.refresh();
    });
    root.querySelectorAll('.g-node').forEach((g) => {
      g.addEventListener('click', () => {
        if (g.hasAttribute('data-open')) L.modules.notes.open(g.getAttribute('data-open'));
        else L.modules.notes.openByTitle(g.getAttribute('data-wiki'));
      });
    });

    /* W3 · 节点与边的交错入场统一由 U.stagger 驱动，节奏与热力图一致；
     * 统计数字为权威数据，只做统一淡入（见 finesse.css W3 段）。 */
    if (U.stagger) {
      U.stagger(root.querySelectorAll('.graph-canvas .g-edge'), 22);
      U.stagger(root.querySelectorAll('.graph-canvas .g-node'), 22);
    }
  }

  L.modules.graph = { render, bind };
})(window.LifeOS);
