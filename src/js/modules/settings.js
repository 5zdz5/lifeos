/* =========================================================================
 * LifeOS · 设置模块（本地与隐私 / AI 接入 / 个性化 / 数据与备份）
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function countLine(c) {
    return '任务 ' + (c.tasks || 0) + ' · 习惯 ' + (c.habits || 0) +
      ' · 笔记 ' + (c.notes || 0) + ' · 知识 ' + (c.library || 0) +
      ' · 日程 ' + (c.events || 0) + ' · 对话 ' + (c.ai || 0);
  }

  function snapSection() {
    const list = S.snapshotList();
    if (!list.length) {
      return '<p class="hint">暂无快照。每次数据变更会自动留一份（3 分钟节流，最多 8 份），也可以点上方「立即创建快照」。</p>';
    }
    return '<div class="snap-list">' + list.map((s) =>
      '<div class="snap-item">' +
      '  <div class="snap-info">' +
      '    <div class="snap-t">' + U.escapeHtml(fmtTime(s.at)) + ' <span class="snap-label">' + U.escapeHtml(s.label || '') + '</span></div>' +
      '    <div class="snap-c">' + U.escapeHtml(countLine(s.counts || {})) + '</div>' +
      '  </div>' +
      '  <button class="btn ghost snap-restore" data-snap="' + U.escapeHtml(s.id) + '">恢复</button>' +
      '</div>').join('') + '</div>';
  }

  /* W1 · 存储引擎区块：三态灰度 / 迁移前强制导出备份 / 一键回滚。
   * 与 storage.js 的 status() 对应，Electron 桌面端不显示切换（边界为仅验证）。 */
  function storageSectionHTML() {
    if (!L.storage || !L.storage.status || L.bridge.mode === 'electron') return '';
    const st = L.storage.status();
    const labels = {
      legacy: '旧存储 · 仅 localStorage',
      dual: '双写灰度 · localStorage + IndexedDB',
      idb: 'IndexedDB 优先 · localStorage 为降级镜像'
    };
    const rows = [
      ['当前模式', labels[st.mode] || st.mode],
      ['浏览器支持 IndexedDB', st.supported ? '是' : '否（已自动降级为旧存储）'],
      ['运行时降级', st.degraded ? '是 · ' + (st.lastError || '') : '否'],
      ['URL 应急覆盖', st.urlOverride ? st.urlOverride : '无']
    ];
    const opts = [
      ['legacy', '旧存储（localStorage）'],
      ['dual', '双写灰度（推荐）'],
      ['idb', 'IndexedDB 优先']
    ].map((o) => '<option value="' + o[0] + '"' + (st.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    return '' +
      '    <h2 class="settings-h">存储引擎（双写灰度）</h2>' +
      '    <div class="form">' +
      '      <p class="hint">默认「双写灰度」：数据同步写入 localStorage（旧存储的回滚基线，永不删除），同时在 IndexedDB 留一份冗余镜像，解除 localStorage 容量上限。切换前会<b>强制先导出一份备份</b>。</p>' +
      '      <div class="local-note">' + rows.map((r) =>
        '<div class="ln-item"><b>' + U.escapeHtml(r[0]) + '</b><span>' + U.escapeHtml(r[1]) + '</span></div>'
      ).join('') + '</div>' +
      '      <label>切换到</label>' +
      '      <select id="s-storage-mode" class="input">' + opts + '</select>' +
      '      <div class="btn-row">' +
      '        <button class="btn primary" type="button" id="s-storage-apply">导出备份并切换</button>' +
      '        <button class="btn ghost" type="button" id="s-storage-rollback">一键切回旧存储</button>' +
      '      </div>' +
      '      <p class="hint">应急回滚：在地址栏加 <code>&amp;storage=legacy</code> 可强制回旧存储（优先级最高，无需进设置页）。回滚不清空 IndexedDB，随时可切回。<b>密钥不写入任何长期存储</b>——「仅本次会话保存」仍只存 sessionStorage，导出备份与快照也都不含密钥。</p>' +
      '    </div>';
  }

  function localPrivacyHTML() {
    const where = L.bridge.mode === 'electron' ? '应用用户目录 lifeos-data.json' : '浏览器 localStorage';
    const rows = [
      ['▣ 数据保存在本机', '任务、习惯、笔记、日程、知识库、AI 对话都存于 <code>' + U.escapeHtml(where) + '</code>，没有账号与云端数据库。但本应用通过分享链接分发，拿到链接的人打开的是各自设备上的独立数据；「仅存本机」不等于「有访问控制」。'],
      ['↗ 哪些操作会联网', '① 知识库「联网采集 / 刷新源」；② 填了 API Key 后的 AI 调用；③ 主动开启的识海 AI 判分。其余功能离线可用，单文件离线版可完全不联网运行。'],
      ['▣ 记得导出备份', '清缓存、换设备或卸载 PWA 都会丢失本机数据。应用会自动留快照（3 分钟节流，最多 8 份），但快照同样只在这台设备里，<b>定期导出 JSON 才是可靠备份</b>。']
    ];
    return '<div class="local-note">' + rows.map((r) =>
      '<div class="ln-item"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>'
    ).join('') + '</div>';
  }

  /* 概念 9：多平台与社交（A2A）—— 诚实边界：本版为本地演示，
   * 展示「多端同步状态 / 跨宠物来信 / Trace ID 校验」的信息架构，
   * 不虚构真实云端账号或端到端加密通信。 */
  function socialSectionHTML() {
    if (!L.pet) return '';
    const inbox = L.pet.inbox();
    const rows = inbox.map((m) =>
      '<div class="soc-msg"><span class="soc-from">' + U.escapeHtml(m.from) + '</span>' +
      '<span class="soc-status">✓ ' + U.escapeHtml(m.status) + '</span>' +
      '<p>' + U.escapeHtml(m.text) + '</p></div>'
    ).join('');
    const skills = L.pet.userSkills();
    return '' +
      '    <h2 class="settings-h">多平台 · 社交（A2A 演示）</h2>' +
      '    <div class="social-demo">' +
      '      <div class="soc-devices">' +
      '        <div class="soc-dev"><span>▣</span><b>本机桌面</b><small>数据在此</small></div>' +
      '        <div class="soc-dev"><span>◈</span><b>网页版</b><small>需各自备份</small></div>' +
      '        <div class="soc-dev"><span>◇</span><b>鸿蒙端</b><small>rawfile 同步</small></div>' +
      '      </div>' +
      '      <p class="hint">当前是<b>本地演示</b>：三端形态分别对应 Electron 桌面、浏览器 PWA 与鸿蒙工程，数据各自存于本机，未接入云端账号。真实多端同步需服务端与登录体系。</p>' +
      '      <div class="soc-inbox-h">跨宠物来信 <span>每条带 Trace ID · 已校验防串号</span></div>' +
      rows +
      '      <div class="soc-trace">trace-id 由 social-gateway 全链路追踪 · 无幽灵任务</div>' +
      '      <div class="soc-twin">数字分身：<b>' + (skills.length ? U.escapeHtml(skills.join(' · ')) : '尚在成长，多互动会更懂你') + '</b></div>' +
      '      <button class="btn ghost btn-xs" id="s-a2a-refresh">↻ 模拟一次来信（演示）</button>' +
      '    </div>';
  }

  function render() {
    const s = S.state.settings;
    const st = S.state;
    const counts = {
      tasks: (st.tasks || []).length,
      habits: (st.habits || []).length,
      notes: (st.notes || []).length,
      library: (st.library || []).length,
      events: (st.events || []).length,
      ai: (st.aiThread || []).length
    };
    const seedN = (L.seedLibrary && L.seedLibrary.count) ? L.seedLibrary.count(S) : 0;
    const info = S.storageInfo();
    const build = L.buildInfo || null;
    const verLine = build
      ? '版本 <code>' + U.escapeHtml(build.version) + '</code> · 构建于 ' + U.escapeHtml(build.builtAt || '—')
      : '开发版本（未运行构建脚本）';

    return '' +
      '<div class="page">' +
      '  <div class="settings-wrap">' +
      '    <h2 class="settings-h">本地与隐私</h2>' +
      localPrivacyHTML() +
      (L.bridge.mode === 'electron' ? '' :
      '    <h2 class="settings-h">关于网页版的能力边界</h2>' +
      '    <div class="demo-note"><b>当前是网页演示版。</b>文件读写、终端命令、Python/JS 执行都是隔离的虚拟演示，不会接触你的本机文件；Codex 的运行流是固定演示回放；AI 助手未配置 Key 时返回本地模板。' +
      '填写 API Key 只能让 AI 助手与识海判分调用真实模型，<b>不会</b>让网页版获得本机文件权限。需要真实读写本机文件与执行命令，请运行 Electron 桌面版。' +
      '（<code>cd lifeos &amp;&amp; npm install &amp;&amp; npm start</code>）</div>') +
      '    <h2 class="settings-h">AI 接入（OpenAI 兼容接口）</h2>' +
      '    <div class="form">' +
      '      <label>API Base URL</label>' +
      '      <input id="s-base" class="input" value="' + U.escapeHtml(s.aiBaseUrl || '') + '" placeholder="https://api.openai.com/v1"/>' +
      '      <label>API Key</label>' +
      '      <input id="s-key" class="input" type="password" value="" autocomplete="off" placeholder="' + (s.aiKey ? '已保存 · 留空保持不变，输入新值可覆盖' : 'sk-...') + '"/>' +
      (L.bridge.mode === 'electron' ? '' :
      '      <label class="ms-check"><input id="s-key-session" type="checkbox"' + (s.aiKeySessionOnly === true ? ' checked' : '') + '/> 仅本次会话保存（关闭标签页即失效，不写入本机长期存储）</label>') +
      (L.bridge.mode !== 'electron' && s.aiKeySessionOnly === true && !s.aiKey
        ? '      <p class="hint">上次选择了「仅本次会话保存」，密钥已随标签页关闭失效，需要重新填写。</p>'
        : '') +
      '      <button class="btn ghost btn-xs" type="button" id="s-clear-key">清除已保存的密钥</button>' +
      '      <label>模型名称</label>' +
      '      <input id="s-model" class="input" value="' + U.escapeHtml(s.aiModel || '') + '" placeholder="gpt-4o-mini / deepseek-chat 等"/>' +
      '      <p class="hint">支持 OpenAI、DeepSeek、通义、智谱等所有兼容 <code>/v1/chat/completions</code> 的服务。不填 Key 时应用完全离线、AI 相关功能走本地处理。<b>密钥说明：</b>输入框不会回填明文，留空即不修改；默认以明文保存在本机浏览器存储中，公共设备请勿保存，可勾选「仅本次会话保存」让它只留在当前标签页。<b>导出的备份与本地快照都不含密钥和接口地址</b>，换设备恢复后需重新填写；导入他人备份也不会改动你本机的密钥。</p>' +
      '    </div>' +
      '    <h2 class="settings-h">识海记忆</h2>' +
      '    <div class="form">' +
      '      <label class="ms-check"><input id="s-mindsea-auto" type="checkbox"' + (s.mindseaAuto !== false ? ' checked' : '') + '/> 每轮对话结束后自动沉淀原话</label>' +
      '      <label class="ms-check"><input id="s-mindsea-ai" type="checkbox"' + (s.mindseaAI === true ? ' checked' : '') + '/> 允许使用已配置的 AI 判分、归类与识别决定</label>' +
      '      <p class="hint">默认使用本地规则，断网也能写入；开启 AI 判分后，原话会发给你配置的模型服务，但模型只能返回编号与分类，不能改写入库原话。桌面端保存到本机 SQLite，网页端保存到浏览器 localStorage。</p>' +
      '      <button class="btn ghost" type="button" id="s-open-mindsea">打开识海工作台</button>' +
      '    </div>' +
      '    <h2 class="settings-h">个性化</h2>' +
      '    <div class="form">' +
      '      <label>你的称呼</label>' +
      '      <input id="s-name" class="input" value="' + U.escapeHtml(s.userName || '') + '" placeholder="如：小明"/>' +
      '      <label>主题</label>' +
      '      <select id="s-theme" class="input">' +
      '        <option value="auto"' + (s.theme === 'auto' ? ' selected' : '') + '>跟随系统</option>' +
      '        <option value="light"' + (s.theme === 'light' ? ' selected' : '') + '>浅色</option>' +
      '        <option value="dark"' + (s.theme === 'dark' ? ' selected' : '') + '>深色</option>' +
      '      </select>' +
      '    </div>' +
      '    <div class="modal-actions">' +
      '      <button class="btn primary" id="s-save">保存设置</button>' +
      '    </div>' +
      socialSectionHTML() +
      '    <h2 class="settings-h">内置示例内容</h2>' +
      '    <div class="form">' +
      '      <p class="hint">首次打开时应用预置了一些知识卡片，用于展示知识库样式，它们不是你添加的内容。清除后不会自动灌回，你自己采集或编辑的内容不受影响。</p>' +
      (seedN
        ? '      <button class="btn ghost" type="button" id="s-clear-seed">清除 ' + seedN + ' 条示例内容</button>'
        : '      <p class="hint">✓ 示例内容已清除。</p>') +
      '    </div>' +

      '    <h2 class="settings-h">数据与备份（含知识库）</h2>' +
      '    <div class="data-stat">' +
      '      <div><b>' + counts.tasks + '</b><span>任务</span></div>' +
      '      <div><b>' + counts.habits + '</b><span>习惯</span></div>' +
      '      <div><b>' + counts.notes + '</b><span>笔记</span></div>' +
      '      <div><b>' + counts.library + '</b><span>知识</span></div>' +
      '      <div><b>' + counts.events + '</b><span>日程</span></div>' +
      '      <div><b>' + counts.ai + '</b><span>对话</span></div>' +
      '      <div><b>' + U.escapeHtml(fmtBytes(info.bytes)) + '</b><span>占用</span></div>' +
      '    </div>' +
      '    <p class="hint">数据目前只保存在本机' +
      (L.bridge.mode === 'electron' ? '（应用用户目录 lifeos-data.json）' : '（浏览器 localStorage）') +
      '。清缓存、换设备或卸载 PWA 都会丢失，<b>请定期导出备份</b>。导出文件不含 API 密钥与接口地址，可放心存放或分享；恢复后需重新填写密钥。</p>' +
      '    <div class="btn-row">' +
      '      <button class="btn primary" id="s-export">↓ 导出备份 (JSON)</button>' +
      '      <button class="btn" id="s-import">⬆ 导入备份</button>' +
      '      <button class="btn ghost" id="s-snapshot">＋ 立即创建快照</button>' +
      '      <input type="file" id="s-file" accept=".json,application/json" style="display:none" />' +
      '    </div>' +
      '    <div class="snap-head"><h3>本地快照</h3><button class="btn ghost btn-xs" id="s-clear-snap">清空</button></div>' +
      snapSection() +
      '    <div class="data-note">' +
      '      存储位置：<code>' + (L.bridge.mode === 'electron' ? '应用用户目录 / lifeos-data.json'
        : (L.storage && L.storage.status ? '浏览器 ' + U.escapeHtml(L.storage.status().mode) + ' 模式' : '浏览器 localStorage')) + '</code><br />' +
      '      ' + verLine +
      '    </div>' +
      storageSectionHTML() +
      '  </div>' +
      '</div>';
  }

  function askImportMode(parsed) {
    return new Promise((resolve) => {
      let done = false;
      const c = U.escapeHtml(countLine(parsed.counts || {
        tasks: parsed.data.tasks.length, habits: parsed.data.habits.length,
        notes: parsed.data.notes.length, library: parsed.data.library.length,
        events: (parsed.data.events || []).length, ai: parsed.data.aiThread.length
      }));
      const exp = parsed.exportedAt ? '<br />备份时间：' + U.escapeHtml(new Date(parsed.exportedAt).toLocaleString()) : '';
      const close = U.modal({
        title: '导入备份',
        bodyHTML: '<p class="confirm-text">备份内容：' + c + exp + '</p>' +
          '<p class="hint" style="margin-top:10px"><b>合并</b>：保留现有数据，按 ID 追加缺失项（推荐）。<br />' +
          '<b>覆盖</b>：用备份完全替换当前数据。<br />两种方式都会先自动保存一份恢复快照。</p>' +
          '<div class="modal-actions">' +
          '  <button class="btn ghost" data-act="cancel">取消</button>' +
          '  <button class="btn" data-act="merge">合并导入</button>' +
          '  <button class="btn danger" data-act="replace">覆盖导入</button>' +
          '</div>',
        onMount(root, cl) {
          const pick = (mode) => { done = true; cl(); resolve(mode); };
          root.querySelector('[data-act="cancel"]').addEventListener('click', () => pick(null));
          root.querySelector('[data-act="merge"]').addEventListener('click', () => pick('merge'));
          root.querySelector('[data-act="replace"]').addEventListener('click', () => pick('replace'));
        },
        onClose() { if (!done) resolve(null); }
      });
      return close;
    });
  }

  function bind(root) {
    root.querySelector('#s-theme').addEventListener('change', (e) => {
      L.app.applyTheme(e.target.value);
    });
    root.querySelector('#s-open-mindsea').addEventListener('click', () => L.app.showView('mindsea'));
    const a2aBtn = root.querySelector('#s-a2a-refresh');
    if (a2aBtn && L.pet) a2aBtn.addEventListener('click', () => {
      L.pet.update((s) => {
        s.inbox.unshift({
          id: 'm-' + Date.now().toString(36),
          from: '@远方的宠物 · 演示',
          text: '（本地模拟来信）你的「' + (S.state.notes[0] ? U.escapeHtml(S.state.notes[0].title) : '知识卡片') + '」整理得不错，已同步摘要。',
          status: '已校验'
        });
        s.inbox = s.inbox.slice(0, 20);
      });
      U.toast('已模拟一次 A2A 来信（trace-id 已记录）');
      L.app.refresh();
    });
    const clearKey = root.querySelector('#s-clear-key');
    if (clearKey) clearKey.addEventListener('click', async () => {
      if (await U.confirm('确定清除已保存的 API Key？')) {
        S.setSettings({ aiKey: '' });
        const keyEl = root.querySelector('#s-key');
        keyEl.value = '';
        keyEl.placeholder = 'sk-...';
        U.toast('已清除密钥');
        L.app.updateAIStatus();
      }
    });
    const clearSeed = root.querySelector('#s-clear-seed');
    if (clearSeed) clearSeed.addEventListener('click', async () => {
      const n = L.seedLibrary.count(S);
      if (await U.confirm('清除 ' + n + ' 条内置示例内容？你自己采集或编辑的内容不会受影响。', '清除')) {
        const removed = L.seedLibrary.clear(S);
        U.toast('已清除 ' + removed + ' 条示例内容');
        L.app.refresh();
      }
    });
    root.querySelector('#s-save').addEventListener('click', () => {
      const keyInput = root.querySelector('#s-key').value.trim();
      const patch = {
        aiBaseUrl: root.querySelector('#s-base').value.trim(),
        aiKey: keyInput || S.state.settings.aiKey || '',
        aiModel: root.querySelector('#s-model').value.trim() || 'gpt-4o-mini',
        userName: root.querySelector('#s-name').value.trim(),
        theme: root.querySelector('#s-theme').value,
        mindseaAuto: root.querySelector('#s-mindsea-auto').checked,
        mindseaAI: root.querySelector('#s-mindsea-ai').checked
      };
      const sessionBox = root.querySelector('#s-key-session');
      if (sessionBox) patch.aiKeySessionOnly = sessionBox.checked;
      S.setSettings(patch);
      U.toast('设置已保存');
      L.app.updateAIStatus();
    });

    /* 导出 */
    root.querySelector('#s-export').addEventListener('click', () => {
      const name = S.downloadBackup();
      try { DB.setItem('lifeos-backup-tip-done', '1'); } catch (_) { /* noop */ }
      U.toast('已导出 ' + name);
    });

    /* 导入 */
    const file = root.querySelector('#s-file');
    root.querySelector('#s-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = S.parseImport(text);
        const mode = await askImportMode(parsed);
        if (!mode) { file.value = ''; return; }
        await S.importPayload(text, mode);
        U.toast(mode === 'merge' ? '已合并导入' : '已覆盖导入');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        U.toast('导入失败：' + (e && e.message ? e.message : String(e)), 'error');
        file.value = '';
      }
    });

    /* 快照 */
    root.querySelector('#s-snapshot').addEventListener('click', () => {
      if (S.makeSnapshot('手动快照')) { U.toast('快照已创建'); L.app.refresh(); }
      else U.toast('快照写入失败（存储空间不足）', 'error');
    });
    root.querySelector('#s-clear-snap').addEventListener('click', async () => {
      if (!S.snapshotList().length) { U.toast('暂无快照'); return; }
      if (await U.confirm('清空所有本地快照？此操作不可撤销（当前数据不受影响）。', '清空')) {
        S.clearSnapshots(); U.toast('快照已清空'); L.app.refresh();
      }
    });
    root.querySelectorAll('.snap-restore').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-snap');
        if (await U.confirm('恢复到该快照？当前数据会先自动存一份快照。', '恢复')) {
          await S.restoreSnapshot(id);
          U.toast('已恢复快照');
          setTimeout(() => location.reload(), 600);
        }
      });
    });

    /* W1 · 存储引擎：迁移前强制导出备份 + 三态切换 + 一键回滚。
     * 地址栏 ?storage= 覆盖优先级最高，切换时一并去掉该参数，否则新设置不生效。 */
    const reloadWithoutOverride = () => {
      try {
        const u = new URL(location.href);
        if (u.searchParams.has('storage')) {
          u.searchParams.delete('storage');
          location.replace(u.toString());
          return;
        }
      } catch (_) { /* 老浏览器不支持 URL 时退化为普通刷新 */ }
      location.reload();
    };
    const applyBtn = root.querySelector('#s-storage-apply');
    if (applyBtn && L.storage) applyBtn.addEventListener('click', async () => {
      const target = root.querySelector('#s-storage-mode').value;
      if (!await U.confirm('切换存储模式前会先导出一份 JSON 备份，然后刷新生效。确认继续？', '切换')) return;
      // 迁移前兜底：强制导出，导出失败则中止切换（不允许无备份迁移）
      try {
        const name = S.downloadBackup();
        U.toast('已导出备份 ' + name);
      } catch (e) {
        U.toast('备份导出失败，已中止切换：' + (e && e.message ? e.message : String(e)), 'error');
        return;
      }
      L.storage.setMode(target);
      setTimeout(reloadWithoutOverride, 700);
    });
    const rollbackBtn = root.querySelector('#s-storage-rollback');
    if (rollbackBtn && L.storage) rollbackBtn.addEventListener('click', async () => {
      if (!await U.confirm('切回旧存储（仅 localStorage）？IndexedDB 冗余数据会保留，随时可切回。', '回滚')) return;
      L.storage.rollback();
      U.toast('已切回旧存储');
      setTimeout(reloadWithoutOverride, 700);
    });
  }

  L.modules.settings = { render, bind };
})(window.LifeOS);
