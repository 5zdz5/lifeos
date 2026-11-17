/* =========================================================================
 * LifeOS · 知识库模块（本地存储 / 联网采集 / 可转笔记）
 *
 * - 全部条目存于本机 localStorage，断网可看、可搜、可编辑
 * - 联网只发生在用户主动点「联网采集 / 刷新」时
 * - 三条采集通道：AI 主题、网址、粘贴正文；失败原因直接显示在弹窗里
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;
  const U = L.utils;
  const S = L.store;
  const CP = L.capture;

  const local = { search: '', tag: '', refreshMsg: '' };

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function srcIcon(t) {
    return t === 'ai' ? '◇' : (t === 'url' || t === 'public') ? '◎' : '✎';
  }

  function allTags() {
    const set = Object.create(null);
    (S.state.library || []).forEach((it) => (it.tags || []).forEach((t) => { set[t] = true; }));
    return Object.keys(set).sort();
  }

  function cardHTML(it) {
    const src = it.source || {};
    const points = (it.points || []).length
      ? '<ul class="kb-points">' + it.points.map((p) => '<li>' + U.escapeHtml(p) + '</li>').join('') + '</ul>'
      : '';
    const tags = (it.tags || []).map((t) => '<span class="tag">#' + U.escapeHtml(t) + '</span>').join('');
    const urlPart = src.url
      ? ' <a class="kb-src-url" href="' + U.escapeHtml(U.safeUrl(src.url)) + '" target="_blank" rel="noopener" title="打开来源">↗</a>'
      : '';
    return '' +
      '<div class="kb-card" data-id="' + U.escapeHtml(it.id) + '">' +
      '  <div class="kb-card-top">' +
      '    <div class="kb-title">' + U.escapeHtml(it.title) +
      (L.seedLibrary && L.seedLibrary.isSeedItem(it) ? ' <span class="kb-seed" title="应用内置示例内容">示例</span>' : '') + '</div>' +
      '    <span class="kb-type" title="来源类型">' + srcIcon(src.type) + '</span>' +
      '  </div>' +
      '  <div class="kb-summary">' + U.escapeHtml(it.summary || '') + '</div>' +
      points +
      '  <div class="kb-tags">' + tags + '</div>' +
      '  <div class="kb-src">' + U.escapeHtml(src.label || '本地') + ' · ' + fmtTime(src.fetchedAt || it.createdAt) + urlPart + '</div>' +
      '  <div class="kb-ops">' +
      '    <button class="btn ghost btn-xs" data-act="internalize" title="吞噬内化：转成带 [[双向链接]] 的卡片笔记">' +
      (it.internalNoteId ? '◈ 查看卡片' : '◈ 吞入内化') + '</button>' +
      '    <button class="btn ghost btn-xs" data-act="note">' + (it.noteId ? '✎ 查看笔记' : '✎ 转为笔记') + '</button>' +
      '    <button class="btn ghost btn-xs danger" data-act="del">删除</button>' +
      '  </div>' +
      '</div>';
  }

  function render() {
    const all = S.state.library || [];
    const q = local.search.trim().toLowerCase();
    const list = all.filter((it) => {
      if (local.tag && !(it.tags || []).includes(local.tag)) return false;
      if (!q) return true;
      const hay = [it.title, it.summary, (it.points || []).join(' '), (it.tags || []).join(' '), (it.source || {}).label, it.raw].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });

    const aiCount = all.filter((x) => (x.source || {}).type === 'ai').length;
    const webCount = all.filter((x) => { const t = (x.source || {}).type; return t === 'url' || t === 'public'; }).length;
    const tags = allTags();
    const seedN = (L.seedLibrary && L.seedLibrary.count) ? L.seedLibrary.count(S) : 0;

    return '' +
      '<div class="page kb-page">' +
      '  <div class="kb-stat">' +
      '    <span><b>' + all.length + '</b> 条知识' + (seedN ? '（含 ' + seedN + ' 条示例）' : '') + '</span>' +
      '    <span>◇ AI 整理 ' + aiCount + '</span>' +
      '    <span>◎ 外部采集 ' + webCount + '</span>' +
      '    <span class="kb-local">▣ 全部存于本机</span>' +
      '  </div>' +
      (seedN ? '<div class="kb-seed-note">◇ 其中 <b>' + seedN + '</b> 条是应用内置的示例内容，不是你添加的；清除后不会自动灌回。' +
        '<div class="spacer"></div><button class="btn ghost btn-xs" id="kb-clear-seed">清除示例内容</button></div>' : '') +
      '  <div class="toolbar kb-toolbar">' +
      '    <input class="search" id="kb-search" placeholder="搜索标题 / 要点 / 标签 / 来源…" value="' + U.escapeHtml(local.search) + '"/>' +
      '    <select class="input kb-tag-sel" id="kb-tag">' +
      '      <option value="">全部标签</option>' +
      tags.map((t) => '<option value="' + U.escapeHtml(t) + '"' + (local.tag === t ? ' selected' : '') + '>#' + U.escapeHtml(t) + '</option>').join('') +
      '    </select>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn ghost" id="kb-refresh">↻ 刷新源</button>' +
      '    <button class="btn primary" id="kb-add">＋ 联网采集</button>' +
      '  </div>' +
      (local.refreshMsg ? '<div class="kb-notice">' + U.escapeHtml(local.refreshMsg) + '</div>' : '') +
      '  <div class="kb-grid">' + list.map(cardHTML).join('') +
      (list.length === 0
        ? '<div class="empty">没有匹配的知识条目。可以点「＋ 联网采集」抓取外部内容，或 <button class="link-btn" id="kb-reseed">载入内置示例内容</button>。</div>'
        : '') +
      '  </div>' +
      '</div>';
  }

  /* ---------- 采集弹窗 ---------- */
  function openCapture() {
    const connected = !!S.state.settings.aiKey;
    let tab = 'topic';

    const bodyHTML = '' +
      '<div class="kb-tabs">' +
      '  <button class="kb-tab active" data-tab="topic">◇ AI 主题</button>' +
      '  <button class="kb-tab" data-tab="url">◎ 网址</button>' +
      '  <button class="kb-tab" data-tab="paste">✎ 粘贴正文</button>' +
      '</div>' +
      '<div class="kb-pane" data-pane="topic">' +
      '  <div class="form">' +
      '    <label>输入一个主题，交给 AI 整理成结构化知识卡片</label>' +
      '    <input id="kb-topic" class="input" placeholder="如：番茄工作法 / 如何做周复盘 / 间隔重复"/>' +
      '    <p class="hint">调用「设置」里的 OpenAI 兼容接口，模型输出严格 JSON，前端解析后存入本机。' +
      (connected ? '当前 <b>已配置 Key</b>。' : '<b>当前未配置 Key</b>，此通道暂不可用；可先用「粘贴正文」。') + '</p>' +
      '  </div>' +
      '</div>' +
      '<div class="kb-pane" data-pane="url" hidden>' +
      '  <div class="form">' +
      '    <label>公开接口 / 网页地址（需允许跨域）</label>' +
      '    <input id="kb-url" class="input" placeholder="https://v1.hitokoto.cn/?c=k&encode=json"/>' +
      '    <p class="hint">浏览器受 CORS 限制，抓不了不开放跨域的普通网页；被拒绝时会明确告诉你原因。' +
      '实测可直接抓 <code>v1.hitokoto.cn</code> 这类公开接口。</p>' +
      '  </div>' +
      '</div>' +
      '<div class="kb-pane" data-pane="paste" hidden>' +
      '  <div class="form">' +
      '    <label>标题（可留空，自动从正文提取）</label>' +
      '    <input id="kb-ptitle" class="input" placeholder="如：今天读到的三个观点"/>' +
      '    <label>正文：从任意 App 复制过来</label>' +
      '    <textarea id="kb-ptext" class="input" rows="7" placeholder="粘贴文章、聊天记录、网页正文…&#10;本地整理会自动抽取标题、摘要、要点与 #标签，断网也能用。"></textarea>' +
      '  </div>' +
      '</div>' +
      '<label class="kb-check"><input type="checkbox" id="kb-useai"' + (connected ? ' checked' : '') + '/> 用 AI 整理（网址 / 粘贴通道；主题通道默认走 AI）</label>' +
      '<div id="kb-status" class="kb-status"></div>' +
      '<div class="modal-actions">' +
      '  <button class="btn ghost" data-act="cancel">取消</button>' +
      '  <button class="btn primary" data-act="run">采集并入库</button>' +
      '</div>';

    U.modal({
      title: '联网采集到知识库',
      bodyHTML: bodyHTML,
      onMount(root, close) {
        const status = root.querySelector('#kb-status');
        const setStatus = (msg, bad) => {
          status.textContent = msg || '';
          status.className = 'kb-status' + (msg ? (bad ? ' bad' : ' busy') : '');
        };
        const runBtn = root.querySelector('[data-act="run"]');
        root.querySelector('[data-act="cancel"]').addEventListener('click', close);

        root.querySelectorAll('.kb-tab').forEach((b) => {
          b.addEventListener('click', () => {
            tab = b.getAttribute('data-tab');
            root.querySelectorAll('.kb-tab').forEach((x) => x.classList.toggle('active', x === b));
            root.querySelectorAll('.kb-pane').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== tab; });
            setStatus('');
          });
        });

        runBtn.addEventListener('click', async () => {
          runBtn.disabled = true;
          setStatus('正在采集，请稍候…');
          try {
            const settings = S.state.settings;
            const useAI = root.querySelector('#kb-useai').checked;
            let items;
            if (tab === 'topic') {
              items = await CP.collectTopic(root.querySelector('#kb-topic').value, settings);
            } else if (tab === 'url') {
              items = await CP.collectUrl(root.querySelector('#kb-url').value, settings, { useAI: useAI });
            } else {
              items = await CP.collectText(
                root.querySelector('#kb-ptext').value,
                root.querySelector('#kb-ptitle').value,
                settings, { useAI: useAI }
              );
            }
            if (!items || !items.length) throw new Error('没有产出条目，请检查输入内容');
            items.forEach((it) => S.addLibraryItem(it));
            U.toast('已入库 ' + items.length + ' 条知识');
            close();
            L.app.refresh();
          } catch (e) {
            setStatus('✗ ' + (e && e.message ? e.message : String(e)), true);
            runBtn.disabled = false;
          }
        });
      }
    });
  }

  /* ---------- 吞噬内化（概念 2）：知识条目 → 带 [[双向链接]] 的卡片笔记 ----------
   * 把知识条目「嚼碎」成结构化笔记，并自动与已有笔记建立双向链接：
   *   ① 摘要/要点/标签都写入正文；
   *   ② 同标签的已有笔记用 [[标题]] 收进「关联」段（真正的 Obsidian 反链）；
   *   ③ 通过 L.pet.observe('link'/'feed') 沉淀数字分身习惯。
   * 全部走本地 store，不联网、不新增实体键。 */
  function internalize(it) {
    // 已内化过则直接打开对应笔记
    if (it.internalNoteId && S.state.notes.some((n) => n.id === it.internalNoteId)) {
      if (L.modules.notes && L.modules.notes.open) L.modules.notes.open(it.internalNoteId);
      return;
    }
    const src = it.source || {};
    const tags = (it.tags || []).slice();

    // 找同标签的已有笔记作为「关联」——建立真实双向链接
    const related = (S.state.notes || []).filter((n) =>
      n.id !== it.internalNoteId && (n.tags || []).some((t) => tags.indexOf(t) >= 0)
    ).slice(0, 6);

    const lines = [
      '> 由知识库「吞噬内化」生成 · 来源：' + (src.label || '本地') + (src.url ? '  ' + src.url : ''),
      '',
      '## 摘要',
      String(it.summary || '（无摘要）'),
      ''
    ];
    if ((it.points || []).length) {
      lines.push('## 要点', '');
      it.points.forEach((p) => lines.push('- ' + p));
      lines.push('');
    }
    if (related.length) {
      lines.push('## 关联（双向链接）', '');
      related.forEach((n) => lines.push('- [[' + n.title + ']]'));
      lines.push('');
      lines.push('> 这些链接指向同标签的已有笔记，可在「知识图谱」看到连线。');
    } else {
      lines.push('## 关联', '', '> 暂无同标签笔记。再内化几条，卡片之间就会自动连成小屋。');
    }
    if (it.raw) {
      lines.push('', '## 原文摘录', '', String(it.raw).slice(0, 2000));
    }

    const note = S.addNote({
      title: String(it.title || '未命名').replace(/[\[\]]/g, ''),
      body: lines.join('\n'),
      tags: tags.concat(['内化'])
    });
    S.updateLibraryItem(it.id, { noteId: note.id, internalNoteId: note.id });
    // 行为沉淀：吞了一张卡 + 建立 N 条链接
    if (L.pet) {
      L.pet.observe('feed');
      for (let i = 0; i < related.length; i++) L.pet.observe('link');
    }
    U.toast('已内化：吐出卡片笔记' + (related.length ? '，连上 ' + related.length + ' 条双向链接' : ''));
    return note;
  }

  /* ---------- 转为笔记（旧入口，保留兼容） ---------- */
  function toNote(it) {
    if (it.noteId && S.state.notes.some((n) => n.id === it.noteId)) {
      if (L.modules.notes && L.modules.notes.open) L.modules.notes.open(it.noteId);
      return;
    }
    const src = it.source || {};
    const lines = [
      '> 来源：' + (src.label || '知识库') + (src.url ? '  ' + src.url : ''),
      '',
      '## 摘要',
      it.summary || '（无）',
      ''
    ];
    if ((it.points || []).length) {
      lines.push('## 要点', '', it.points.map((p) => '- ' + p).join('\n'), '');
    }
    lines.push('## 原文摘录', '', it.raw ? it.raw.slice(0, 3000) : '（未保存原文）');
    const note = S.addNote({
      title: it.title,
      body: lines.join('\n'),
      tags: (it.tags || []).concat(['知识库'])
    });
    S.updateLibraryItem(it.id, { noteId: note.id });
    U.toast('已转为笔记');
  }

  function bind(root) {
    const search = root.querySelector('#kb-search');
    if (search) search.addEventListener('input', U.debounce(() => { local.search = search.value; L.app.refresh(); }, 250));

    const tagSel = root.querySelector('#kb-tag');
    if (tagSel) tagSel.addEventListener('change', () => { local.tag = tagSel.value; L.app.refresh(); });

    root.querySelector('#kb-add').addEventListener('click', openCapture);

    const clearSeed = root.querySelector('#kb-clear-seed');
    if (clearSeed) clearSeed.addEventListener('click', async () => {
      const n = L.seedLibrary.count(S);
      if (!n) { U.toast('没有示例内容'); return; }
      if (await U.confirm('清除 ' + n + ' 条内置示例内容？你自己采集或编辑的内容不会受影响。', '清除')) {
        const removed = L.seedLibrary.clear(S);
        U.toast('已清除 ' + removed + ' 条示例内容');
        L.app.refresh();
      }
    });

    const reseed = root.querySelector('#kb-reseed');
    if (reseed) reseed.addEventListener('click', () => {
      try { DB.removeItem(L.seedLibrary.SEED_KEY); } catch (e) { /* noop */ }
      const n = L.seedLibrary.ensure(S);
      U.toast(n ? '已载入 ' + n + ' 条内置内容' : '内置内容已存在');
      L.app.refresh();
    });

    root.querySelector('#kb-refresh').addEventListener('click', async () => {
      local.refreshMsg = '正在刷新公开源…';
      L.app.refresh();
      const r = await CP.refreshSources();
      r.added.forEach((it) => S.addLibraryItem(it));
      const bits = ['新增 ' + r.added.length + ' 条', '重复跳过 ' + r.skipped.length + ' 条'];
      if (r.errors.length) bits.push('失败 ' + r.errors.length + ' 条：' + r.errors[0]);
      local.refreshMsg = bits.join(' · ');
      L.app.refresh();
      U.toast('刷新完成：新增 ' + r.added.length + ' 条');
    });

    root.querySelectorAll('.kb-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      const it = (S.state.library || []).find((x) => x.id === id);
      if (!it) return;
      card.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const act = btn.getAttribute('data-act');
          if (act === 'internalize') { internalize(it); L.app.refresh(); }
          else if (act === 'note') { toNote(it); L.app.refresh(); }
          else if (act === 'del') {
            if (await U.confirm('删除知识条目「' + it.title + '」？（已转成的笔记不受影响）')) {
              S.removeLibraryItem(id);
              L.app.refresh();
            }
          }
        });
      });
    });
  }

  L.modules.library = { render, bind, openCapture, toNote, internalize };
})(window.LifeOS);
