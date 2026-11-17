/* =========================================================================
 * LifeOS · 笔记日记模块（含 Obsidian 风格双向链接）
 * - 正文支持 [[笔记标题]] / [[标题|别名]]
 * - 预览中点击链接跳转；目标不存在时一键创建同名笔记
 * - 编辑器显示「出链」「反向链接」面板
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  const LK = L.links;

  // W2：第三视图 'daily' 复用 L.modules.daily 的面板；不新增顶层实体 / 导航
  const local = { view: 'list', currentId: null, search: '', dailyDate: null };

  /* 供知识图谱等模块跳转到某篇笔记 */
  function open(id) {
    if (!S.state.notes.some((n) => n.id === id)) return;
    local.view = 'editor';
    local.currentId = id;
    L.app.showView('notes');
  }

  function showList() { local.view = 'list'; }
  function showDaily(date) {
    local.view = 'daily';
    local.dailyDate = date || U.todayStr();
    if (L.modules.daily) L.modules.daily.setDate(local.dailyDate);
    L.app.showView('notes');
  }

  /* 打开指定标题的笔记；不存在则创建并打开 */
  function openByTitle(title) {
    const found = LK.resolve(title);
    if (found) { open(found.id); return; }
    const n = S.addNote({ title: title, body: '', tags: [] });
    U.toast('已创建笔记「' + title + '」');
    open(n.id);
  }

  function listView() {
    const notes = S.state.notes
      .filter((n) => {
        if (!local.search) return true;
        const q = local.search.toLowerCase();
        return (n.title + ' ' + (n.body || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const cards = notes.map((n) => {
      const linkCount = LK.extract(n.body).length;
      const backCount = LK.backlinks(n).length;
      const preview = (n.body || '').replace(/[#>*`\-\[\]]/g, '').slice(0, 80);
      return '' +
        '<div class="note-card" data-id="' + n.id + '">' +
        '  <div class="note-title">' + U.escapeHtml(n.title) + '</div>' +
        '  <div class="note-preview">' + U.escapeHtml(preview || '（空笔记）') + '</div>' +
        '  <div class="note-foot">' +
        '    <span class="note-date">' + new Date(n.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span>' +
        (linkCount ? '<span class="tag link-tag">↗ ' + linkCount + '</span>' : '') +
        (backCount ? '<span class="tag back-tag">↩ ' + backCount + '</span>' : '') +
        (n.tags || []).map((t) => '<span class="tag">#' + U.escapeHtml(t) + '</span>').join('') +
        '  </div>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="page">' +
      '  <div class="toolbar">' +
      '    <div class="page-sub">记录想法、日记与知识沉淀 · 用 [[笔记标题]] 建立双向链接 ✎</div>' +
      '    <div class="spacer"></div>' +
      '    <input class="search" id="note-search" placeholder="搜索笔记…" value="' + U.escapeHtml(local.search) + '"/>' +
      '    <button class="btn ghost" id="note-daily" title="按日聚合日程、活动与笔记">▦ 每日笔记</button>' +
      '    <button class="btn ghost" id="note-import-md" title="从 .md 文件导入笔记">↑ 导入 .md</button>' +
      '    <button class="btn ghost" id="note-export-md" title="把全部笔记导出为 .md">↓ 导出 .md</button>' +
      '    <input type="file" id="note-md-file" accept=".md,.markdown,text/markdown,text/plain" multiple style="display:none" />' +
      '    <button class="btn primary" id="new-note">+ 新建笔记</button>' +
      '  </div>' +
      '  <div class="note-grid">' + cards +
      (notes.length === 0 ? '<div class="empty">还没有笔记，写下第一篇吧。<button class="empty-state-btn" id="empty-new-note">＋ 新建笔记</button></div>' : '') +
      '  </div>' +
      '</div>';
  }

  function editorView() {
    const n = S.state.notes.find((x) => x.id === local.currentId);
    if (!n) { local.view = 'list'; return listView(); }

    // 出链
    const outs = LK.outbound(n).map((o) =>
      '<button class="link-item ' + (o.note ? 'exists' : 'missing') + '" data-wiki="' + U.escapeHtml(o.title) + '">' +
      '<span class="li-icon">' + (o.note ? '↗' : '＋') + '</span>' +
      '<span>' + U.escapeHtml(o.title) + '</span>' +
      '<span class="li-hint">' + (o.note ? '打开' : '点击创建') + '</span></button>'
    ).join('') || '<div class="link-empty">在正文输入 [[笔记标题]] 即可建立链接</div>';

    // 反向链接（W2 · B1）：带引用原文上下文，点标题跳转
    const backCtx = LK.backlinkContexts(n);
    const backs = backCtx.map((b) =>
      '<div class="back-card" data-open="' + U.escapeHtml(b.note.id) + '">' +
      '  <div class="bc-title"><span class="li-icon">↩</span>' + U.escapeHtml(b.note.title) + '<span class="li-hint">打开</span></div>' +
      b.snippets.map((s) => '<div class="bc-snippet">' + U.escapeHtml(s) + '</div>').join('') +
      '</div>'
    ).join('') || '<div class="link-empty">还没有其他笔记链接到这里</div>';

    // 未链接提及（W2 · B1）：正文提到本标题但没用 [[ ]]，可一键转成链接
    const mentions = LK.unlinkedMentions(n);
    const mentionHTML = mentions.length
      ? '<div class="link-panel mention-panel"><div class="lp-head">未链接的提及 · ' + mentions.length + '</div>' +
        mentions.map((m) =>
          '<div class="mention-item" data-linkify="' + U.escapeHtml(m.note.id) + '">' +
          '  <div class="mi-title">◇ ' + U.escapeHtml(m.note.title) + '</div>' +
          '  <div class="mi-snippet">' + U.escapeHtml(m.snippet) + '</div>' +
          '  <button class="btn ghost btn-xs mi-btn">＋ 转为链接</button>' +
          '</div>').join('') + '</div>'
      : '';

    return '' +
      '<div class="page editor-page">' +
      '  <div class="toolbar">' +
      '    <button class="btn ghost" id="back">← 返回</button>' +
      '    <button class="btn ghost" id="insert-link">↗ 插入链接</button>' +
      '    <button class="btn ghost" id="e-export-md" title="导出为 Markdown 文件">↓ .md</button>' +
      '    <div class="spacer"></div>' +
      '    <span class="save-state ok" id="e-save-state">已自动保存</span>' +
      '    <button class="btn primary btn-xs" id="e-save">保存</button>' +
      '    <button class="btn ghost danger" id="del">删除</button>' +
      '  </div>' +
      '  <div class="editor-wrap">' +
      '    <div class="editor-left">' +
      '      <input id="e-title" class="input title-input" value="' + U.escapeHtml(n.title) + '" placeholder="标题"/>' +
      '      <input id="e-tags" class="input" value="' + U.escapeHtml((n.tags || []).join(', ')) + '" placeholder="标签（逗号分隔）"/>' +
      '      <textarea id="e-body" class="input editor-area" placeholder="支持 Markdown 与 [[双向链接]]…">' + U.escapeHtml(n.body || '') + '</textarea>' +
      '    </div>' +
      '    <div class="editor-right">' +
      '      <div class="preview-label">预览</div>' +
      '      <div class="markdown-body" id="e-preview"></div>' +
      '      <div class="link-panels">' +
      '        <div class="link-panel"><div class="lp-head">出链 · ' + LK.extract(n.body).length + '</div>' + outs + '</div>' +
      '        <div class="link-panel"><div class="lp-head">反向链接 · ' + LK.backlinks(n).length + '</div>' + backs + '</div>' +
      '        ' + mentionHTML +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function render() {
    if (local.view === 'editor') return editorView();
    if (local.view === 'daily' && L.modules.daily) {
      return L.modules.daily.renderPanel(local.dailyDate || U.todayStr());
    }
    return listView();
  }

  /* 下载文本文件（.md 导出复用），走 Blob + a[download]，与备份导出同口径 */
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  function bind(root) {
    if (local.view === 'editor') { bindEditor(root); return; }
    if (local.view === 'daily' && L.modules.daily) { L.modules.daily.bindPanel(root, local.dailyDate || U.todayStr()); return; }
    const search = root.querySelector('#note-search');
    if (search) search.addEventListener('input', U.debounce(() => { local.search = search.value; L.app.refresh(); }, 250));
    const createNote = () => {
      const n = S.addNote({ title: '无标题笔记', body: '', tags: [] });
      local.view = 'editor'; local.currentId = n.id;
      L.app.refresh();
    };
    root.querySelector('#new-note').addEventListener('click', createNote);
    const emptyNew = root.querySelector('#empty-new-note');
    if (emptyNew) emptyNew.addEventListener('click', createNote);
    root.querySelectorAll('.note-card').forEach((card) => {
      card.addEventListener('click', () => { local.view = 'editor'; local.currentId = card.getAttribute('data-id'); L.app.refresh(); });
    });

    /* W2 · B2 每日笔记入口 */
    const dailyBtn = root.querySelector('#note-daily');
    if (dailyBtn) dailyBtn.addEventListener('click', () => showDaily(U.todayStr()));

    /* W2 · B3 导入 / 导出 .md */
    const fileInput = root.querySelector('#note-md-file');
    root.querySelector('#note-import-md').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      let added = 0;
      for (const f of files) {
        try {
          const text = await f.text();
          const note = L.vault.markdownToNote(text, f.name);
          S.addNote(note);
          added++;
        } catch (e) { /* 单个文件失败不阻断其余 */ }
      }
      fileInput.value = '';
      U.toast('已导入 ' + added + ' 篇 .md 笔记');
      L.app.refresh();
    });
    root.querySelector('#note-export-md').addEventListener('click', () => {
      const files = L.vault.exportNotes(S.state.notes);
      if (!files.length) { U.toast('还没有笔记可导出', 'error'); return; }
      // 逐个下载（浏览器会批量询问）；无打包依赖，保持零依赖
      files.forEach((f) => downloadText(f.filename, f.content));
      U.toast('已导出 ' + files.length + ' 篇 .md');
    });
  }

  function bindEditor(root) {
    const id = local.currentId;
    const n = S.state.notes.find((x) => x.id === id);
    const body = root.querySelector('#e-body');
    const preview = root.querySelector('#e-preview');
    const title = root.querySelector('#e-title');
    const tags = root.querySelector('#e-tags');

    // 局部刷新链接面板，避免整页重绘打断输入焦点（W2 · B1 增强版）
    function refreshLinkPanels() {
      const cur = S.state.notes.find((x) => x.id === id);
      if (!cur) return;
      const outs = LK.outbound(cur).map((o) =>
        '<button class="link-item ' + (o.note ? 'exists' : 'missing') + '" data-wiki="' + U.escapeHtml(o.title) + '">' +
        '<span class="li-icon">' + (o.note ? '↗' : '＋') + '</span><span>' + U.escapeHtml(o.title) + '</span>' +
        '<span class="li-hint">' + (o.note ? '打开' : '点击创建') + '</span></button>'
      ).join('') || '<div class="link-empty">在正文输入 [[笔记标题]] 即可建立链接</div>';
      const backCtx = LK.backlinkContexts(cur);
      const backs = backCtx.map((b) =>
        '<div class="back-card" data-open="' + U.escapeHtml(b.note.id) + '">' +
        '  <div class="bc-title"><span class="li-icon">↩</span>' + U.escapeHtml(b.note.title) + '<span class="li-hint">打开</span></div>' +
        b.snippets.map((s) => '<div class="bc-snippet">' + U.escapeHtml(s) + '</div>').join('') +
        '</div>'
      ).join('') || '<div class="link-empty">还没有其他笔记链接到这里</div>';
      const mentions = LK.unlinkedMentions(cur);
      const mentionHTML = mentions.length
        ? '<div class="link-panel mention-panel"><div class="lp-head">未链接的提及 · ' + mentions.length + '</div>' +
          mentions.map((m) =>
            '<div class="mention-item" data-linkify="' + U.escapeHtml(m.note.id) + '">' +
            '  <div class="mi-title">◇ ' + U.escapeHtml(m.note.title) + '</div>' +
            '  <div class="mi-snippet">' + U.escapeHtml(m.snippet) + '</div>' +
            '  <button class="btn ghost btn-xs mi-btn">＋ 转为链接</button>' +
            '</div>').join('') + '</div>'
        : '';
      const wrap = root.querySelector('.link-panels');
      if (!wrap) return;
      wrap.innerHTML =
        '<div class="link-panel"><div class="lp-head">出链 · ' + LK.extract(cur.body).length + '</div>' + outs + '</div>' +
        '<div class="link-panel"><div class="lp-head">反向链接 · ' + LK.backlinks(cur).length + '</div>' + backs + '</div>' +
        mentionHTML;
      bindLinkPanelClicks(wrap);
    }

    /* 链接面板点击：出链跳转 / 反链卡片跳转 / 未链接提及一键转链接 */
    function bindLinkPanelClicks(scope) {
      scope.querySelectorAll('.link-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.hasAttribute('data-open')) open(btn.getAttribute('data-open'));
          else openByTitle(btn.getAttribute('data-wiki'));
        });
      });
      scope.querySelectorAll('.back-card[data-open]').forEach((card) => {
        card.addEventListener('click', () => open(card.getAttribute('data-open')));
      });
      scope.querySelectorAll('.mention-item[data-linkify]').forEach((item) => {
        item.addEventListener('click', () => {
          const targetId = item.getAttribute('data-linkify');
          const src = S.state.notes.find((x) => x.id === targetId);
          const cur = S.state.notes.find((x) => x.id === id);
          if (!src || !cur) return;
          const r = LK.linkifyFirst(src.body, cur.title);
          if (r.count) {
            S.updateNote(targetId, { body: r.body });
            refreshLinkPanels();
            U.toast('已在「' + src.title + '」中建立链接');
          }
        });
      });
    }

    const saveState = root.querySelector('#e-save-state');
    const setSaveState = (txt, cls) => {
      if (!saveState) return;
      saveState.textContent = txt;
      saveState.className = 'save-state ' + (cls || '');
    };
    const doSave = () => {
      const cur = S.state.notes.find((x) => x.id === id);
      const newTitle = title.value.trim() || '无标题笔记';
      const oldTitle = cur ? cur.title : newTitle;
      // W2 · B3 安全重命名：标题改了就同步改写所有指向旧标题的 [[链接]]
      if (oldTitle !== newTitle && LK.renameNoteLinks) {
        const r = LK.renameNoteLinks(S.state, id, oldTitle, newTitle);
        if (r.changed) U.toast('已同步改写 ' + r.changed + ' 处链接');
      }
      S.updateNote(id, { title: newTitle, body: body.value, tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean) });
      refreshLinkPanels();
      const d = new Date();
      setSaveState('已保存 · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), 'ok');
    };
    const update = U.debounce(doSave, 700);
    const renderPreview = () => {
      preview.innerHTML = U.markdown(body.value);
      // 标注未创建的链接
      preview.querySelectorAll('.wikilink').forEach((a) => {
        if (!LK.resolve(a.getAttribute('data-wiki'))) a.classList.add('missing');
      });
    };
    renderPreview();

    [body, title, tags].forEach((el) => el.addEventListener('input', () => {
      renderPreview();
      setSaveState('有未保存的改动…', 'dirty');
      update();
    }));
    const saveBtn = root.querySelector('#e-save');
    if (saveBtn) saveBtn.addEventListener('click', () => { doSave(); U.toast('笔记已保存'); });

    // W2 · B3 导出此篇为 .md
    const expMd = root.querySelector('#e-export-md');
    if (expMd) expMd.addEventListener('click', () => {
      doSave();
      const cur = S.state.notes.find((x) => x.id === id);
      if (!cur) return;
      const f = L.vault.exportNotes([cur])[0];
      downloadText(f.filename, f.content);
      U.toast('已导出 ' + f.filename);
    });

    // 预览中点击 [[链接]]
    preview.addEventListener('click', (e) => {
      const a = e.target.closest('.wikilink');
      if (!a) return;
      e.preventDefault();
      openByTitle(a.getAttribute('data-wiki'));
    });

    // 出链 / 反向链接 / 未链接提及面板点击（W2 · B1 统一绑定）
    const panels = root.querySelector('.link-panels');
    if (panels) bindLinkPanelClicks(panels);

    // 插入链接
    root.querySelector('#insert-link').addEventListener('click', () => {
      const list = S.state.notes.filter((x) => x.id !== id);
      U.modal({
        title: '插入双向链接',
        bodyHTML: '' +
          '<div class="form">' +
          '  <label>选择已有笔记</label>' +
          '  <select id="lk-sel" class="input">' +
          '    <option value="">— 请选择 —</option>' +
          list.map((x) => '<option value="' + U.escapeHtml(x.title) + '">' + U.escapeHtml(x.title) + '</option>').join('') +
          '  </select>' +
          '  <label style="margin-top:12px">或输入新标题（自动创建）</label>' +
          '  <input id="lk-new" class="input" placeholder="如：项目复盘"/>' +
          '  <div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
          '    <button class="btn primary" data-act="ok">插入</button></div>' +
          '</div>',
        onMount(mRoot, close) {
          mRoot.querySelector('[data-act="cancel"]').addEventListener('click', close);
          mRoot.querySelector('[data-act="ok"]').addEventListener('click', () => {
            const t = (mRoot.querySelector('#lk-new').value.trim() || mRoot.querySelector('#lk-sel').value).trim();
            if (!t) { U.toast('请选择或输入标题', 'error'); return; }
            const pos = body.selectionStart;
            const ins = '[[' + t + ']]';
            body.value = body.value.slice(0, pos) + ins + body.value.slice(pos);
            body.focus(); body.selectionStart = body.selectionEnd = pos + ins.length;
            body.dispatchEvent(new Event('input'));
            close();
          });
        }
      });
    });

    root.querySelector('#back').addEventListener('click', () => {
      // 直接返回时清掉从未编辑过的空草稿，避免列表里堆「无标题笔记」
      const cur = S.state.notes.find((x) => x.id === id);
      if (cur && cur.title === '无标题笔记' && !String(cur.body || '').trim() && !(cur.tags || []).length) {
        S.removeNote(id);
      }
      local.view = 'list'; L.app.refresh();
    });
    root.querySelector('#del').addEventListener('click', async () => {
      if (await U.confirm('确定删除该笔记？')) { S.removeNote(id); local.view = 'list'; L.app.refresh(); }
    });
  }

  L.modules.notes = { render, bind, open, openByTitle, showList, showDaily };
})(window.LifeOS);
