/* =========================================================================
 * LifeOS · 应用入口 / 路由 / 主题 / 总览
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  const TITLES = {
    dashboard: '总览',
    tasks: '任务待办',
    habits: '习惯打卡',
    notes: '笔记日记',
    library: '知识库',
    calendar: '日历',
    heatmap: '活动热力图',
    graph: '知识图谱',
    mindsea: '识海记忆',
    codex: 'Codex',
    ai: 'AI 助手',
    settings: '设置'
  };

  const app = {
    current: 'dashboard',

    async init() {
      // W1：存储适配层启动迁移 / IDB 回填，必须在读数据之前完成。
      // 内部对无 indexedDB / 报错场景自动降级 legacy，不阻塞启动。
      if (L.storage && L.storage.hydrate) {
        try { await L.storage.hydrate(); } catch (_) { /* 已自动降级 */ }
      }
      await S.init();
      // PetOS：桌宠伙伴内核从独立 key 载入（故障与主数据隔离，损坏不影响启动）
      if (L.pet) { try { L.pet.load(); } catch (_) { /* 隔离失败也不阻塞主应用 */ } }
      // 首次启动注入内置知识内容（只注入一次，用户清空后不自动灌回）
      if (L.seedLibrary) L.seedLibrary.ensure(S);
      this.applyTheme(S.state.settings.theme || 'auto');
      this.bindNav();
      this.bindThemeToggle();
      // 支持深链：打开 #codex 等地址直接定位到对应视图
      const hash = (location.hash || '').replace(/^#/, '');
      this.showView(TITLES[hash] ? hash : 'dashboard');
      this.updateAIStatus();
      // 深链与前进/后退：地址栏 hash 变化时同步切换视图（以前只在启动时读一次）
      window.addEventListener('hashchange', () => {
        const h = (location.hash || '').replace(/^#/, '');
        if (TITLES[h] && h !== app.current) app.showView(h, true);
      });
      // 多标签同步：其他标签页写入数据时重新载入，避免旧视图把新数据覆盖回去
      window.addEventListener('storage', (e) => {
        if (!e.key || e.key.indexOf('lifeos-') !== 0 || S._saving) return;
        (async () => {
          try {
            // 先让存储适配层的内存缓存失效并重读 localStorage，避免拿到本标签旧值
            if (L.storage && L.storage.onExternalChange) L.storage.onExternalChange(e.key);
            await S.init();
            this.updateAIStatus();
            this.refresh();
            U.toast('已同步其他标签页的更新');
          } catch (_) { /* 数据暂不可读时保持当前视图 */ }
        })();
      });
    },

    bindNav() {
      document.querySelectorAll('#nav .nav-item').forEach((b) => {
        b.addEventListener('click', () => {
          this.showView(b.getAttribute('data-view'));
          this.closeNavDrawer();
        });
      });
      const toggle = document.getElementById('nav-toggle');
      const scrim = document.getElementById('nav-scrim');
      const sidebar = document.querySelector('.sidebar');
      if (toggle) toggle.addEventListener('click', () => {
        const open = sidebar.classList.toggle('open');
        if (scrim) scrim.classList.toggle('show', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      if (scrim) scrim.addEventListener('click', () => this.closeNavDrawer());
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.modal-overlay.show')) return;
        if (sidebar && sidebar.classList.contains('open')) this.closeNavDrawer();
      });
      // W2 · B4 全局检索：顶栏按钮 + Ctrl/⌘ + K（已有弹窗时不重复打开）
      const gsBtn = document.getElementById('global-search');
      if (gsBtn) gsBtn.addEventListener('click', () => this.openGlobalSearch());
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          if (!document.querySelector('.modal-overlay.show')) this.openGlobalSearch();
        }
      });
    },

    openGlobalSearch() {
      if (L.modules && L.modules.search && L.modules.search.open) L.modules.search.open();
    },

    closeNavDrawer() {
      const sidebar = document.querySelector('.sidebar');
      const scrim = document.getElementById('nav-scrim');
      const toggle = document.getElementById('nav-toggle');
      if (sidebar) sidebar.classList.remove('open');
      if (scrim) scrim.classList.remove('show');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    },

    bindThemeToggle() {
      const btn = document.getElementById('theme-toggle');
      btn.addEventListener('click', () => {
        // 以「偏好」为准而非当前 DOM，避免 auto 被误判成 dark 后无法回到跟随系统
        const pref = S.state.settings.theme || 'auto';
        const cur = pref === 'auto' ? this.systemTheme() : pref;
        const next = cur === 'light' ? 'dark' : 'light';
        S.setSettings({ theme: next });
        this.applyTheme(next);
        this.updateAIStatus();
        const sel = document.getElementById('s-theme');
        if (sel) sel.value = next;
      });
    },

    systemTheme() {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    },

    applyTheme(theme) {
      const t = theme === 'auto' ? this.systemTheme() : theme;
      document.documentElement.setAttribute('data-theme', t);
      // 地址栏 / PWA 标题栏配色跟随主题，消除改版后残留的旧近黑色
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'light' ? '#e9eeed' : '#0d1514');
      const btn = document.getElementById('theme-toggle');
      if (btn) {
        const use = btn.querySelector('use');
        if (use) use.setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun');
        btn.setAttribute('aria-label', t === 'light' ? '切换到深色主题' : '切换到浅色主题');
      }
      this.bindSystemTheme();
    },

    bindSystemTheme() {
      if (!window.matchMedia || this._mm) return;
      const mm = window.matchMedia('(prefers-color-scheme: light)');
      const cb = () => {
        if ((S.state.settings.theme || 'auto') === 'auto') this.applyTheme('auto');
      };
      if (mm.addEventListener) mm.addEventListener('change', cb);
      else if (mm.addListener) mm.addListener(cb);
      this._mm = mm;
    },

    showView(name, fromHash) {
      if (!TITLES[name]) name = 'dashboard';
      this.current = name;
      document.querySelectorAll('#nav .nav-item').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-view') === name);
      });
      document.getElementById('view-title').textContent = TITLES[name];
      // Codex 视图占满整窗（隐藏 LifeOS 侧栏与顶栏），保持与 Codex 一致的形态
      document.body.classList.toggle('codex-mode', name === 'codex');
      // 同步地址栏 hash，产生历史记录；hashchange 回来时 fromHash 避免重复渲染
      if (!fromHash && location.hash !== '#' + name) location.hash = name;
      this.refresh();
    },

    refresh() {
      const view = document.getElementById('view');
      const mod = L.modules[this.current];
      if (!mod) return;
      view.innerHTML = mod.render();
      if (mod.bind) mod.bind(view);
      // 通用跨视图跳转（空态引导 / 提示条），任何模块都能用 data-go
      view.querySelectorAll('[data-go]').forEach((b) =>
        b.addEventListener('click', () => this.showView(b.getAttribute('data-go'))));
    },

    updateAIStatus() {
      const el = document.getElementById('ai-status');
      const badge = document.getElementById('mode-badge');
      if (el) {
        el.textContent = S.state.settings.aiKey ? 'AI：已连接 ✓' : 'AI：演示模式';
        el.classList.toggle('ok', !!S.state.settings.aiKey);
      }
      if (badge) badge.textContent = L.bridge.mode === 'electron' ? '桌面端 · 本地' : '本地存储';
      const demo = document.getElementById('demo-pill');
      if (demo) demo.hidden = L.bridge.mode === 'electron';
    },

    /* ---------------- 总览 ---------------- */
    dashboardHTML() {
      const st = S.state;
      const now = new Date();
      const h = now.getHours();
      const greet = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      const name = st.settings.userName ? '，' + U.escapeHtml(st.settings.userName) : '';
      const openTasks = st.tasks.filter((t) => t.status !== 'done');
      const overdue = openTasks.filter((t) => t.due && t.due < U.todayStr());
      const todayHabits = st.habits;
      const doneToday = todayHabits.filter((x) => (x.checkins || {})[U.todayStr()]).length;
      const notes = st.notes.length;
      // 内置示例内容不计入「我的知识」，避免首屏出现假的 17 条
      const kb = (st.library || []).filter((x) => !(L.seedLibrary && L.seedLibrary.isSeedItem(x))).length;

      // 只提醒一次的备份提示：攒到少量自己的数据后再出现，不打扰全新用户
      let tipDone = false;
      try { tipDone = !!DB.getItem('lifeos-backup-tip-done'); } catch (_) { /* noop */ }
      const ownItems = st.tasks.length + st.habits.length + st.notes.length +
        st.aiThread.length + (st.events || []).length;
      const backupTip = (!tipDone && ownItems >= 3)
        ? '<div class="backup-tip">▣ 数据只保存在这台设备的浏览器里，清缓存或换设备会丢失。' +
          '<div class="spacer"></div>' +
          '<button class="link-btn" id="dash-export">立即导出备份</button>' +
          '<button class="link-btn" id="dash-tip-hide">不再提醒</button></div>'
        : '';

      const statCards = [
        { n: openTasks.length, l: '待办任务', c: 'c-blue', icon: '✓' },
        { n: overdue.length, l: '已逾期', c: overdue.length ? 'c-red' : 'c-green', icon: '◷' },
        { n: doneToday + '/' + todayHabits.length, l: '今日打卡', c: 'c-orange', icon: '◆' },
        { n: notes, l: '笔记', c: 'c-purple', icon: '✎' },
        { n: kb, l: '知识条目', c: 'c-blue', icon: '▤' }
      ].map((s) =>
        '<div class="stat-card ' + s.c + '"><div class="sc-icon">' + s.icon + '</div>' +
        '<div class="sc-num">' + s.n + '</div><div class="sc-label">' + s.l + '</div></div>'
      ).join('');

      const taskList = openTasks.length
        ? openTasks.slice(0, 6).map((t) =>
          '<li class="dash-task" data-id="' + U.escapeHtml(t.id) + '">' +
          '<span class="badge ' + ({ high: 'p-high', medium: 'p-medium', low: 'p-low' }[t.priority] || 'p-medium') + '">' + ({ high: '高', medium: '中', low: '低' }[t.priority] || '中') + '</span>' +
          '<span class="dt-title">' + U.escapeHtml(t.title) + '</span>' +
          (t.due ? '<span class="due">' + U.escapeHtml(U.fmtDate(t.due)) + '</span>' : '') + '</li>'
        ).join('')
        : '<li class="dash-empty">今天没有待办任务。<button class="link-btn" data-go="tasks">＋ 新建任务</button></li>';

      const habitList = todayHabits.length
        ? todayHabits.map((x) => {
          const on = (x.checkins || {})[U.todayStr()];
          return '<button class="dash-habit' + (on ? ' on' : '') + '" data-id="' + U.escapeHtml(x.id) + '" style="--hc:' + U.safeColor(x.color) + '">' +
            '<span>' + U.escapeHtml(x.emoji || '◆') + ' ' + U.escapeHtml(x.name) + '</span>' +
            '<span>' + (on ? '✓' : '○') + '</span></button>';
        }).join('')
        : '<div class="dash-empty">还没有习惯。<button class="link-btn" data-go="habits">＋ 创建一个</button></div>';

      // PetOS 桌宠伙伴（概念 1/5/6/8）：常驻案头，会呼吸、说话、切宠物、点头授权
      const petPanel = (L.pet && L.petRenderer) ? L.petRenderer.dashboardPanel() : '';
      // 9 大概念能力带：一眼可见的总览，点按直达各自落点
      const conceptsStrip = (L.pet && L.petRenderer && L.petRenderer.conceptsStrip)
        ? L.petRenderer.conceptsStrip() : '';

      return '' +
        '<div class="page dashboard">' +
        '  <div class="greet">' + greet + name + '  <span class="greet-date">' + now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) + '</span></div>' +
        backupTip +
        (petPanel || '') +
        (conceptsStrip || '') +
        '  <div class="stat-grid">' + statCards + '</div>' +
        '  <div class="dash-cols">' +
        '    <div class="dash-col">' +
        '      <div class="dash-head">今日任务 <button class="link-btn" data-go="tasks">查看全部 →</button></div>' +
        '      <ul class="dash-list">' + taskList + '</ul>' +
        '    </div>' +
        '    <div class="dash-col">' +
        '      <div class="dash-head">今日打卡 <button class="link-btn" data-go="habits">去打卡 →</button></div>' +
        '      <div class="dash-habit-list">' + habitList + '</div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="dash-ai-tip">◇ 刚开始使用？先 <button class="link-btn" data-go="tasks">建一个任务</button> 或 <button class="link-btn" data-go="notes">写篇笔记</button>；日历里也能直接记日程。</div>' +
        '</div>';
    }
  };

  /* =====================================================================
   * PetOS 渲染器（内嵌于 app.js，不新增源文件 / 不新增导航）
   * 概念 1 具身化 / 5 点头 / 6 多宠物 / 8 数字分身 / 9 A2A 的门面。
   * 只做渲染与事件绑定，状态一律经 L.pet 内核，配色一律用 CSS 变量。
   * ===================================================================== */
  L.petRenderer = (function () {
    'use strict';
    const P = L.pet;

    // 情境化说话：基于真实数据，不编造能力
    function greeting() {
      if (!P) return '嗨，我是你的桌宠伙伴。';
      const st = S.state;
      const open = (st.tasks || []).filter((t) => t.status !== 'done').length;
      const h = new Date().getHours();
      const pet = P.activePet();
      const gear = pet ? P.gearOf(pet.equip) : null;
      let line;
      if (h >= 22 || h < 6) line = '夜深了，我陪你把最后这点收尾。';
      else if (open > 5) line = '今天有 ' + open + ' 项待办，我帮你盯着节奏。';
      else if (open > 0) line = '还有 ' + open + ' 项待办，按你的步调来就好。';
      else line = '今天没有待办，正好把知识连成小屋。';
      if (gear && gear.id !== 'none') line += '（已装备' + gear.name + '）';
      return line;
    }

    // 桌宠 SVG：分层团子生物，呼吸/眨眼由 CSS 驱动，装备以帽子叠加
    function petSVG(pet, mood) {
      const glyph = U.escapeHtml(pet.glyph || '◕');
      const hat = pet.equip && pet.equip !== 'none'
        ? '<g class="pet-hat"><rect x="34" y="8" width="52" height="12" rx="4"/>' +
          '<text x="60" y="18" text-anchor="middle">' + U.escapeHtml(P.gearOf(pet.equip).glyph) + '</text></g>'
        : '';
      const eyes = mood === 'happy'
        ? '<path d="M44 58 q6 -7 12 0 M64 58 q6 -7 12 0" class="pet-eye-line"/>'
        : '<circle cx="50" cy="58" r="3.2" class="pet-eye"/><circle cx="70" cy="58" r="3.2" class="pet-eye"/>';
      return '' +
        '<svg class="pet-svg mood-' + U.escapeHtml(mood || 'idle') + '" viewBox="0 0 120 120" aria-hidden="true">' +
        '  <ellipse class="pet-shadow" cx="60" cy="108" rx="30" ry="5"/>' +
        '  <g class="pet-body">' +
        '    <path class="pet-shape" d="M60 20 C88 20 102 44 102 68 C102 92 84 104 60 104 C36 104 18 92 18 68 C18 44 32 20 60 20 Z"/>' +
        '    <ellipse class="pet-belly" cx="60" cy="80" rx="24" ry="16"/>' +
        eyes +
        '    <path class="pet-mouth" d="M54 72 q6 6 12 0"/>' +
        '    <circle class="pet-blush" cx="38" cy="68" r="5"/><circle class="pet-blush" cx="82" cy="68" r="5"/>' +
        '    <text class="pet-glyph" x="60" y="46" text-anchor="middle">' + glyph + '</text>' +
        hat +
        '  </g>' +
        '</svg>';
    }

    function dashboardPanel() {
      if (!P) return '';
      const pets = P.get().pets;
      const active = P.activePet();
      const chips = pets.map((p) =>
        '<button class="pet-chip' + (p.id === active.id ? ' on' : '') + '" data-pet="' + U.escapeHtml(p.id) + '" ' +
        'title="' + U.escapeHtml(p.role) + '" aria-pressed="' + (p.id === active.id) + '">' +
        '<span class="pc-glyph">' + U.escapeHtml(p.glyph) + '</span>' +
        '<span class="pc-name">' + U.escapeHtml(p.name) + '</span></button>'
      ).join('');
      const skills = P.userSkills();
      const skillLine = skills.length
        ? '已从你的行为学到：' + skills.slice(0, 3).map((s) => '<span class="pet-skill">✧ ' + U.escapeHtml(s) + '</span>').join('')
        : '和你相处还不久，多互动几次我会更懂你。';
      const gear = P.gearOf(active.equip);
      // 真实互动统计（来自 L.pet.stats，不编造）：把「分身在观察你」可视化
      const stat = P.stats();
      const vitals = [
        { n: (stat.feeds || 0) + (stat.links || 0), l: '内化/连线' },
        { n: stat.houseBuilds || 0, l: '搭过小屋' },
        { n: (stat.nods || 0) + (stat.approvalsDenied || 0), l: '点头授权' },
        { n: stat.chats || 0, l: '陪你聊天' }
      ].map((v) =>
        '<span class="pv-item"><b>' + v.n + '</b>' + U.escapeHtml(v.l) + '</span>').join('');

      return '' +
        '<section class="pet-panel" aria-label="桌宠伙伴">' +
        '  <div class="pet-stage tint-' + U.escapeHtml(active.tint) + '" id="pet-stage">' +
        '    <div class="pet-live"><i></i>伙伴在线</div>' +
        '    <div class="pet-halo" aria-hidden="true"></div>' +
        '    <div class="pet-bubble" id="pet-bubble">' + U.escapeHtml(greeting()) + '</div>' +
        '    ' + petSVG(active, 'idle') +
        '    <div class="pet-nameplate"><b>' + U.escapeHtml(active.name) + '</b><span>' + U.escapeHtml(gear.name) + ' · ' + U.escapeHtml(gear.role) + '</span></div>' +
        '  </div>' +
        '  <div class="pet-side">' +
        '    <div class="pet-side-h">我的宠物 <span class="pet-count">' + pets.length + ' 只</span></div>' +
        '    <div class="pet-chips" id="pet-chips">' + chips +
        '      <button class="pet-add" id="pet-add" title="领养一只新宠物">＋</button></div>' +
        '    <div class="pet-side-h">给它装备（戴上即专家）</div>' +
        '    <div class="pet-gears" id="pet-gears">' + P.equipment().map((e) =>
        '      <button class="pet-gear' + (e.id === active.equip ? ' on' : '') + '" data-gear="' + e.id + '" ' +
        'title="' + U.escapeHtml(e.role) + '" aria-pressed="' + (e.id === active.equip) + '">' +
        U.escapeHtml(e.glyph) + '</button>').join('') + '</div>' +
        '    <div class="pet-vitals" aria-label="真实互动记录">' + vitals + '</div>' +
        '    <div class="pet-twin"><span class="pt-ic">☯</span><div>' + skillLine + '</div></div>' +
        '    <div class="pet-actions">' +
        '      <button class="btn ghost btn-xs" id="pet-talk">💬 说句话</button>' +
        '      <button class="btn ghost btn-xs" id="pet-nod">◇ 点头授权演示</button>' +
        '    </div>' +
        '  </div>' +
        '</section>';
    }

    // 9 大概念能力带：把散落各处的落点收拢成一眼可见的总览
    function conceptsStrip() {
      const cells = [
        { g: '❂', n: '具身伙伴', v: 'dashboard', d: '案头常驻' },
        { g: '◈', n: '吞入内化', v: 'library', d: '知识嚼成卡片' },
        { g: '⌂', n: '知识小屋', v: 'graph', d: '把知识搭成屋' },
        { g: '✦', n: '装备专家', v: 'ai', d: '戴上即专家' },
        { g: '✓', n: '点头授权', v: 'codex', d: '危险先请示' },
        { g: '❖', n: '多宠生态', v: 'dashboard', d: '领养与切换' },
        { g: '▦', n: '老板视图', v: 'codex', d: '调度小队' },
        { g: '☯', n: '数字分身', v: 'settings', d: '从行为懂你' },
        { g: '⇄', n: '多端社交', v: 'settings', d: 'A2A 协作' }
      ];
      return '' +
        '<section class="concept-strip" aria-label="Agent Pet OS 九大能力">' +
        '  <div class="cs-head"><span class="cs-title">✦ Agent Pet OS · 九大能力已就位</span>' +
        '    <span class="cs-sub">点按直达 · 每个落点都是真实可用的功能</span></div>' +
        '  <div class="cs-grid">' + cells.map((c) =>
        '    <button class="cs-cell" data-go="' + c.v + '">' +
        '      <span class="cs-glyph">' + c.g + '</span>' +
        '      <span class="cs-name">' + c.n + '</span>' +
        '      <span class="cs-desc">' + c.d + '</span>' +
        '    </button>').join('') +
        '  </div>' +
        '</section>';
    }

    const TALKS = [
      '要不要把最近的知识用 [[双向链接]] 连起来？',
      '我在这儿，随时可以唤我聊天。',
      '危险的事我会先问你，绝不擅自动手。',
      '给知识库条目点「内化」，我嚼一嚼吐成卡片。',
      '戴上学者帽，我回答会更注重引用来源。'
    ];
    let talkIdx = 0;

    function say(msg) {
      const bubble = document.getElementById('pet-bubble');
      if (!bubble) return;
      bubble.textContent = msg;
      bubble.classList.add('talking');
      clearTimeout(bubble._t);
      bubble._t = setTimeout(() => bubble.classList.remove('talking'), 3200);
      P.observe('chat');
      // 夜间行为沉淀为分身偏好
      P.observe('night');
    }

    function bind(root) {
      if (!P) return;
      const stage = root.querySelector('#pet-stage');

      root.querySelectorAll('[data-pet]').forEach((b) => b.addEventListener('click', () => {
        P.setActive(b.getAttribute('data-pet'));
        P.observe('chat');
        if (L.app) L.app.refresh();
      }));

      const add = root.querySelector('#pet-add');
      if (add) add.addEventListener('click', () => U.modal({
        title: '领养一只新宠物',
        bodyHTML: '<div class="form">' +
          '<label>给它起个名字</label><input id="np-name" class="input" placeholder="如：小搜" maxlength="40"/>' +
          '<label>它的职责</label><input id="np-role" class="input" placeholder="如：专管检索" maxlength="60"/>' +
          '<p class="hint">新宠物加入名册，随时可切换与装备。名册独立存储，不影响你的任务与笔记。</p>' +
          '<div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
          '<button class="btn primary" data-act="ok">领养</button></div></div>',
        onMount(mroot, close) {
          mroot.querySelector('[data-act="cancel"]').addEventListener('click', close);
          mroot.querySelector('[data-act="ok"]').addEventListener('click', () => {
            const name = mroot.querySelector('#np-name').value.trim();
            const role = mroot.querySelector('#np-role').value.trim();
            const created = P.addPet({ name: name || '新伙伴', role: role || '待分配任务', glyph: '✦' });
            close();
            if (created) { U.toast('已领养 ' + created.name); if (L.app) L.app.refresh(); }
            else U.toast('名册已满（最多 64 只）', 'error');
          });
        }
      }));

      root.querySelectorAll('[data-gear]').forEach((b) => b.addEventListener('click', () => {
        const id = b.getAttribute('data-gear');
        if (P.equipActive(id)) {
          const g = P.gearOf(id);
          say('装备好了：' + g.name + '。' + g.role);
          if (L.app) L.app.refresh();
        }
      }));

      const talk = root.querySelector('#pet-talk');
      if (talk) talk.addEventListener('click', () => say(TALKS[talkIdx++ % TALKS.length]));

      // 点头原则现场演示：双阶段授权，任一阶段拒绝都不执行
      const nod = root.querySelector('#pet-nod');
      if (nod) nod.addEventListener('click', async () => {
        const ok = await P.requestApproval({ desc: '演示：清理 3 条过期知识卡片' });
        if (ok) U.toast('主控已点头 · 授权通过（本次为演示，未真实删除）');
        else U.toast('已拒绝或取消 · 未执行任何操作');
      });

      // 轻点头像也让桌宠回应
      if (stage) stage.addEventListener('click', (e) => {
        if (e.target.closest('.pet-gear') || e.target.closest('.pet-chip')) return;
        if (Math.random() < 0.5) say(TALKS[talkIdx++ % TALKS.length]);
      });
    }

    return { dashboardPanel, conceptsStrip, bind, say, greeting };
  })();

  // 注册总览为模块
  L.modules.dashboard = {
    render: () => app.dashboardHTML(),
    bind: (root) => {
      // PetOS 桌宠伙伴交互（具身/换宠/装备/点头/说话）
      if (L.petRenderer) L.petRenderer.bind(root);
      root.querySelectorAll('.dash-task').forEach((li) => li.addEventListener('click', () => {
        if (L.modules.tasks && L.modules.tasks.focusTask) L.modules.tasks.focusTask(li.getAttribute('data-id'));
      }));
      root.querySelectorAll('.dash-habit').forEach((b) => b.addEventListener('click', () => { S.toggleHabitCheckin(b.getAttribute('data-id'), U.todayStr()); app.refresh(); }));
      const markTipDone = () => { try { DB.setItem('lifeos-backup-tip-done', '1'); } catch (_) { /* noop */ } };
      const ex = root.querySelector('#dash-export');
      if (ex) ex.addEventListener('click', () => {
        const name = S.downloadBackup();
        markTipDone();
        U.toast('已导出 ' + name);
        app.refresh();
      });
      const hide = root.querySelector('#dash-tip-hide');
      if (hide) hide.addEventListener('click', () => { markTipDone(); app.refresh(); });
    }
  };

  L.app = app;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
  } else {
    app.init();
  }

  // PWA：仅在浏览器（非 Electron / 非 ArkWeb）且安全上下文下注册离线 Service Worker
  if (!window.electronAPI && 'serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // 每次启动主动检查一次 SW 更新（浏览器默认可能 24h 才查）
        reg.update().catch(() => {});
        // 回访用户已有旧 SW 接管：新 SW 接管后自动刷新一次，避免停留在旧页面
        if (hadController) {
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (sessionStorage.getItem('lifeos-sw-reload')) return;
            sessionStorage.setItem('lifeos-sw-reload', '1');
            location.reload();
          });
        }
      }).catch(() => { /* 忽略注册失败 */ });
    });
  }
})(window.LifeOS);
