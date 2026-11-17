/* =========================================================================
 * LifeOS · Codex 视图
 * 界面形态对齐 Codex：左侧任务栏 + 中间任务流 + 底部输入框（对话优先）
 * 工作区文件不再是主角，收进可折叠的右侧面板（看文件 / 运行 / 手动改）
 *
 * - Electron 桌面版：真实读写本机文件、执行 shell、运行 JS/Python
 * - 浏览器版：虚拟工作区 + 受限沙箱（用于演示）
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  const KEY_TASKS = 'lifeos-codex-tasks';
  const KEY_PREF = 'lifeos-codex-pref';

  const SUGGESTIONS = [
    { icon: '⌨', text: '写一个命令行待办工具，支持增删改查并保存到本地 JSON' },
    { icon: '◇', text: '读一遍这个项目，找出最可能导致报错的地方并修掉' },
    { icon: '▤', text: '给 README 补一节「快速开始」，命令要和当前代码对得上' },
    { icon: '▶', text: '写一个 Python 脚本，统计工作区里每个文件的行数和大小' },
    { icon: '◌', text: '查一下识海：我们之前做过哪些重要决定？先检索再回答' }
  ];

  const state = {
    tasks: [],
    activeId: null,
    mode: 'agent',
    busy: false,
    busyTaskId: null,
    root: null,
    listing: [],
    loaded: false,
    filesOpen: true,          // 右栏常驻：无产物时显示权限与上下文，而不是空白
    file: null,        // { rel, content, output, outputErr }
    editing: false,
    teamOpen: false          // 概念 7：老板视角团队看板（默认折叠）
  };

  /* 概念 7：老板视角 · 多 Agent 团队看板。
   * 诚实边界：本机同一时刻只有一个 Agent 在跑（顺序执行，无后台队列），
   * 看板展示的是「角色分工 + 当前占用 + 并发上限 = 1」的真实状态，不虚构并发。 */
  const TEAM_ROLES = [
    { id: 'boss', glyph: '◆', name: '庄家', role: '拆解与派发', color: 'amber' },
    { id: 'worker-a', glyph: '✦', name: 'Worker A', role: '检索 / 读取', color: 'teal' },
    { id: 'worker-b', glyph: '✿', name: 'Worker B', role: '归纳 / 写入', color: 'violet' }
  ];
  function teamBoardHTML() {
    const running = state.busy;
    const activeRole = running ? 'worker-a' : null;
    const cards = TEAM_ROLES.map((r) => {
      const isRunning = running && r.id === activeRole;
      const step = state.busyTaskId ? '占用中 · 1/1 名额' : '空闲 · 待派发';
      return '<div class="tm-card' + (isRunning ? ' running' : '') + '" data-role="' + r.id + '">' +
        '<span class="tm-glyph">' + r.glyph + '</span>' +
        '<span class="tm-names"><b>' + r.name + '</b><small>' + r.role + '</small>' +
        '<em>' + (isRunning ? '● 运行中' : step) + '</em></span></div>';
    }).join('');
    return '<div class="tm-board">' +
      '<div class="tm-head"><span>老板视角 · Agent 团队</span>' +
      '<span class="tm-slot">并发上限 1 · 本机顺序执行</span>' +
      '<button class="tm-close" id="tm-close" aria-label="收起团队看板">×</button></div>' +
      '<div class="tm-grid">' + cards + '</div>' +
      '<div class="tm-note">熔断：单任务最多 3 步由 Agent 引擎约束；这里如实显示本机「同时只跑一个」的真实形态，不虚构多进程并发。</div>' +
      '</div>';
  }

  /* ---------------- 本地持久化（只存任务历史，不上云） ---------------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(DB.getItem(KEY_PREF) || '{}');
      if (p.mode === 'chat' || p.mode === 'agent') state.mode = p.mode;
      if (typeof p.filesOpen === 'boolean') state.filesOpen = p.filesOpen;
    } catch (e) { /* 忽略 */ }
  }
  function savePrefs() {
    try {
      DB.setItem(KEY_PREF, JSON.stringify({ mode: state.mode, filesOpen: state.filesOpen }));
    } catch (e) { /* 忽略 */ }
  }

  function loadTasks() {
    try {
      const a = JSON.parse(DB.getItem(KEY_TASKS) || '[]');
      state.tasks = Array.isArray(a) ? a : [];
    } catch (e) { state.tasks = []; }
    state.activeId = state.tasks[0] ? state.tasks[0].id : null;
  }

  function saveTasks() {
    try {
      const slim = state.tasks.slice(0, 20).map((t) => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messages: (t.messages || []).slice(-40).map((m) => (
          m.role === 'tool'
            ? { role: 'tool', name: m.name, args: m.args, result: String(m.result || '').slice(0, 1500), ts: m.ts }
            : { role: m.role, text: String(m.text || '').slice(0, 4000), ts: m.ts }
        ))
      }));
      DB.setItem(KEY_TASKS, JSON.stringify(slim));
    } catch (e) { /* 超出配额时放弃写入，不阻塞交互 */ }
  }

  /* ---------------- 小工具 ---------------- */
  function brief(s) {
    const t = String(s || '新任务').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 46) : '新任务';
  }
  function trunc(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '\n…（已截断，共 ' + s.length + ' 字符）' : s;
  }
  function relTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function fileIcon(name) {
    if (/\.(js|mjs|cjs)$/.test(name)) return 'JS';
    if (/\.(py)$/.test(name)) return 'PY';
    if (/\.(json)$/.test(name)) return '{}';
    if (/\.(md)$/.test(name)) return 'MD';
    if (/\.(html?)$/.test(name)) return '<>';
    if (/\.(css)$/.test(name)) return '#';
    if (/\.(ts)$/.test(name)) return 'TS';
    return '·';
  }

  function activeTask() {
    return state.tasks.filter((t) => t.id === state.activeId)[0] || null;
  }

  function ensureTask(firstText) {
    let t = activeTask();
    if (t) return t;
    t = { id: U.uid(), title: brief(firstText), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.tasks.unshift(t);
    state.activeId = t.id;
    saveTasks();
    return t;
  }

  /* ---------------- 文件树 ---------------- */
  function countNodes(nodes) {
    let n = 0;
    (nodes || []).forEach((x) => { n++; if (Array.isArray(x.children)) n += countNodes(x.children); });
    return n;
  }

  function treeHTML(nodes) {
    if (!nodes || !nodes.length) return '<div class="cx2-hint">空工作区。让 Agent 建文件，或点「新建」。</div>';
    return nodes.map(nodeHTML).join('');
  }

  function nodeHTML(n) {
    if (n.type === 'dir') {
      return '<div class="cx2-node">' +
        '<div class="cx2-row" data-dir="' + U.escapeHtml(n.rel) + '">' +
        '<span class="cx2-caret">▸</span><span class="cx2-ic">▸</span>' +
        '<span class="cx2-fname">' + U.escapeHtml(n.name) + '</span></div>' +
        '<div class="cx2-children" data-children="' + U.escapeHtml(n.rel) + '" hidden>' + treeHTML(n.children) + '</div>' +
        '</div>';
    }
    const on = state.file && state.file.rel === n.rel ? ' on' : '';
    return '<div class="cx2-row cx2-leaf' + on + '" data-file="' + U.escapeHtml(n.rel) + '">' +
      '<span class="cx2-caret"></span><span class="cx2-ic">' + fileIcon(n.name) + '</span>' +
      '<span class="cx2-fname">' + U.escapeHtml(n.name) + '</span></div>';
  }

  function renderTree() {
    const el = document.getElementById('cx2-tree');
    if (el) el.innerHTML = treeHTML(state.listing);
  }

  /* ---------------- 工作区 ---------------- */
  async function reloadTree() {
    try {
      const r = await L.bridge.agent.getRoot();
      state.root = r.root;
      state.listing = r.listing || [];
    } catch (e) {
      state.root = '(无法访问工作区)';
      state.listing = [];
    }
    state.loaded = true;
    renderTree();
    // 目录是异步取回的；取回后刷新右栏上下文，避免「可见条目」一直显示 0
    if (!state.file && state.filesOpen) renderViewer();
    const p = document.getElementById('cx2-wspath');
    if (p) p.textContent = shortPath(state.root);
  }

  function shortPath(p) {
    p = String(p || '');
    if (p.length <= 26) return p;
    return '…' + p.slice(-25);
  }

  async function openFile(rel) {
    try {
      const content = await L.bridge.agent.read(rel);
      state.file = { rel, content, output: '', outputErr: false };
      state.editing = false;
      renderViewer();
      renderTree();
    } catch (e) {
      U.toast(e.message || '读取失败', 'error');
    }
  }

  /* ---------------- 右侧：文件面板 ---------------- */
  function renderViewer() {
    const box = document.getElementById('cx2-viewer');
    if (!box) return;
    const f = state.file;
    if (!f) {
      const visible = countNodes(state.listing);
      box.innerHTML = '<div class="cx2-context">' +
        '<h4>它看得到什么</h4>' +
        '<div class="cx2-ctx-row"><span>工作区</span><b>' + U.escapeHtml(shortPath(state.root || '未选择')) + '</b></div>' +
        '<div class="cx2-ctx-row"><span>可见条目</span><b>' + visible + ' 项</b></div>' +
        '<div class="cx2-ctx-row"><span>' + (L.bridge.mode === 'electron' ? '可调用工具' : '演示工具') + '</span><b>8 类' + (L.bridge.mode === 'electron' ? '' : '（预置）') + '</b></div>' +
        '<div class="cx2-ctx-row"><span>权限</span><b>' + (L.bridge.mode === 'electron' ? '读写本机' : '只读 · 虚拟工作区') + '</b></div>' +
        '<h4>它能动什么</h4>' +
        '<p>' + (L.bridge.mode === 'electron'
          ? '只能在选定工作区内读写文件。'
          : '网页版不接触本机磁盘：文件树与 diff 都来自内存中的虚拟工作区，刷新后仍在但只属于这个浏览器。真实读写本机文件请运行 Electron 桌面版。') + '</p>' +
        '<h4>成本</h4>' +
        '<p>' + (L.bridge.mode === 'electron'
          ? '本机执行不产生费用；只有你在设置里填写 API Key 后才会调用模型。'
          : '演示模式不调用模型，不计费。') + '</p>' +
        '<h4>产物</h4>' +
        '<p>点上面的文件可查看内容，文件改动会在运行流里留下逐行 diff。</p>' +
        '</div>';
      return;
    }
    const canRun = /\.(js|mjs|cjs|py)$/.test(f.rel);
    box.innerHTML = '' +
      '<div class="cx2-viewer-head">' +
      '<span class="cx2-viewer-path" title="' + U.escapeHtml(f.rel) + '">' + U.escapeHtml(f.rel) + '</span>' +
      '<button class="cx2-mini" id="cx2-edit">' + (state.editing ? '保存' : '编辑') + '</button>' +
      (canRun ? '<button class="cx2-mini" id="cx2-runfile">运行</button>' : '') +
      '</div>' +
      '<textarea id="cx2-filetext" class="cx2-filetext" spellcheck="false"' + (state.editing ? '' : ' readonly') + '></textarea>' +
      '<div class="cx2-viewer-out" id="cx2-fileout" hidden></div>';

    const ta = document.getElementById('cx2-filetext');
    if (ta) ta.value = f.content || '';
    if (f.output) {
      const out = document.getElementById('cx2-fileout');
      if (out) {
        out.hidden = false;
        out.textContent = f.output;
        out.className = 'cx2-viewer-out' + (f.outputErr ? ' err' : '');
      }
    }

    const editBtn = document.getElementById('cx2-edit');
    if (editBtn) {
      editBtn.addEventListener('click', async () => {
        if (!state.editing) {
          state.editing = true;
          renderViewer();
          const t = document.getElementById('cx2-filetext');
          if (t) t.focus();
          return;
        }
        const t = document.getElementById('cx2-filetext');
        try {
          await L.bridge.agent.write(f.rel, t ? t.value : f.content);
          f.content = t ? t.value : f.content;
          state.editing = false;
          U.toast('已保存 ' + f.rel);
          await reloadTree();
          renderViewer();
        } catch (e) { U.toast(e.message || '保存失败', 'error'); }
      });
    }

    const runBtn = document.getElementById('cx2-runfile');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const out = document.getElementById('cx2-fileout');
        if (out) { out.hidden = false; out.className = 'cx2-viewer-out'; out.textContent = '运行中…'; }
        const language = /\.py$/.test(f.rel) ? 'python' : 'js';
        try {
          const r = await L.bridge.agent.runCode({ language, code: f.content });
          let s = (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '');
          if (r.note) s += (s ? '\n\n' : '') + '[' + r.note + ']';
          else s += (s ? '\n\n' : '') + '[退出码 ' + r.code + ']';
          f.output = s || '(无输出)';
          f.outputErr = r.code !== 0;
        } catch (e) {
          f.output = String((e && e.message) || e);
          f.outputErr = true;
        }
        const o2 = document.getElementById('cx2-fileout');
        if (o2) {
          o2.hidden = false;
          o2.textContent = f.output;
          o2.className = 'cx2-viewer-out' + (f.outputErr ? ' err' : '');
        }
      });
    }
  }

  function renderFilesPanel() {
    const panel = document.getElementById('cx2-files');
    if (panel) panel.hidden = !state.filesOpen;
    const btn = document.getElementById('cx2-toggle-files');
    if (btn) btn.classList.toggle('on', state.filesOpen);
    if (state.filesOpen) { renderTree(); renderViewer(); }
  }

  /* ---------------- 任务流 ---------------- */
  function fmtDur(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  // 运行回执：只报真实测到的步数与耗时，不编造 token 或金额
  function receiptHTML(t) {
    const r = t && t.receipt;
    if (!r) return '';
    return '<div class="cx2-receipt">' +
      '<span><b>' + r.steps + '</b> 步</span>' +
      '<span><b>' + fmtDur(r.ms) + '</b> 用时</span>' +
      '<span>' + (r.mode === 'electron' ? '桌面端 · 本机执行' : '演示回放 · 未改动本机') + '</span>' +
      '<span class="cx2-receipt-mode">' + (r.stopped ? '已在第 ' + r.steps + ' 步停止' : (r.mode === 'electron' ? '已完成' : '回放结束')) + '</span>' +
      '</div>';
  }

  function updateStop() {
    const b = document.getElementById('cx2-stop');
    if (b) b.disabled = !state.busy;
    // 概念 7：团队看板占用状态跟随任务（局部更新，不重绘整页）
    const tb = document.getElementById('cx2-team-btn');
    if (tb) tb.innerHTML = '◆ 团队 ' + (state.busy ? '●' : '○');
    const cards = document.querySelectorAll('.tm-card');
    if (cards.length) {
      cards.forEach((c) => {
        const isWorker = /worker-a/.test(c.getAttribute('data-role') || '');
        c.classList.toggle('running', !!(state.busy && isWorker));
        const em = c.querySelector('em');
        if (em) em.textContent = (state.busy && isWorker) ? '● 运行中' : (state.busy ? '排队 · 名额 1/1' : '空闲 · 待派发');
      });
    }
  }

  function stepMeta(name, args) {
    args = args || {};
    if (name === 'run_command') return { icon: '$', label: String(args.command || '命令'), kind: 'cmd' };
    if (name === 'write_file') return { icon: '✎', label: '写入 ' + String(args.path || '文件'), kind: 'write' };
    if (name === 'read_file') return { icon: '▤', label: '读取 ' + String(args.path || ''), kind: 'read' };
    if (name === 'list_files') return { icon: '⌗', label: '浏览 ' + String(args.path || '.'), kind: 'list' };
    if (name === 'run_code') return { icon: '▶', label: '运行 ' + String(args.language || '代码'), kind: 'run' };
    if (name === 'memory_search') return { icon: '◌', label: '检索识海 ' + String(args.q || args.day || args.emo || ''), kind: 'read' };
    if (name === 'memory_event') return { icon: '◎', label: '展开记忆 · ' + String(args.name || ''), kind: 'read' };
    if (name === 'memory_write') return { icon: '◉', label: '写入识海', kind: 'write' };
    if (name === 'memory_capture') return { icon: '◌', label: '后台沉淀本轮原话', kind: 'other' };
    return { icon: '⚙', label: String(name || '工具'), kind: 'other' };
  }

  function stepHTML(m) {
    const meta = stepMeta(m.name, m.args);
    const failed = /失败|错误|Error|Traceback|ENOENT|not found|拒绝|超时/i.test(String(m.result || ''));
    let body;
    let open = '';
    if (meta.kind === 'write' && m.args && typeof m.args.content === 'string') {
      const lines = m.args.content.split('\n');
      const shown = lines.slice(0, 80).map((l) => '<span class="d-add">+' + U.escapeHtml(l) + '</span>').join('');
      const more = lines.length > 80 ? '\n<span class="d-more">… 另有 ' + (lines.length - 80) + ' 行</span>' : '';
      body = '<div class="cx2-diff"><div class="cx2-diff-head">' +
        '<span>' + U.escapeHtml(String(m.args.path || '')) + '</span>' +
        '<span class="d-count">+' + lines.length + '</span></div>' +
        '<pre>' + shown + more + '</pre></div>';
      open = lines.length <= 24 ? ' open' : '';
    } else {
      body = '<pre class="cx2-out">' + U.escapeHtml(trunc(m.result || '(无输出)', 2600)) + '</pre>';
    }
    // 展开后给逐字证据：入参原样、耗时，不把工具结果改写成散文
    const evidence = '<div class="cx2-evidence">' +
      '<span>入参</span><code>' + U.escapeHtml(trunc(JSON.stringify(m.args || {}), 320)) + '</code>' +
      '<span>耗时</span><code>' + fmtDur(m.ms) + '</code></div>';
    if (failed) open = ' open';
    return '<details class="cx2-step cx2-step-' + meta.kind + '"' + (failed ? ' data-failed="1"' : '') + open + '>' +
      '<summary><span class="cx2-step-icon">' + meta.icon + '</span>' +
      '<span class="cx2-step-label">' + U.escapeHtml(meta.label) + '</span>' +
      '<span class="cx2-step-dur">' + fmtDur(m.ms) + '</span>' +
      '<span class="cx2-step-chev">›</span></summary>' + evidence + body + '</details>';
  }

  function msgHTML(m) {
    if (m.role === 'user') {
      return '<div class="cx2-msg cx2-user"><div class="cx2-bubble">' +
        U.escapeHtml(m.text).replace(/\n/g, '<br>') + '</div></div>';
    }
    if (m.role === 'assistant') {
      return '<div class="cx2-msg cx2-assistant"><div class="cx2-mark">◇</div>' +
        '<div class="cx2-md">' + U.markdown(m.text || '') + '</div></div>';
    }
    if (m.role === 'tool') return stepHTML(m);
    if (m.role === 'error') {
      return '<div class="cx2-msg cx2-error"><div class="cx2-md">! ' + U.escapeHtml(m.text) + '</div></div>';
    }
    return '';
  }

  function heroHTML() {
    const chips = SUGGESTIONS.map((s, i) =>
      '<button class="cx2-chip" data-sug="' + i + '"><span class="cx2-chip-ic">' + s.icon + '</span>' +
      '<span>' + U.escapeHtml(s.text) + '</span></button>'
    ).join('');
    return '<div class="cx2-hero">' +
      '<div class="cx2-hero-mark">◇</div>' +
      '<h1 class="cx2-hero-title">有什么可以帮你构建的？</h1>' +
      '<p class="cx2-hero-sub">' + (L.bridge.mode === 'electron'
        ? '描述一个任务。Agent 会读文件、写代码、跑命令，一步步做到通过为止。'
        : '网页版是演示回放：会展示 Agent 的执行形态，但不会按你的指令真正改动本机文件。') + '</p>' +
      '<div class="cx2-chips">' + chips + '</div>' +
      '<div class="cx2-hero-note">' + (L.bridge.mode === 'electron'
        ? '桌面端 · 可读写本机文件、执行命令'
        : '演示模式 · 固定 4 步回放，产物仅写入虚拟工作区 · 真实执行需 Electron 桌面版') + '</div>' +
      '</div>';
  }

  function workingHTML() {
    return '<div class="cx2-msg cx2-assistant cx2-working"><div class="cx2-mark">◇</div>' +
      '<div class="cx2-working-row"><span class="cx2-dot"></span><span class="cx2-dot"></span><span class="cx2-dot"></span>' +
      '<span class="cx2-working-text">' + (state.mode === 'chat' ? '思考中' : '正在工作') + '</span></div></div>';
  }

  function scrollBottom() {
    const sc = document.getElementById('cx2-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  function renderThread() {
    const box = document.getElementById('cx2-thread');
    if (!box) return;
    const t = activeTask();
    const msgs = (t && t.messages) || [];
    box.innerHTML = msgs.length
      ? msgs.map(msgHTML).join('') + (state.busy && state.busyTaskId === state.activeId ? workingHTML() : '') + receiptHTML(t)
      : heroHTML();

    const title = document.getElementById('cx2-title');
    if (title) title.textContent = t ? t.title : '新任务';
    const sub = document.getElementById('cx2-sub');
    const toolSteps = msgs.filter((m) => m.role === 'tool').length;
    if (sub) sub.textContent = t ? (msgs.length ? (toolSteps ? toolSteps + ' 步操作 · ' : '') + relTime(t.createdAt) : '未开始') : '开始一个新任务';

    box.querySelectorAll('[data-sug]').forEach((b) => {
      b.addEventListener('click', () => {
        const s = SUGGESTIONS[Number(b.getAttribute('data-sug'))];
        const ta = document.getElementById('cx2-input');
        if (s && ta) { ta.value = s.text; ta.focus(); autoGrow(ta); }
      });
    });
    scrollBottom();
  }

  function renderTasks() {
    const box = document.getElementById('cx2-tasks');
    if (!box) return;
    if (!state.tasks.length) {
      // 空状态也把三种时态摆在同一屏，不让「排队 / 今天 / 更早」需要一个点击才出现
      box.innerHTML =
        '<div class="cx2-group" data-state="running"><span class="cx2-group-label">正在运行</span> · 0</div>' +
        '<div class="cx2-hint">当前没有运行中的任务</div>' +
        '<div class="cx2-group" data-state="today"><span class="cx2-group-label">今天</span> · 0</div>' +
        '<div class="cx2-hint">还没有任务，在下面输入第一句</div>' +
        '<div class="cx2-group" data-state="past"><span class="cx2-group-label">更早</span> · 0</div>' +
        '<div class="cx2-hint">任务在本机顺序执行，没有后台队列</div>';
      return;
    }
    // 三时态同屏：正在运行 / 今天 / 更早。没有队列机制就如实说明，不虚构排队。
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const running = [], today = [], past = [];
    state.tasks.forEach((t) => {
      if (state.busy && t.id === state.busyTaskId) running.push(t);
      else if ((t.updatedAt || 0) >= midnight.getTime()) today.push(t);
      else past.push(t);
    });
    const item = (t) => {
      const on = t.id === state.activeId ? ' on' : '';
      const dot = state.busy && t.id === state.busyTaskId ? '<span class="cx2-live" aria-label="运行中"></span>' : '';
      return '<div class="cx2-task' + on + '" data-task="' + U.escapeHtml(t.id) + '">' +
        '<span class="cx2-task-title">' + U.escapeHtml(t.title) + '</span>' + dot +
        '<button class="cx2-task-del" data-del="' + U.escapeHtml(t.id) + '" title="删除任务" aria-label="删除任务">×</button>' +
        '</div>';
    };
    const group = (label, list, key) => list.length
      ? '<div class="cx2-group" data-state="' + key + '"><span class="cx2-group-label">' + label + '</span> · ' + list.length + '</div>' + list.map(item).join('')
      : '';
    box.innerHTML =
      '<div class="cx2-group" data-state="running"><span class="cx2-group-label">正在运行</span> · ' + running.length + '</div>' +
      (running.length ? running.map(item).join('') : '<div class="cx2-hint">当前没有运行中的任务</div>') +
      group('今天', today, 'today') + group('更早', past, 'past') +
      '<div class="cx2-hint">任务在本机顺序执行，没有后台队列</div>';
  }

  /* ---------------- 发送 ---------------- */
  function chatSystem() {
    let sys = '你是一名资深软件工程师，用简体中文简洁、准确地回答编程问题。';
    const f = state.file;
    if (f && f.content) {
      sys += '\n\n当前查看的文件：' + f.rel + '\n```\n' + String(f.content).slice(0, 4000) + '\n```';
    }
    return sys;
  }

  function captureBrowser(task, messages) {
    if (L.bridge.mode === 'electron' || S.state.settings.mindseaAuto === false) return;
    L.bridge.mindsea.capture({ messages, settings: S.state.settings }).then((r) => {
      task.messages.push({ role: 'tool', name: 'memory_capture', args: { mode: r.mode || 'local' }, result: r.ok === false ? '沉淀失败：' + (r.errors || []).join('；') : '识海已沉淀 ' + (r.written || 0) + ' 条原话', ts: Date.now() });
      saveTasks();
      if (state.activeId === task.id) renderThread();
    }).catch((e) => {
      task.messages.push({ role: 'tool', name: 'memory_capture', args: {}, result: '识海沉淀失败：' + (e.message || e), ts: Date.now() });
      saveTasks();
      if (state.activeId === task.id) renderThread();
    });
  }

  function submit() {
    if (state.busy) { U.toast('Agent 正在运行，等这一步完成再发', 'error'); return; }
    const ta = document.getElementById('cx2-input');
    const text = (ta ? ta.value : '').trim();
    if (!text) return;

    const task = ensureTask(text);
    const captureFrom = task.messages.length;
    const includeMemoryTail = !task.messages.some((m) => m.role === 'user' || m.role === 'assistant');
    const runStart = Date.now();
    let lastAt = runStart;
    task.receipt = null;
    task.stopped = false;
    task.messages.push({ role: 'user', text, ts: Date.now() });
    task.title = brief(text);
    task.updatedAt = Date.now();
    state.tasks = [task].concat(state.tasks.filter((x) => x.id !== task.id));
    state.activeId = task.id;

    if (ta) { ta.value = ''; autoGrow(ta); }
    state.busy = true;
    state.busyTaskId = task.id;
    saveTasks(); renderTasks(); renderThread(); updateStop();

    const payload = {
      mode: state.mode,
      user: text,
      settings: S.state.settings,
      includeMemoryTail,
      system: state.mode === 'chat' ? chatSystem() : undefined
    };

    L.bridge.agent.runAgent(payload, (e) => {
      if (task.stopped) return;
      const now = Date.now();
      const stepMs = now - lastAt; lastAt = now;
      if (e.type === 'event') {
        const d = e.data || {};
        if (d.type === 'assistant') {
          if (d.text && String(d.text).trim()) {
            task.messages.push({ role: 'assistant', text: d.text, ts: now });
          }
        } else if (d.type === 'tool') {
          task.messages.push({ role: 'tool', name: d.name, args: d.args, result: d.result, ms: stepMs, ts: now });
          if (d.name === 'write_file' || d.name === 'run_command') reloadTree();
        }
        renderThread();
      } else if (e.type === 'done') {
        const fin = (e.data && e.data.finalAnswer) || '';
        const last = task.messages[task.messages.length - 1];
        if (fin && !(last && last.role === 'assistant' && last.text === fin)) {
          task.messages.push({ role: 'assistant', text: fin, ts: now });
        }
        task.receipt = {
          steps: task.messages.slice(captureFrom).filter((m) => m.role === 'tool').length,
          ms: Date.now() - runStart,
          mode: L.bridge.mode
        };
        state.busy = false;
        state.busyTaskId = null;
        task.updatedAt = Date.now();
        saveTasks(); renderTasks(); renderThread(); reloadTree(); updateStop();
        captureBrowser(task, task.messages.slice(captureFrom));
      } else if (e.type === 'error') {
        task.messages.push({ role: 'error', text: String(e.data || '发生错误'), ts: now });
        task.receipt = {
          steps: task.messages.slice(captureFrom).filter((m) => m.role === 'tool').length,
          ms: Date.now() - runStart, mode: L.bridge.mode, stopped: true
        };
        state.busy = false;
        state.busyTaskId = null;
        saveTasks(); renderTasks(); renderThread(); updateStop();
      }
    });
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!state.loaded) { loadPrefs(); loadTasks(); }
    const modeAgent = state.mode === 'agent' ? ' on' : '';
    const modeChat = state.mode === 'chat' ? ' on' : '';

    return '' +
      '<div class="cx2">' +
      '  <aside class="cx2-rail">' +
      '    <div class="cx2-rail-head">' +
      '      <span class="cx2-logo">◇</span><span class="cx2-brand">Codex</span>' +
      '      <button class="cx2-iconbtn" id="cx2-back" title="返回 LifeOS">←</button>' +
      '    </div>' +
      '    <button class="cx2-team-btn' + (state.teamOpen ? ' on' : '') + '" id="cx2-team-btn" ' +
      'title="老板视角：查看 Agent 团队分工与占用">◆ 团队 ' + (state.busy ? '●' : '○') + '</button>' +
      (state.teamOpen ? teamBoardHTML() : '') +
      '    <button class="cx2-new" id="cx2-new"><span>＋</span> 新建任务</button>' +
      '    <div class="cx2-tasklist" id="cx2-tasks"></div>' +
      '    <div class="cx2-rail-foot">' +
      '      <button class="cx2-ws" id="cx2-openws" title="选择工作区目录">' +
      '        <span class="cx2-ws-label">工作区</span>' +
      '        <span class="cx2-ws-path" id="cx2-wspath">' + U.escapeHtml(shortPath(state.root || '加载中…')) + '</span>' +
      '      </button>' +
      '      <div class="cx2-rail-note">任务与文件都在本机</div>' +
      '    </div>' +
      '  </aside>' +

      '  <section class="cx2-main">' +
      '    <header class="cx2-head">' +
      '      <div class="cx2-head-text">' +
      '        <div class="cx2-title" id="cx2-title">新任务</div>' +
      '        <div class="cx2-sub" id="cx2-sub">开始一个新任务</div>' +
      '      </div>' +
      '      <button class="cx2-ghost' + (state.filesOpen ? ' on' : '') + '" id="cx2-toggle-files">工作区</button>' +
      '    </header>' +
      '    <div class="cx2-body">' +
      '      <div class="cx2-chat">' +
      '        <div class="cx2-scroll" id="cx2-scroll"><div class="cx2-thread" id="cx2-thread"></div></div>' +
      '        <div class="cx2-composer-wrap">' +
      '          <div class="cx2-composer">' +
      '            <textarea id="cx2-input" rows="1" placeholder="描述任务，或直接提问…"></textarea>' +
      '            <div class="cx2-bar">' +
      '              <div class="cx2-seg">' +
      '                <button data-mode="agent" class="' + modeAgent.trim() + '">Agent</button>' +
      '                <button data-mode="chat" class="' + modeChat.trim() + '">问答</button>' +
      '              </div>' +
      '              <span class="cx2-model">' + U.escapeHtml(S.state.settings.aiModel || 'gpt-4o-mini') + '</span>' +
      '              <button class="cx2-stop" id="cx2-stop" disabled title="停止本次运行">停止</button>' +
      '              <button class="cx2-send" id="cx2-send" title="发送（Enter）">↑</button>' +
      '            </div>' +
      '          </div>' +
      '          <div class="cx2-foot-hint">Enter 发送 · Shift+Enter 换行 · 每一步都有耗时与入参，停止按钮一直在这里</div>' +
      '        </div>' +
      '      </div>' +
      '      <aside class="cx2-files" id="cx2-files" hidden>' +
      '        <div class="cx2-files-head">' +
      '          <span>工作区</span>' +
      '          <button class="cx2-mini" id="cx2-refresh" title="刷新">↻</button>' +
      '          <button class="cx2-mini" id="cx2-newfile" title="新建文件">＋</button>' +
      '        </div>' +
      '        <div class="cx2-tree" id="cx2-tree"></div>' +
      '        <div class="cx2-viewer" id="cx2-viewer"></div>' +
      '      </aside>' +
      '    </div>' +
      '  </section>' +
      '</div>';
  }

  function bind(root) {
    if (!state.loaded) { loadPrefs(); loadTasks(); }
    if (!state.loaded) reloadTree(); else { renderTree(); }

    renderTasks();
    renderThread();
    renderFilesPanel();
    updateStop();

    // 常驻停止：先在一帧内把界面置为 stopped，不等待后台回应
    const stopBtn = root.querySelector('#cx2-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => {
      if (!state.busy) return;
      const t = activeTask();
      if (t) {
        t.stopped = true;
        t.receipt = { steps: t.messages.filter((m) => m.role === 'tool').length, ms: null, mode: L.bridge.mode, stopped: true };
        t.updatedAt = Date.now();
      }
      state.busy = false;
      state.busyTaskId = null;
      saveTasks(); renderTasks(); renderThread(); updateStop();
      U.toast(L.bridge.mode === 'electron'
        ? '已停止接收新步骤；正在执行的命令会自然结束'
        : '已停止本次演示运行');
    });

    // 概念 7：老板视角团队看板开关
    const teamBtn = root.querySelector('#cx2-team-btn');
    if (teamBtn) teamBtn.addEventListener('click', () => {
      state.teamOpen = !state.teamOpen;
      if (state.teamOpen && L.pet) L.pet.observe('delegate'); // 行为沉淀
      if (L.app) L.app.refresh();
    });
    const tmClose = root.querySelector('#tm-close');
    if (tmClose) tmClose.addEventListener('click', () => { state.teamOpen = false; if (L.app) L.app.refresh(); });

    const back = root.querySelector('#cx2-back');
    if (back) back.addEventListener('click', () => L.app.showView('dashboard'));

    root.querySelector('#cx2-new').addEventListener('click', () => {
      state.activeId = null;
      renderTasks(); renderThread();
      const ta = document.getElementById('cx2-input');
      if (ta) ta.focus();
    });

    root.querySelector('#cx2-toggle-files').addEventListener('click', () => {
      state.filesOpen = !state.filesOpen;
      savePrefs();
      renderFilesPanel();
    });

    root.querySelector('#cx2-openws').addEventListener('click', async () => {
      const r = await L.bridge.agent.openWorkspace();
      if (r && r.root) {
        state.root = r.root;
        state.listing = r.listing || [];
        state.file = null;
        renderTree();
        const p = document.getElementById('cx2-wspath');
        if (p) p.textContent = shortPath(r.root);
        renderViewer();
      }
    });

    root.querySelector('#cx2-refresh').addEventListener('click', reloadTree);

    root.querySelector('#cx2-newfile').addEventListener('click', async () => {
      const name = window.prompt('新建文件名（相对工作区，如 src/a.js）：');
      if (!name || !name.trim()) return;
      try {
        await L.bridge.agent.write(name.trim(), '');
        await reloadTree();
        await openFile(name.trim());
      } catch (e) { U.toast(e.message || '创建失败', 'error'); }
    });

    // 任务列表：切换 / 删除
    root.querySelector('#cx2-tasks').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const id = del.getAttribute('data-del');
        const task = state.tasks.filter((t) => t.id === id)[0];
        const title = task ? task.title : '该任务';
        // 概念 5 点头原则：删任务也算危险操作，走「子宠物申请 → 主控点头」双阶段
        const allowed = (L.pet && L.pet.requestApproval)
          ? await L.pet.requestApproval({ desc: '删除 Codex 任务「' + title + '」' })
          : await U.confirm('删除任务「' + title + '」？');
        if (!allowed) return;
        state.tasks = state.tasks.filter((t) => t.id !== id);
        if (state.activeId === id) state.activeId = state.tasks[0] ? state.tasks[0].id : null;
        saveTasks(); renderTasks(); renderThread();
        return;
      }
      const item = e.target.closest('[data-task]');
      if (item) {
        state.activeId = item.getAttribute('data-task');
        state.file = null;
        savePrefs(); renderTasks(); renderThread(); renderViewer();
      }
    });

    // 文件树
    root.querySelector('#cx2-tree').addEventListener('click', (e) => {
      const leaf = e.target.closest('[data-file]');
      if (leaf) { openFile(leaf.getAttribute('data-file')); return; }
      const dir = e.target.closest('[data-dir]');
      if (dir) {
        const rel = dir.getAttribute('data-dir');
        const box = root.querySelector('[data-children="' + rel.replace(/"/g, '\\"') + '"]');
        const caret = dir.querySelector('.cx2-caret');
        if (box) {
          const hidden = box.hasAttribute('hidden');
          if (hidden) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
          if (caret) caret.textContent = hidden ? '▾' : '▸';
        }
      }
    });

    // 模式切换
    root.querySelectorAll('.cx2-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        state.mode = b.getAttribute('data-mode');
        savePrefs();
        root.querySelectorAll('.cx2-seg button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });

    root.querySelector('#cx2-send').addEventListener('click', submit);

    const ta = root.querySelector('#cx2-input');
    ta.addEventListener('input', () => autoGrow(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    ta.focus();
  }

  L.modules.codex = { render, bind };
})(window.LifeOS);
