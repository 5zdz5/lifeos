/* =========================================================================
 * LifeOS · 通用工具
 * 提供：ID/日期/格式化、Markdown 渲染、toast 提示、模态框、事件总线
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  const utils = {
    /* 生成短随机 ID */
    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    /* 今天 YYYY-MM-DD（本地时区） */
    todayStr() {
      const d = new Date();
      const off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().slice(0, 10);
    },

    /* N 天前的日期字符串 */
    dateStrOffset(n) {
      const d = new Date();
      d.setDate(d.getDate() - n);
      const off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().slice(0, 10);
    },

    /* 友好日期：今天 / 昨天 / MM-DD */
    fmtDate(s) {
      if (!s) return '';
      if (s === utils.todayStr()) return '今天';
      if (s === utils.dateStrOffset(1)) return '昨天';
      return s.slice(5);
    },

    /* 星期几 */
    weekday(s) {
      const d = new Date(s + 'T00:00:00');
      return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    },

    /* 时间戳 / Date → 本地时区 YYYY-MM-DD（与 stats.activity 口径一致）。
     * W2 起供 Daily Notes、全局检索等复用，避免各处重复实现时区逻辑。 */
    dateKey(ts) {
      const d = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(d.getTime())) return '';
      const off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().slice(0, 10);
    },

    /* 中文完整日期：YYYY年M月D日 · 周X
     * 原生 input[type=date] 会按浏览器 UI 语言显示 mm/dd/yyyy，中文用户容易读错；
     * 表单里用它做实时回显，既不牺牲原生控件的可访问性与校验，又消除格式歧义。 */
    cnDate(s) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return '';
      const d = new Date(s + 'T00:00:00');
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + utils.weekday(s);
    },

    /* HTML 转义 */
    escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /* URL 协议白名单：只放行 http(s)/mailto/相对路径/锚点。
     * 用于任何会被写进 href 的外部内容（Markdown 链接、知识库来源 URL 等）。
     * 先剔除空白与控制字符再判协议，防 "java\nscript:" 之类绕过。 */
    safeUrl(raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!s) return '';
      const compact = s.replace(/[\u0000-\u0020\u007f]/g, '');
      if (/^(javascript|data|vbscript|file|blob|about):/i.test(compact)) return '#';
      if (/^https?:\/\//i.test(compact) || /^mailto:/i.test(compact)) return s;
      if (/^(\/|\.\/|\.\.\/|#|\?)/.test(s)) return s;
      if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(compact) && !/[\u0000-\u001f]/.test(s)) return s;
      return '#';
    },

    /* 颜色白名单：只允许 #hex，避免不可信数据打断 style 属性 */
    safeColor(raw, fallback) {
      const s = String(raw == null ? '' : raw).trim();
      return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : (fallback || '#176c6b');
    },

    /* 极简 Markdown -> HTML（标题/加粗/斜体/行内代码/列表/引用/链接/换行） */
    markdown(src) {
      if (!src) return '';
      const esc = utils.escapeHtml;
      const lines = esc(src).split('\n');
      let html = '';
      let inList = false;
      let inQuote = false;
      const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
      const closeQuote = () => { if (inQuote) { html += '</blockquote>'; inQuote = false; } };

      for (let raw of lines) {
        let line = raw;
        if (/^\s*###\s+/.test(line)) { closeList(); closeQuote(); html += '<h3>' + line.replace(/^\s*###\s+/, '') + '</h3>'; continue; }
        if (/^\s*##\s+/.test(line)) { closeList(); closeQuote(); html += '<h2>' + line.replace(/^\s*##\s+/, '') + '</h2>'; continue; }
        if (/^\s*#\s+/.test(line)) { closeList(); closeQuote(); html += '<h1>' + line.replace(/^\s*#\s+/, '') + '</h1>'; continue; }
        if (/^\s*>\s?/.test(line)) { closeList(); if (!inQuote) { html += '<blockquote>'; inQuote = true; } html += '<p>' + line.replace(/^\s*>\s?/, '') + '</p>'; continue; }
        if (/^\s*[-*]\s+/.test(line)) { closeQuote(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>'; continue; }
        if (/^\s*$/.test(line)) { closeList(); closeQuote(); continue; }
        closeList(); closeQuote();
        html += '<p>' + line + '</p>';
      }
      closeList(); closeQuote();

      // 行内：加粗、斜体、行内代码、普通链接
      html = html
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, label, url) {
          return '<a href="' + utils.safeUrl(url) + '" target="_blank" rel="noopener">' + label + '</a>';
        });
      // Obsidian 风格 [[双向链接]] / [[目标|显示文本]]（放在最后，避免被上面的行内规则误伤）
      html = html.replace(/\[\[([^\]]+)\]\]/g, function (m, inner) {
        const p = inner.split('|');
        const target = p[0].trim();
        const label = (p[1] || p[0]).trim();
        if (!target) return m;
        return '<a href="#" class="wikilink" data-wiki="' + target + '">' + label + '</a>';
      });
      return html;
    },

    /* toast 轻提示 */
    toast(msg, type) {
      let el = document.getElementById('toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.className = 'toast show' + (type ? ' toast-' + type : '');
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.className = 'toast'; }, 2200);
    },

    /* 通用模态框
     * opts: { title, bodyHTML, onMount(root), onClose, wide? }
     * wide=true 时用更宽的容器（全局检索等结果面板），默认宽度不变。
     * 返回 close 函数
     */
    modal(opts) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal' + (opts.wide ? ' wide' : '') + '">' +
        '  <div class="modal-head"><span class="modal-title">' + utils.escapeHtml(opts.title || '') + '</span>' +
        '    <button class="modal-close" aria-label="关闭">×</button></div>' +
        '  <div class="modal-body">' + (opts.bodyHTML || '') + '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 160);
        if (opts.onClose) opts.onClose();
      };
      overlay.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

      /* 键盘契约：ESC 关闭、输入框内 Enter 提交主操作、打开后自动聚焦。
       * 只对最上层弹窗生效；确认框刻意不接 Enter，避免回车误触删除/覆盖。 */
      function onKey(e) {
        const all = document.querySelectorAll('.modal-overlay.show');
        if (all.length && all[all.length - 1] !== overlay) return;
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.ctrlKey && !e.metaKey) {
          const t = e.target;
          if (t && (/^(TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable)) return;
          const submit = overlay.querySelector('[data-act="save"], .modal-actions .btn.primary');
          if (submit) { e.preventDefault(); submit.click(); }
        }
      }
      document.addEventListener('keydown', onKey, true);

      if (opts.onMount) opts.onMount(overlay.querySelector('.modal-body'), close);
      requestAnimationFrame(() => {
        overlay.classList.add('show');
        const first = overlay.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select');
        if (first) { try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); } }
      });
      return close;
    },

    /* 确认对话框，返回 Promise<boolean> */
    confirm(text, okText) {
      return new Promise((resolve) => {
        let resolved = false;
        const close = utils.modal({
          title: '请确认',
          bodyHTML: '<p class="confirm-text">' + utils.escapeHtml(text) + '</p>' +
            '<div class="modal-actions"><button class="btn ghost" data-act="cancel">取消</button>' +
            '<button class="btn danger" data-act="ok">' + utils.escapeHtml(okText || '确定') + '</button></div>',
          onMount(root, c) {
            root.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolved = true; c(); resolve(false); });
            root.querySelector('[data-act="ok"]').addEventListener('click', () => { resolved = true; c(); resolve(true); });
          },
          onClose() { if (!resolved) resolve(false); }
        });
      });
    },

    /* 防抖 */
    debounce(fn, ms) {
      let t;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), ms);
      };
    },

    /* =====================================================================
     * W3 · 统一动效工具（C2 / C4）
     * 原则：一套节奏（ease-out、≤620ms、位移 ≤8px）、尊重 prefers-reduced-motion。
     * 所有数据动效都经由此处，避免各模块各写一套 rAF / matchMedia。
     * ===================================================================== */

    /* 是否允许动效：无 matchMedia 时保守视为允许；reduce 时一律关闭 */
    motionOK() {
      try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
        return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (_) { return true; }
    },

    /* 数字缓动：reduce / 无 rAF / 终值为 0 时直接落终值，绝不把真实值改成 0。
     * W3 决策：仅作为公共能力保留并单测覆盖；**不挂载到统计卡片**——
     * 统计数字是权威数据，动画成中间值会短暂误导用户（见 handoff W3）。 */
    countUp(el, to, ms) {
      if (!el) return;
      const end = Number(to) || 0;
      const dur = Number(ms) || 560;
      if (!utils.motionOK() || typeof window === 'undefined' ||
          typeof window.requestAnimationFrame !== 'function' || end <= 0) {
        el.textContent = String(end);
        return;
      }
      const t0 = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        el.textContent = String(Math.round(end * eased));
        if (t < 1) window.requestAnimationFrame(tick);
        else el.textContent = String(end); // 收敛到精确终值
      };
      window.requestAnimationFrame(tick);
    },

    /* 交错：写入序号变量（默认 --motion-i，可传 --hm-wi 等自定义名）与
     * --motion-step（延迟步长），供 CSS calc 使用；cap 控制序号上限。
     * 这是 W3 所有「交错动效」的唯一来源。 */
    stagger(nodes, stepMs, varName, cap) {
      const step = Number(stepMs) || 0;
      const name = varName || '--motion-i';
      const limit = Number(cap) || 40;
      Array.prototype.forEach.call(nodes || [], (n, i) => {
        if (!n || !n.style) return;
        n.style.setProperty(name, String(Math.min(i, limit)));
        n.style.setProperty('--motion-step', step + 'ms');
      });
    }
  };

  L.utils = utils;

  /* 极简事件总线 */
  L.bus = (function () {
    const map = {};
    return {
      on(evt, cb) { (map[evt] = map[evt] || []).push(cb); },
      emit(evt, data) { (map[evt] || []).forEach((cb) => cb(data)); }
    };
  })();

  /* =====================================================================
   * PetOS · 桌宠伙伴内核（白皮书 9 大概念落到 LifeOS 的公共逻辑层）
   * ---------------------------------------------------------------------
   * 设计纪律（与工程防御一一对齐）：
   *   1. 不新增顶层实体键、不新增源文件、不新增导航项 —— 守住 W2/W3 不变量；
   *   2. 状态存独立 localStorage key，与 tasks/notes 等主数据解耦，
   *      宠物配置损坏也不影响主数据（故障隔离）；
   *   3. 渲染层只调 L.pet 的纯 API，browser/electron 无感（对齐 bridge 思路）；
   *   4. 危险操作强制走「子宠物申请 → 主控点头」双阶段（点头原则），
   *      且每阶段带 trace-id，便于审计（对齐 social-gateway Trace ID）。
   * ===================================================================== */
  L.pet = (function () {
    'use strict';
    const KEY = 'lifeos-pet-v1';

    /* 装备 = 专家系统：戴上什么就是什么专家（概念 4） */
    const EQUIPMENT = [
      { id: 'none',    name: '通用伙伴', glyph: '◇', role: '陪你聊天、提醒、随手整理', needNod: false },
      { id: 'scholar', name: '学者帽',   glyph: '▰', role: '检索知识库、引用来源、建双向链接', needNod: false },
      { id: 'cleaner', name: '清道夫',   glyph: '✚', role: '清理重复与过期条目（删除需点头）', needNod: true },
      { id: 'banker',  name: '庄家领结', glyph: '◆', role: '拆解任务、派发给多 Agent 团队', needNod: false },
      { id: 'twin',    name: '分身面具', glyph: '☯', role: '注入你的习惯偏好，越用越懂你', needNod: false }
    ];

    /* 数字分身的习惯探针（概念 8）：只在真实行为发生时命中，不凭空编造偏好 */
    const HABITS = [
      { id: 'linker',    text: '喜欢把知识连成网络',       test: (s) => s.links >= 3 },
      { id: 'organizer', text: '热衷把知识长成小屋',       test: (s) => s.houseBuilds >= 1 },
      { id: 'delegator', text: '习惯派发任务给 Agent 团队', test: (s) => s.delegations >= 2 },
      { id: 'cautious',  text: '重视危险操作的授权确认',   test: (s) => s.nods >= 1 },
      { id: 'night',     text: '常在夜深时工作',           test: (s) => s.nightHours >= 2 },
      { id: 'curious',   text: '爱追问与复盘',             test: (s) => s.chats >= 5 }
    ];

    function defaults() {
      return {
        v: 1,
        pets: [
          { id: 'p-main',   name: '小屿', glyph: '◕', tint: 'teal',  role: '主控 · 通用伙伴', equip: 'none' },
          { id: 'p-clean',  name: '阿净', glyph: '✚', tint: 'amber', role: '回收站清道夫',     equip: 'cleaner' },
          { id: 'p-scholar',name: '阿博', glyph: '▰', tint: 'violet',role: '知识整理',        equip: 'scholar' }
        ],
        activeId: 'p-main',
        stats: { links: 0, houseBuilds: 0, delegations: 0, nods: 0, nightHours: 0, chats: 0, feeds: 0, approvalsDenied: 0 },
        inbox: [
          { id: 'm1', from: '@阿澈的宠物', text: '把你上次整理的「双写灰度」链接给我好吗？', status: '已校验' },
          { id: 'm2', from: '@Mira 的庄家', text: '本周复盘模板已同步，可在多端查看。', status: '已校验' }
        ]
      };
    }

    function db() {
      if (L.storage && L.storage.getItem) return L.storage;
      if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem) return localStorage;
      return null;
    }

    let _s = null;

    function load() {
      const D = db();
      let raw = null;
      if (D) { try { raw = D.getItem(KEY); } catch (_) { /* 无存储权限时静默降级 */ } }
      let parsed = null;
      if (raw) { try { parsed = JSON.parse(raw); } catch (_) { /* 损坏则重置，不污染主数据 */ } }
      const def = defaults();
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.pets) || !parsed.pets.length) {
        _s = def;
      } else {
        // 逐字段收敛：只信任结构正确的字段，其余回落默认值（防脏数据）
        _s = {
          v: 1,
          pets: parsed.pets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
            .slice(0, 64).map((p) => ({
              id: String(p.id).slice(0, 64), name: String(p.name).slice(0, 40),
              glyph: String(p.glyph || '◕').slice(0, 4),
              tint: ['teal', 'amber', 'violet'].indexOf(p.tint) >= 0 ? p.tint : 'teal',
              role: String(p.role || '伙伴').slice(0, 60),
              equip: EQUIPMENT.some((e) => e.id === p.equip) ? p.equip : 'none'
            })),
          activeId: typeof parsed.activeId === 'string' ? parsed.activeId : 'p-main',
          stats: Object.assign(def.stats, parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}),
          inbox: Array.isArray(parsed.inbox) ? parsed.inbox.slice(0, 20).filter((m) => m && typeof m.text === 'string') : def.inbox
        };
        if (!_s.pets.length) _s = def;
        if (!_s.pets.some((p) => p.id === _s.activeId)) _s.activeId = _s.pets[0].id;
      }
      // 首次加载（无有效存档）即落库：配置与故障状态一并持久化，
      // 避免每次刷新重建默认值，也让「损坏回落」是可见、可恢复的。
      if (!raw) save();
      return _s;
    }

    function get() { if (!_s) load(); return _s; }

    function save() {
      const D = db();
      if (!D) return false;
      try { D.setItem(KEY, JSON.stringify(get())); return true; }
      catch (_) { return false; } // 配额不足不影响主功能
    }

    function update(fn) {
      const s = get();
      if (typeof fn === 'function') fn(s);
      save();
      if (L.bus && L.bus.emit) L.bus.emit('pet:changed', s);
      return s;
    }

    function activePet() {
      const s = get();
      return s.pets.filter((p) => p.id === s.activeId)[0] || s.pets[0] || null;
    }

    function setActive(id) {
      const s = get();
      if (!s.pets.some((p) => p.id === id)) return false;
      s.activeId = id; save();
      if (L.bus && L.bus.emit) L.bus.emit('pet:changed', s);
      return true;
    }

    function addPet(p) {
      const s = get();
      const name = String((p && p.name) || '新伙伴').slice(0, 40);
      const pet = {
        id: 'p-' + utils.uid(), name: name,
        glyph: String((p && p.glyph) || '✦').slice(0, 4),
        tint: ['teal', 'amber', 'violet'].indexOf(p && p.tint) >= 0 ? p.tint : 'teal',
        role: String((p && p.role) || '待分配任务').slice(0, 60), equip: 'none'
      };
      if (s.pets.length >= 64) return null; // 上限保护，防无限膨胀
      s.pets.push(pet); save();
      if (L.bus && L.bus.emit) L.bus.emit('pet:changed', s);
      return pet;
    }

    function equip(petId, equipId) {
      if (!EQUIPMENT.some((e) => e.id === equipId)) return false;
      const s = get();
      const pet = s.pets.filter((p) => p.id === petId)[0];
      if (!pet) return false;
      pet.equip = equipId;
      const gear = EQUIPMENT.filter((e) => e.id === equipId)[0];
      pet.role = gear.name + ' · ' + gear.role;
      save();
      if (L.bus && L.bus.emit) L.bus.emit('pet:changed', s);
      return true;
    }

    function equipActive(equipId) {
      const p = activePet();
      return p ? equip(p.id, equipId) : false;
    }

    /* 观察行为 → 沉淀数字分身（概念 8）。只统计真实发生的行为。 */
    function observe(kind) {
      const map = {
        link: 'links', house: 'houseBuilds', delegate: 'delegations',
        nod: 'nods', feed: 'feeds', chat: 'chats'
      };
      const s = get();
      if (kind === 'night') {
        const h = new Date().getHours();
        if (h >= 22 || h < 6) s.stats.nightHours = (s.stats.nightHours || 0) + 1;
      } else if (map[kind]) {
        s.stats[map[kind]] = (s.stats[map[kind]] || 0) + 1;
      }
      save();
      return s.stats;
    }

    function userSkills() {
      const s = get();
      return HABITS.filter((h) => { try { return !!h.test(s.stats); } catch (_) { return false; } })
        .map((h) => h.text);
    }

    function traceId(prefix) {
      const p = String(prefix || 't');
      return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    /* 点头原则（概念 5）：把一次危险意图拆成两个不可跳过的阶段描述。
     * 纯函数，返回结构供渲染层使用；渲染层必须依次展示两阶段，
     * 任一阶段拒绝即整体拒绝。trace 用于事后审计。 */
    function approvalFlow(intent, base) {
      const i = intent || {};
      const trace = traceId('nod');
      const actor = activePet();
      const desc = String(i.desc || '执行一项操作').slice(0, 120);
      return {
        trace: trace,
        actor: actor ? actor.name : '子宠物',
        desc: desc,
        needsNod: i.needsNod !== false,
        stage1: {
          title: '子宠物申请',
          text: '「' + (actor ? actor.name : '子宠物') + '」请求：' + desc + '。是否转交主控确认？',
          trace: trace + ':request'
        },
        stage2: {
          title: '主控点头确认',
          text: '主控请确认：允许「' + (actor ? actor.name : '子宠物') + '」执行 —— ' + desc + '？',
          trace: trace + ':nod',
          native: L.bridge && L.bridge.mode === 'electron'
        }
      };
    }

    /* 浏览器模式的双阶段确认。无 DOM（单测）时保守拒绝，绝不自动放行。 */
    function requestApproval(intent) {
      const flow = approvalFlow(intent);
      if (typeof document === 'undefined' || !utils.modal) return Promise.resolve(false);
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return; done = true;
          observe(ok ? 'nod' : 'deny');
          if (!ok) update((s) => { s.stats.approvalsDenied = (s.stats.approvalsDenied || 0) + 1; });
          resolve(ok);
        };
        const c1 = utils.modal({
          title: '◇ ' + flow.stage1.title,
          bodyHTML: '<p class="confirm-text">' + utils.escapeHtml(flow.stage1.text) + '</p>' +
            '<p class="hint">Trace：<code>' + utils.escapeHtml(flow.stage1.trace) + '</code> · 此阶段仅转交，不执行。</p>' +
            '<div class="modal-actions">' +
            '  <button class="btn ghost" data-act="cancel">拒绝</button>' +
            '  <button class="btn" data-act="next">转交主控 →</button></div>',
          onMount(root, close) {
            root.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); finish(false); });
            root.querySelector('[data-act="next"]').addEventListener('click', () => { close(); showStage2(); });
          },
          onClose() { if (!done) finish(false); }
        });
        function showStage2() {
          const note = flow.stage2.native
            ? '<p class="hint">桌面端：该请求会交由主进程再次核验，网页仅传递意图。</p>'
            : '<p class="hint">网页演示版：主控在此点头；真实桌面端由操作系统原生弹窗二次确认。</p>';
          utils.modal({
            title: '◆ ' + flow.stage2.title,
            bodyHTML: '<p class="confirm-text">' + utils.escapeHtml(flow.stage2.text) + '</p>' + note +
              '<p class="hint">Trace：<code>' + utils.escapeHtml(flow.stage2.trace) + '</code></p>' +
              '<div class="modal-actions">' +
              '  <button class="btn ghost" data-act="cancel">不点头</button>' +
              '  <button class="btn danger" data-act="nod">点头，允许这一次</button></div>',
            onMount(root, close) {
              root.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); finish(false); });
              root.querySelector('[data-act="nod"]').addEventListener('click', () => { close(); finish(true); });
            },
            onClose() { if (!done) finish(false); }
          });
        }
      });
    }

    function inbox() { return get().inbox || []; }
    function stats() { return Object.assign({}, get().stats); }
    function equipment() { return EQUIPMENT.map((e) => Object.assign({}, e)); }
    function gearOf(id) { return EQUIPMENT.filter((e) => e.id === id)[0] || EQUIPMENT[0]; }

    return {
      KEY: KEY, defaults: defaults, load: load, get: get, save: save, update: update,
      activePet: activePet, setActive: setActive, addPet: addPet, equip: equip, equipActive: equipActive,
      observe: observe, userSkills: userSkills, traceId: traceId,
      approvalFlow: approvalFlow, requestApproval: requestApproval,
      inbox: inbox, stats: stats, equipment: equipment, gearOf: gearOf,
      HABITS: HABITS, EQUIPMENT: EQUIPMENT
    };
  })();

})(window.LifeOS);
