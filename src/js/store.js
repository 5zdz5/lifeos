/* =========================================================================
 * LifeOS · 数据层
 * 负责状态读写、持久化，以及各实体的增删改。每次变更后 emit('state:changed')。
 * 所有数据仅存于本机（浏览器 localStorage / Electron 用户目录），不上传。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';
  const U = L.utils;
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  // 备份 / 快照 / 导入统一处理的实体键：新增实体只需在此登记，避免某条链路漏掉
  const ENTITY_KEYS = ['tasks', 'habits', 'notes', 'library', 'events', 'aiThread'];

  /* 密钥类设置：绝不写进备份 / 快照，也不接受外部备份覆盖。
   * - aiKey 是明文密钥，备份文件常被分享、传网盘、发微信，一旦离开本机即泄露；
   * - aiBaseUrl 若被不可信备份改写，后续 AI 请求会被导向攻击者服务器，
   *   用户却仍以为连的是自己的服务（典型的数据外泄向量）。
   * 因此导出/快照一律剔除，导入/恢复一律保留本机当前值。 */
  const SECRET_SETTING_KEYS = ['aiKey', 'aiBaseUrl'];

  function portableSettings(settings) {
    const s = Object.assign({}, settings || {});
    SECRET_SETTING_KEYS.forEach((k) => { delete s[k]; });
    return s;
  }

  /* ---------------- 导入数据清洗（防恶意备份注入 HTML / 属性 / 危险协议） ----------------
   * 备份文件可能来自他人，不能假定字段安全。这里保留全部字段，只把值收敛到可安全渲染的形态；
   * 渲染层仍统一做转义，两层都要守住。函数自包含，不依赖 L.utils 的扩展方法。 */
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const SAFE_HEX = /^#[0-9a-fA-F]{3,8}$/;
  const FALLBACK_COLOR = '#176c6b';

  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max || 20000);
  }

  function cleanUrl(v) {
    const s = cleanText(v, 2000).trim();
    if (!s) return '';
    const compact = s.replace(/[\u0000-\u0020\u007f]/g, '');
    if (/^(javascript|data|vbscript|file|blob|about):/i.test(compact)) return '#';
    if (/^https?:\/\//i.test(compact) || /^mailto:/i.test(compact)) return s;
    if (/^(\/|\.\/|\.\.\/|#|\?)/.test(s)) return s;
    if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(compact)) return s;
    return '#';
  }

  function cleanEntity(obj, needId) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = {};
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v === 'string') out[k] = cleanText(v, 20000);
      else if (Array.isArray(v)) {
        out[k] = v.slice(0, 500).map((x) => typeof x === 'string' ? cleanText(x, 20000)
          : (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x));
      } else if (v && typeof v === 'object') {
        try { out[k] = JSON.parse(JSON.stringify(v)); } catch (_) { out[k] = null; }
      } else if (typeof v === 'number' && !isFinite(v)) out[k] = 0;
      else out[k] = v;
    });
    if (needId && !SAFE_ID.test(String(out.id || ''))) out.id = U.uid();
    if ('color' in out) out.color = SAFE_HEX.test(String(out.color || '').trim()) ? String(out.color).trim() : FALLBACK_COLOR;
    if (out.source && typeof out.source === 'object' && !Array.isArray(out.source) && 'url' in out.source) {
      out.source.url = cleanUrl(out.source.url);
    }
    return out;
  }

  function cleanSettings(raw, def) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const merged = Object.assign({}, def.settings, src);
    const s = {};
    Object.keys(merged).forEach((k) => {
      const v = merged[k];
      if (typeof v === 'string') s[k] = cleanText(v, 2000);
      else if (typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) s[k] = v;
      else if (v == null) s[k] = '';
      else s[k] = cleanText(String(v), 2000);
    });
    if (['auto', 'light', 'dark'].indexOf(s.theme) < 0) s.theme = def.settings.theme;
    if (s.aiBaseUrl && !/^https?:\/\//i.test(s.aiBaseUrl)) s.aiBaseUrl = def.settings.aiBaseUrl;
    return s;
  }

  const store = {
    state: null,
    _saving: false,

    async init() {
      this.state = await L.bridge.load();
      if (!this.state) this.state = L.bridge.getDefaultState();
      // 兼容旧数据缺字段
      const def = L.bridge.getDefaultState();
      for (const k in def) if (this.state[k] === undefined) this.state[k] = def[k];
      this.state.settings = Object.assign({}, def.settings, this.state.settings || {});
      // 兼容旧版本：早期快照里可能存有明文密钥，读到后一次性脱敏
      this.sanitizeStoredSnapshots();
      return this.state;
    },

    async persist() {
      this._saving = true;
      await L.bridge.save(this.state);
      this._saving = false;
      // 每次写入顺带做一次滚动快照（内部有节流与容量保护）
      this.maybeSnapshot();
      L.bus.emit('state:changed');
    },

    /* ---------- 日历日程 ---------- */
    addEvent(e) {
      const ev = Object.assign({
        id: U.uid(), date: U.todayStr(), time: '', title: '', note: '', createdAt: Date.now()
      }, e || {});
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date))) ev.date = U.todayStr();
      ev.title = String(ev.title || '').slice(0, 200);
      ev.time = String(ev.time || '').slice(0, 20);
      ev.note = String(ev.note || '').slice(0, 2000);
      if (!Array.isArray(this.state.events)) this.state.events = [];
      this.state.events.push(ev);
      this.persist();
      return ev;
    },
    removeEvent(id) {
      const arr = this.state.events || [];
      const i = arr.findIndex((x) => x && x.id === id);
      if (i < 0) return;
      arr.splice(i, 1);
      this.persist();
    },

    /* ---------- 任务 ---------- */
    addTask(t) {
      const task = Object.assign({
        id: U.uid(),
        title: '',
        note: '',
        priority: 'medium',
        status: 'todo',
        due: null,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, t);
      this.state.tasks.unshift(task);
      this.persist();
      return task;
    },
    updateTask(id, patch) {
      const t = this.state.tasks.find((x) => x.id === id);
      if (!t) return;
      Object.assign(t, patch, { updatedAt: Date.now() });
      this.persist();
    },
    removeTask(id) {
      this.state.tasks = this.state.tasks.filter((x) => x.id !== id);
      this.persist();
    },

    /* ---------- 习惯 ---------- */
    addHabit(h) {
      const habit = Object.assign({
        id: U.uid(),
        name: '',
        emoji: '◆',
        color: '#176c6b',
        createdAt: Date.now(),
        checkins: {} // { 'YYYY-MM-DD': true }
      }, h);
      this.state.habits.push(habit);
      this.persist();
      return habit;
    },
    updateHabit(id, patch) {
      const h = this.state.habits.find((x) => x.id === id);
      if (!h) return;
      Object.assign(h, patch);
      this.persist();
    },
    removeHabit(id) {
      this.state.habits = this.state.habits.filter((x) => x.id !== id);
      this.persist();
    },
    toggleHabitCheckin(id, date) {
      const h = this.state.habits.find((x) => x.id === id);
      if (!h) return;
      h.checkins = h.checkins || {};
      if (h.checkins[date]) delete h.checkins[date];
      else h.checkins[date] = true;
      this.persist();
    },

    /* ---------- 笔记 ---------- */
    addNote(n) {
      const note = Object.assign({
        id: U.uid(),
        title: '无标题笔记',
        body: '',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, n);
      this.state.notes.unshift(note);
      this.persist();
      return note;
    },
    updateNote(id, patch) {
      const n = this.state.notes.find((x) => x.id === id);
      if (!n) return;
      Object.assign(n, patch, { updatedAt: Date.now() });
      this.persist();
    },
    removeNote(id) {
      this.state.notes = this.state.notes.filter((x) => x.id !== id);
      this.persist();
    },

    /* ---------- 知识库 ---------- */
    addLibraryItem(item) {
      const it = Object.assign({
        id: U.uid(),
        title: '未命名条目',
        summary: '',
        points: [],
        tags: [],
        source: { type: 'manual', label: '手动添加', url: '', fetchedAt: Date.now() },
        raw: '',
        noteId: null,
        createdAt: Date.now()
      }, item || {});
      if (!Array.isArray(it.points)) it.points = [];
      if (!Array.isArray(it.tags)) it.tags = [];
      if (!it.source || typeof it.source !== 'object') it.source = { type: 'manual', label: '手动添加', url: '', fetchedAt: Date.now() };
      if (!this.state.library) this.state.library = [];
      this.state.library.unshift(it);
      this.persist();
      return it;
    },
    updateLibraryItem(id, patch) {
      const it = (this.state.library || []).find((x) => x.id === id);
      if (!it) return;
      Object.assign(it, patch);
      this.persist();
    },
    removeLibraryItem(id) {
      this.state.library = (this.state.library || []).filter((x) => x.id !== id);
      this.persist();
    },
    clearLibrary() {
      this.state.library = [];
      this.persist();
    },
    /* 按来源 URL 去重（联网刷新时不重复堆积） */
    hasLibrarySource(url) {
      return (this.state.library || []).some((x) => x.source && x.source.url && x.source.url === url);
    },

    /* ---------- AI 对话 ---------- */
    pushAI(msg) {
      // 补时间戳，供日历 / 全年热力图统计「AI 对话」活跃度（兼容旧数据无 ts）
      if (!msg.ts) msg.ts = Date.now();
      this.state.aiThread.push(msg);
      // 限制历史长度，避免无限增长
      if (this.state.aiThread.length > 200) this.state.aiThread = this.state.aiThread.slice(-200);
      this.persist();
    },
    clearAI() {
      this.state.aiThread = [];
      this.persist();
    },

    /* ---------- 设置 ---------- */
    setSettings(patch) {
      Object.assign(this.state.settings, patch);
      this.persist();
    },

    /* ---------- 备份 / 恢复 ---------- */
    /* 导出为可移植的 JSON 对象（不含运行环境信息） */
    exportPayload() {
      const s = this.state;
      const data = {};
      ENTITY_KEYS.forEach((k) => { data[k] = s[k] || []; });
      data.settings = portableSettings(s.settings);
      return {
        app: 'LifeOS',
        schema: 1,
        exportedAt: new Date().toISOString(),
        build: (L.buildInfo && L.buildInfo.version) || 'dev',
        counts: {
          tasks: (s.tasks || []).length,
          habits: (s.habits || []).length,
          notes: (s.notes || []).length,
          library: (s.library || []).length,
          events: (s.events || []).length,
          ai: (s.aiThread || []).length
        },
        // 深拷贝：导出包是独立快照，之后的数据变更不应串改它
        data: JSON.parse(JSON.stringify(data))
      };
    },

    /* 触发浏览器下载备份文件；返回文件名 */
    downloadBackup() {
      const text = JSON.stringify(this.exportPayload(), null, 2);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const name = 'lifeos-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return name;
    },

    /* 解析并校验导入内容，返回 {data, counts, exportedAt} —— 不改动现有数据 */
    parseImport(text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON'); }
      if (!obj || typeof obj !== 'object') throw new Error('备份内容格式不正确');
      // 兼容两种格式：导出包 {data:{...}} 与 直接的 state 对象
      const raw = (obj.data && typeof obj.data === 'object') ? obj.data : obj;
      if (!ENTITY_KEYS.some((k) => Array.isArray(raw[k]))) {
        throw new Error('未找到任务 / 习惯 / 笔记 / 知识库 / 日程 / 对话数据，可能不是 LifeOS 备份');
      }
      const def = L.bridge.getDefaultState();
      const data = {};
      ENTITY_KEYS.forEach((k) => {
        data[k] = Array.isArray(raw[k])
          ? raw[k].slice(0, 20000).map((x) => cleanEntity(x, k !== 'aiThread')).filter(Boolean)
          : [];
      });
      // 日程日期必须严格为 YYYY-MM-DD，避免不可信备份把任意字符串写进日历
      data.events = data.events.filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')));
      // 不可信备份带来的密钥 / 接口地址一律丢弃，由本机默认值补齐
      data.settings = cleanSettings(portableSettings(raw.settings), def);
      return { exportedAt: obj.exportedAt || null, counts: obj.counts || null, data: data };
    },

    /* 导入：mode = 'replace' | 'merge'；导入前自动留一份快照 */
    async importPayload(text, mode) {
      const parsed = this.parseImport(text);
      // 本机密钥不随外部备份改变（纵深防御：即使上面的清洗被绕过也不覆盖）
      const keep = {};
      SECRET_SETTING_KEYS.forEach((k) => { keep[k] = (this.state.settings || {})[k] || ''; });
      this.makeSnapshot('导入前自动备份');
      const d = parsed.data;
      if (mode === 'merge') {
        ENTITY_KEYS.filter((k) => k !== 'aiThread').forEach((k) => {
          if (!this.state[k]) this.state[k] = [];
          const seen = Object.create(null);
          this.state[k].forEach((x) => { if (x && x.id) seen[x.id] = true; });
          d[k].forEach((x) => {
            if (!x || !x.id || seen[x.id]) return;
            this.state[k].push(x);
            seen[x.id] = true;
          });
        });
        const seenAI = Object.create(null);
        this.state.aiThread.forEach((m) => { seenAI[m.role + '|' + m.ts + '|' + (m.content || '').slice(0, 20)] = true; });
        d.aiThread.forEach((m) => {
          const k = m.role + '|' + m.ts + '|' + (m.content || '').slice(0, 20);
          if (!seenAI[k]) { this.state.aiThread.push(m); seenAI[k] = true; }
        });
      } else {
        this.state = {};
        ENTITY_KEYS.forEach((k) => { this.state[k] = d[k]; });
        this.state.settings = Object.assign({}, portableSettings(d.settings), keep);
      }
      // 补齐缺失字段
      const def = L.bridge.getDefaultState();
      for (const k in def) if (this.state[k] === undefined) this.state[k] = def[k];
      await this.persist();
      return parsed;
    },

    /* ---------- 本地快照 ---------- */
    SNAP_KEY: 'lifeos-snapshots',
    SNAP_MAX: 8,

    snapshotList() {
      try { return JSON.parse(DB.getItem(this.SNAP_KEY) || '[]'); }
      catch (e) { return []; }
    },

    /* 一次性迁移：清掉旧版本快照里已写入的明文密钥（不影响快照的数据实体） */
    sanitizeStoredSnapshots() {
      try {
        const list = this.snapshotList();
        let changed = false;
        list.forEach((s) => {
          if (!s || !s.data || !s.data.settings) return;
          SECRET_SETTING_KEYS.forEach((k) => {
            if (k in s.data.settings) { delete s.data.settings[k]; changed = true; }
          });
        });
        if (changed) DB.setItem(this.SNAP_KEY, JSON.stringify(list));
      } catch (_) { /* 无存储权限时静默跳过 */ }
    },

    makeSnapshot(label) {
      try {
        const s = this.state;
        const data = {};
        ENTITY_KEYS.forEach((k) => { data[k] = s[k] || []; });
        data.settings = portableSettings(s.settings);
        const list = this.snapshotList();
        list.unshift({
          id: U.uid(),
          at: Date.now(),
          label: label || '手动快照',
          counts: {
            tasks: (s.tasks || []).length,
            habits: (s.habits || []).length,
            notes: (s.notes || []).length,
            library: (s.library || []).length,
            ai: (s.aiThread || []).length
          },
          data: JSON.parse(JSON.stringify(data))
        });
        // 容量保护：超出约 3.5MB 时逐份丢弃最旧的
        let trimmed = list.slice(0, this.SNAP_MAX);
        while (trimmed.length > 1 && JSON.stringify(trimmed).length > 3500000) trimmed.pop();
        DB.setItem(this.SNAP_KEY, JSON.stringify(trimmed));
        return true;
      } catch (e) { return false; } // 存储配额不足时静默跳过，不影响主功能
    },

    /* 节流滚动快照：距上次至少 3 分钟才写一份 */
    maybeSnapshot() {
      const list = this.snapshotList();
      if (list.length && Date.now() - (list[0].at || 0) < 3 * 60 * 1000) return;
      this.makeSnapshot('自动快照');
    },

    async restoreSnapshot(id) {
      const snap = this.snapshotList().find((x) => x.id === id);
      if (!snap) throw new Error('快照不存在或已被清理');
      this.makeSnapshot('恢复前自动备份');
      const def = L.bridge.getDefaultState();
      const prev = this.state.settings || {};
      const d = snap.data || {};
      this.state = {};
      ENTITY_KEYS.forEach((k) => { this.state[k] = d[k] || []; });
      // 兼容旧快照（可能含明文密钥）：先脱敏，再补回本机当前值，密钥不随回滚变化
      this.state.settings = Object.assign({}, def.settings, portableSettings(d.settings));
      SECRET_SETTING_KEYS.forEach((k) => { this.state.settings[k] = prev[k] || ''; });
      await this.persist();
      return snap;
    },

    clearSnapshots() {
      try { DB.removeItem(this.SNAP_KEY); } catch (e) { /* noop */ }
    },

    storageInfo() {
      let bytes = 0;
      try { bytes = new Blob([JSON.stringify(this.state)]).size; }
      catch (e) { bytes = JSON.stringify(this.state).length; }
      return { bytes };
    }
  };

  L.store = store;
})(window.LifeOS);
