/* =========================================================================
 * LifeOS · 统一存储适配层（W1 地基）
 * -------------------------------------------------------------------------
 * 目标：把散落在 8 类键、约 20 处的 localStorage 调用收敛到单一适配层，
 *       并提供「localStorage → IndexedDB 双写灰度」的可回滚迁移通道。
 *
 * 三态（lifeos-storage-mode / URL ?storage=）：
 *   legacy : 只读写 localStorage —— 完全等同旧版，一键回滚的落点
 *   dual   : localStorage 为同步权威 + IDB 异步冗余镜像（默认，渐进灰度）
 *   idb    : 启动时以 IDB 为准回填；localStorage 仍保留为降级镜像
 *
 * 为什么保持同步接口：现有调用点全是同步 getItem/setItem/removeItem，
 *   IDB 是异步 API；若改成 async 会牵连整条调用链与 10 个 eval 单测。
 *   因此采用「内存缓存 + 同步 localStorage 权威 + 异步 IDB 镜像」：
 *   同步读立刻可用，IDB 只做冗余与恢复，绝不进入关键路径。
 *
 * 安全与回滚：
 *   - setItem 永远先同步写 localStorage（IDB 失败也不跳过）→ 一键回滚零丢数据
 *   - Node / 隐私模式 / 无 indexedDB / IDB 运行时报错 → 自动降级 legacy
 *   - 会话级 sessionStorage 不归本层管理（方案明确不迁）
 *   - 只管理 lifeos- 前缀的键，不触碰同域其它数据
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  var MODE_KEY = 'lifeos-storage-mode';
  var DB_NAME = 'lifeos-store';
  var STORE = 'kv';
  var MODES = ['legacy', 'dual', 'idb'];
  var DEFAULT_MODE = 'dual';
  var PREFIX = 'lifeos-';

  function managed(k) { return typeof k === 'string' && k.indexOf(PREFIX) === 0; }

  // localStorage 可用性探测（隐私模式下访问可能抛错）
  var ls = null;
  try { ls = (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null; }
  catch (e) { ls = null; }

  var idbSupported = (function () {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null &&
        typeof indexedDB.open === 'function';
    } catch (e) { return false; }
  })();

  var mem = Object.create(null);        // 同步读缓存
  var degraded = false;                 // IDB 运行时失败后置 true
  var lastError = '';
  var dbPromise = null;
  var pending = [];                     // 挂起的 IDB 写，供 flush() 等待

  function degrade(e) {
    degraded = true;
    try { lastError = String(e && e.message ? e.message : e); }
    catch (_) { lastError = 'IndexedDB 不可用'; }
  }

  /* ---------------- 三态灰度 ---------------- */
  function urlOverride() {
    try {
      if (typeof location === 'undefined' || !location.search) return null;
      var m = /(?:^|[?&])storage=([a-z]+)(?:&|$)/.exec(location.search);
      if (m && MODES.indexOf(m[1]) >= 0) return m[1];
    } catch (e) { /* noop */ }
    return null;
  }

  function storedMode() {
    try {
      var v = ls ? ls.getItem(MODE_KEY) : null;
      return MODES.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }

  // Electron 桌面端数据落 userData/lifeos-data.json，边界为「仅验证」→ 强制旧存储
  function inElectron() {
    try { return typeof window !== 'undefined' && !!window.electronAPI; }
    catch (e) { return false; }
  }

  function mode() {
    if (inElectron()) return 'legacy';
    var ov = urlOverride();
    if (ov) return ov;
    var m = storedMode() || DEFAULT_MODE;
    if (!idbSupported || degraded) return 'legacy';
    return m;
  }

  function setMode(m) {
    if (MODES.indexOf(m) < 0) return false;
    try { if (ls) ls.setItem(MODE_KEY, m); } catch (e) { return false; }
    mem[MODE_KEY] = m;
    return true;
  }

  /* ---------------- IndexedDB 低层 ---------------- */
  function openDB() {
    if (!idbSupported || degraded) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { degrade(e); resolve(null); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (db && db.objectStoreNames && !db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        } catch (e) { degrade(e); }
      };
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { degrade(req.error || new Error('IDB open failed')); resolve(null); };
      req.onblocked = function () { /* 其它标签占用时不阻塞主流程 */ };
    });
    return dbPromise;
  }

  /* 统一请求包装：put/get/getAll/delete/clear 都返回 IDBRequest。
   * 每条记录存 { k, v, t }，这样 getAll() 一次拿到键与值，不需要 getAllKeys。 */
  function idbRequest(type, method, args) {
    return openDB().then(function (db) {
      if (!db) return undefined;
      return new Promise(function (resolve) {
        var tx, os, req;
        try {
          tx = db.transaction(STORE, type);
          os = tx.objectStore(STORE);
          req = os[method].apply(os, args);
        } catch (e) { degrade(e); resolve(undefined); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () {
          degrade(req.error || new Error('IDB ' + method + ' failed'));
          resolve(undefined);
        };
      });
    });
  }

  function mirror(method, args) {
    var m = mode();
    if (m === 'legacy' || !idbSupported || degraded) return;
    var p;
    try { p = idbRequest('readwrite', method, args); }
    catch (e) { degrade(e); return; }
    pending.push(p);
    p.then(function () {
      var i = pending.indexOf(p);
      if (i >= 0) pending.splice(i, 1);
    }, function () {
      var i = pending.indexOf(p);
      if (i >= 0) pending.splice(i, 1);
    });
  }

  /* ---------------- 同步公共接口（localStorage 同签名） ---------------- */
  function getItem(k) {
    if (!managed(k)) {
      try { return ls ? ls.getItem(k) : null; } catch (e) { return null; }
    }
    if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k];
    var v = null;
    try { v = ls ? ls.getItem(k) : null; } catch (e) { v = null; }
    mem[k] = v;
    return v;
  }

  function setItem(k, v) {
    var s = String(v);
    if (!managed(k)) {
      try { if (ls) ls.setItem(k, s); } catch (e) { /* noop */ }
      return;
    }
    mem[k] = s;
    // localStorage 永远同步写：一键回滚的基石，绝不因 IDB 失败而跳过
    try { if (ls) ls.setItem(k, s); } catch (e) { /* 配额满：仍保留内存值 */ }
    mirror('put', [{ k: k, v: s, t: Date.now() }, k]);
  }

  function removeItem(k) {
    if (!managed(k)) {
      try { if (ls) ls.removeItem(k); } catch (e) { /* noop */ }
      return;
    }
    delete mem[k];
    try { if (ls) ls.removeItem(k); } catch (e) { /* noop */ }
    mirror('delete', [k]);
  }

  /* ---------------- 迁移 / 恢复 / 观察 ---------------- */
  function refreshFromLocal() {
    Object.keys(mem).forEach(function (k) { delete mem[k]; });
    try {
      if (ls && typeof ls.length === 'number') {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (managed(k)) mem[k] = ls.getItem(k);
        }
      }
    } catch (e) { /* noop */ }
    return Object.keys(mem).length;
  }

  /* 启动时调用。返回 Promise<{ mode, restored, migrated, idbKeys, degraded }>
   *  - dual 首次：本机有数据、IDB 为空 → 全量灌入 IDB（这才是「迁」）
   *  - dual 后续：本机缺某键而 IDB 有 → 回填本机（防丢失的恢复价值）
   *  - idb 模式：IDB 为准，覆盖本机对应键
   */
  function hydrate() {
    var m = mode();
    refreshFromLocal();
    if (m === 'legacy' || !idbSupported || degraded) {
      return Promise.resolve({ mode: m, restored: 0, migrated: 0, idbKeys: 0, degraded: degraded });
    }
    return idbRequest('readonly', 'getAll', []).then(function (rows) {
      var recs = Array.isArray(rows) ? rows : [];
      var restored = 0, migrated = 0;
      var localKeys = Object.keys(mem).filter(function (k) {
        return k !== MODE_KEY && mem[k] != null;
      });

      if (recs.length === 0 && localKeys.length) {
        // 首次迁移：把现有 localStorage 全量灌进 IDB
        localKeys.forEach(function (k) {
          mirror('put', [{ k: k, v: String(mem[k]), t: Date.now() }, k]);
          migrated++;
        });
        return { mode: m, restored: 0, migrated: migrated, idbKeys: migrated, degraded: false };
      }

      var idbMap = Object.create(null);
      recs.forEach(function (r) { if (r && managed(r.k)) idbMap[r.k] = r; });
      Object.keys(idbMap).forEach(function (k) {
        var rec = idbMap[k];
        var local = null;
        try { local = ls ? ls.getItem(k) : null; } catch (e) { /* noop */ }
        if (m === 'idb' || local == null) {
          var val = String(rec.v);
          if (String(local) !== val) {
            mem[k] = val;
            try { if (ls) ls.setItem(k, val); } catch (e) { /* noop */ }
            restored++;
          }
        }
      });
      return { mode: m, restored: restored, migrated: 0, idbKeys: recs.length, degraded: degraded };
    });
  }

  /* 多标签：其它标签写入 localStorage 后，让本标签缓存失效并重读 */
  function onExternalChange(k) {
    if (!k || !managed(k)) { refreshFromLocal(); return true; }
    delete mem[k];
    try { mem[k] = ls ? ls.getItem(k) : null; } catch (e) { mem[k] = null; }
    return true;
  }

  function exportAll() {
    var out = {};
    try {
      if (ls && typeof ls.length === 'number') {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (managed(k)) out[k] = ls.getItem(k);
        }
      }
    } catch (e) { /* noop */ }
    Object.keys(mem).forEach(function (k) { if (out[k] == null) out[k] = mem[k]; });
    delete out[MODE_KEY];
    return out;
  }

  function idbGetAll() { return idbRequest('readonly', 'getAll', []); }
  function idbCount() {
    return idbGetAll().then(function (r) { return Array.isArray(r) ? r.length : 0; });
  }
  function clearIDB() {
    return idbRequest('readwrite', 'clear', []).then(function () { return !degraded; });
  }
  function flush() { return Promise.all(pending.slice()).then(function () { return true; }); }

  function status() {
    return {
      mode: mode(),
      requested: storedMode() || DEFAULT_MODE,
      urlOverride: urlOverride(),
      supported: idbSupported,
      degraded: degraded,
      active: mode() !== 'legacy',
      lastError: lastError,
      managedKeys: Object.keys(mem).length
    };
  }

  /* 一键回滚：只切模式，不清 IDB（保留数据以便随时切回） */
  function rollback() { setMode('legacy'); return status(); }

  L.storage = {
    MODE_KEY: MODE_KEY,
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    mode: mode,
    setMode: setMode,
    hydrate: hydrate,
    status: status,
    rollback: rollback,
    exportAll: exportAll,
    refreshFromLocal: refreshFromLocal,
    onExternalChange: onExternalChange,
    idbGetAll: idbGetAll,
    idbCount: idbCount,
    clearIDB: clearIDB,
    flush: flush
  };
})(window.LifeOS);
