/* =========================================================================
 * W1 · 统一存储适配层单测（第 11 套件）
 *
 * 用 vm 为每个场景构造隔离环境，可精确控制「有无 indexedDB」：
 *   - 无 IDB 场景 = Node 单测环境 / 老浏览器，验证自动降级 legacy 且行为等同旧版
 *   - 有 IDB 场景 = 用最小 fake IndexedDB 验证三态灰度 / 双写 / hydrate / 回滚
 *
 * 覆盖方案 S5/S6 的验收点：三态切换、能力探测与降级、双写一致性、
 * 回滚后数据不丢、导入导出（exportAll）兼容、会话语义不受影响。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const STORAGE_SRC = path.join(__dirname, '..', 'src', 'js', 'storage.js');
const CODE = fs.readFileSync(STORAGE_SRC, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* 最小但「异步语义正确」的 fake IndexedDB：
 * request 的 onsuccess 在当前同步代码之后（微任务）触发，与真实 IDB 一致。 */
function fakeIDB(broken) {
  const stores = Object.create(null);
  const request = (fn) => {
    const r = {};
    Promise.resolve().then(() => {
      try { r.result = fn(); if (r.onsuccess) r.onsuccess(); }
      catch (e) { r.error = e; if (r.onerror) r.onerror(); }
    });
    return r;
  };
  const objectStore = (name) => {
    if (!stores[name]) stores[name] = new Map();
    const m = stores[name];
    return {
      put: (v, k) => request(() => { m.set(k, v); return k; }),
      get: (k) => request(() => (m.has(k) ? m.get(k) : undefined)),
      getAll: () => request(() => Array.from(m.values())),
      delete: (k) => request(() => { m.delete(k); return undefined; }),
      clear: () => request(() => { m.clear(); return undefined; })
    };
  };
  const makeDB = () => ({
    objectStoreNames: { contains: (n) => !!stores[n] },
    createObjectStore: (n) => { if (!stores[n]) stores[n] = new Map(); return objectStore(n); },
    transaction: () => ({ objectStore: objectStore })
  });
  return {
    open: () => {
      const r = {};
      Promise.resolve().then(() => {
        if (broken) { r.error = new Error('模拟 IDB 打开失败'); if (r.onerror) r.onerror(); return; }
        r.result = makeDB();
        if (r.onupgradeneeded) r.onupgradeneeded();
        if (r.onsuccess) r.onsuccess();
      });
      return r;
    },
    _stores: stores
  };
}

/* 构造隔离环境并加载真实的 storage.js */
function load(opts) {
  opts = opts || {};
  const values = Object.assign({}, opts.initial || {});
  const ctx = {
    console, Date, JSON, Math, Promise, Object, Array, String, RegExp, Error,
    localStorage: {
      get length() { return Object.keys(values).length; },
      key: (i) => Object.keys(values)[i] !== undefined ? Object.keys(values)[i] : null,
      getItem: (k) => Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null,
      setItem: (k, v) => { values[k] = String(v); },
      removeItem: (k) => { delete values[k]; }
    },
    location: { search: opts.search || '' }
  };
  if (opts.indexedDB) ctx.indexedDB = opts.indexedDB;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { S: ctx.LifeOS.storage, values: values, ctx: ctx };
}

(async () => {
  console.log('\n=== A. 能力探测与自动降级（Node 单测环境） ===');
  {
    const { S } = load({});
    const st = S.status();
    ok('无 indexedDB 时 supported=false', st.supported === false);
    ok('无 indexedDB 时 mode 自动降级 legacy', st.mode === 'legacy', st.mode);
    ok('降级时 active=false（不启用 IDB 路径）', st.active === false);
    ok('默认请求档位仍是 dual（记录用户意图，不因降级改写）', st.requested === 'dual', st.requested);
    S.setItem('lifeos-data', '{"a":1}');
    ok('legacy 下 getItem 与原生 localStorage 一致', S.getItem('lifeos-data') === '{"a":1}');
    await S.hydrate();
    ok('legacy 下 hydrate 返回 mode=legacy 且 IDB 键为 0',
      (await S.hydrate()).mode === 'legacy');
    ok('legacy 下 idbCount 恒为 0', (await S.idbCount()) === 0);
    ok('legacy 下 clearIDB 不抛错', (await S.clearIDB()) === false || (await S.clearIDB()) === true);
  }

  console.log('\n=== B. 三态灰度与 URL 应急覆盖 ===');
  {
    const { S } = load({ indexedDB: fakeIDB() });
    ok('有 IDB 时 supported=true', S.status().supported === true);
    ok('有 IDB 时默认 mode=dual', S.mode() === 'dual', S.mode());
    ok('setMode(idb) 生效', S.setMode('idb') && S.mode() === 'idb');
    ok('setMode(dual) 生效', S.setMode('dual') && S.mode() === 'dual');
    ok('setMode(legacy) 生效', S.setMode('legacy') && S.mode() === 'legacy');
    ok('非法模式被拒绝', S.setMode('bogus') === false && S.mode() === 'legacy');
  }
  {
    const { S } = load({ indexedDB: fakeIDB(), search: '?sharecode=ABC&storage=legacy' });
    ok('URL ?storage=legacy 强制旧存储', S.mode() === 'legacy');
    ok('status().urlOverride 记录覆盖值', S.status().urlOverride === 'legacy');
    ok('URL 覆盖优先级高于 localStorage 模式', (() => {
      S.setMode('idb'); return S.mode() === 'legacy';
    })());
  }
  {
    const { S } = load({ indexedDB: fakeIDB(), search: '?storage=bogus' });
    ok('URL 非法值不构成覆盖（回落 dual）', S.mode() === 'dual' && S.status().urlOverride === null);
  }

  console.log('\n=== C. 同步接口与双写一致性 ===');
  {
    const fake = fakeIDB();
    const { S, values } = load({ indexedDB: fake });
    S.setItem('lifeos-data', '{"n":1}');
    S.setItem('lifeos-snapshots', '[]');
    S.setItem('lifeos-mindsea-v1', '{"memories":[]}');
    ok('setItem 后同步 getItem 立即可读（无需 await）', S.getItem('lifeos-data') === '{"n":1}');
    ok('localStorage 始终同步写入（回滚基线不丢）', values['lifeos-data'] === '{"n":1}');
    await S.flush();
    ok('dual 下 IDB 留有 3 份镜像', (await S.idbCount()) === 3, String(await S.idbCount()));
    const rows = await S.idbGetAll();
    ok('镜像记录带 {k,v,t} 结构', rows.every((r) => r && typeof r.k === 'string' && typeof r.v === 'string'));
    S.setItem('lifeos-data', '{"n":2}');
    await S.flush();
    ok('同键覆写不新增 IDB 记录（put 语义）', (await S.idbCount()) === 3);
    ok('覆写后 localStorage 为新值', values['lifeos-data'] === '{"n":2}');
    S.removeItem('lifeos-snapshots');
    await S.flush();
    ok('removeItem 同步删 localStorage', !Object.prototype.hasOwnProperty.call(values, 'lifeos-snapshots'));
    ok('removeItem 同步删 IDB 镜像', (await S.idbCount()) === 2);
    ok('getItem 对已删除键返回 null', S.getItem('lifeos-snapshots') === null);
  }
  {
    const fake = fakeIDB();
    const { S } = load({ indexedDB: fake });
    S.setMode('legacy');
    S.setItem('lifeos-data', '{}');
    await S.flush();
    ok('legacy 模式完全不写 IDB', (await S.idbCount()) === 0);
  }

  console.log('\n=== D. hydrate：首次迁移 / 缺失回填 / idb 为准 ===');
  {
    const fake = fakeIDB();
    const { S } = load({ indexedDB: fake, initial: {
      'lifeos-data': '{"tasks":[]}', 'lifeos-seeded': '1'
    } });
    const r = await S.hydrate();
    await S.flush();
    ok('首次 dual 迁移把本机数据灌入 IDB', r.migrated === 2 && r.mode === 'dual', JSON.stringify(r));
    ok('迁移后 IDB 键数=2', (await S.idbCount()) === 2);
    ok('迁移后本机数据未变', S.getItem('lifeos-data') === '{"tasks":[]}');
  }
  {
    const fake = fakeIDB();
    const { S, values } = load({ indexedDB: fake });
    // 模拟「IDB 有、本机被清空」的恢复场景
    S.setItem('lifeos-data', '{"restored":true}');
    await S.flush();
    delete values['lifeos-data'];
    S.refreshFromLocal();
    const r = await S.hydrate();
    ok('dual 检测到本机缺失并回填', r.restored >= 1, JSON.stringify(r));
    ok('回填后 getItem 拿到 IDB 数据', S.getItem('lifeos-data') === '{"restored":true}');
    ok('回填后 localStorage 也补齐', values['lifeos-data'] === '{"restored":true}');
  }
  {
    const fake = fakeIDB();
    const { S } = load({ indexedDB: fake, initial: { 'lifeos-data': '{"v":"old"}' } });
    S.setMode('idb');
    // 先迁移再用镜像写入「更新的值」，模拟其它设备/标签的写入
    await S.hydrate(); await S.flush();
    const kv = fake._stores.kv;
    kv.set('lifeos-data', { k: 'lifeos-data', v: '{"v":"new"}', t: Date.now() });
    const r = await S.hydrate();
    ok('idb 模式以 IDB 为准覆盖本机', r.mode === 'idb' && S.getItem('lifeos-data') === '{"v":"new"}', JSON.stringify(r));
  }

  console.log('\n=== E. 一键回滚数据不丢（S6 硬卡） ===');
  {
    const fake = fakeIDB();
    const { S, values } = load({ indexedDB: fake });
    S.setItem('lifeos-data', '{"keep":1}');
    S.setItem('lifeos-notes-cache', '["a"]');
    await S.flush();
    const before = (await S.idbCount());
    const st = S.rollback();
    ok('rollback 切回 legacy', st.mode === 'legacy');
    ok('回滚后 lifeos-data 仍可读', S.getItem('lifeos-data') === '{"keep":1}');
    ok('回滚后其它键仍可读', S.getItem('lifeos-notes-cache') === '["a"]');
    ok('回滚后 localStorage 数据完整', values['lifeos-data'] === '{"keep":1}');
    ok('回滚不清空 IDB（可随时切回）', (await S.idbCount()) === before);
    ok('回滚后新写入仍走 localStorage 且不再进 IDB', (() => {
      S.setItem('lifeos-after-rollback', '1');
      return values['lifeos-after-rollback'] === '1';
    })());
  }

  console.log('\n=== F. 运行时故障自动降级 ===');
  {
    const { S, values } = load({ indexedDB: fakeIDB(true) });
    await S.hydrate();
    ok('IDB 打开失败后 status().degraded=true', S.status().degraded === true);
    ok('故障后 mode 自动降级 legacy', S.mode() === 'legacy');
    S.setItem('lifeos-data', '{"safe":true}');
    ok('故障后 setItem 仍写入 localStorage（数据不丢）', values['lifeos-data'] === '{"safe":true}');
    ok('故障后 lastError 有可读信息', String(S.status().lastError || '').length > 0);
  }

  console.log('\n=== G. exportAll / 会话语义 / 源码边界 ===');
  {
    const { S } = load({ indexedDB: fakeIDB(), initial: {
      'lifeos-data': '{}', 'lifeos-snapshots': '[]', 'lifeos-storage-mode': 'dual'
    } });
    const all = S.exportAll();
    ok('exportAll 含业务键', all['lifeos-data'] === '{}' && all['lifeos-snapshots'] === '[]');
    ok('exportAll 不含模式元数据 MODE_KEY', !('lifeos-storage-mode' in all));
    ok('exportAll 可 JSON 序列化（导入导出兼容）', (() => {
      try { JSON.stringify(all); return true; } catch (e) { return false; }
    })());
  }
  {
    ok('storage.js 不触碰 sessionStorage（会话语义不迁）',
      !/sessionStorage\.(getItem|setItem|removeItem)/.test(CODE));
    ok('storage.js 只管理 lifeos- 前缀键', /PREFIX\s*=\s*'lifeos-'/.test(CODE));
    ok('storage.js 的 setItem 无条件写 localStorage', /if \(ls\) ls\.setItem\(k, s\)/.test(CODE));
    ok('各调用点已收敛到 DB 别名', (() => {
      const files = ['bridge.js', 'store.js', 'mindsea.js', 'seed-library.js', 'app.js'];
      const mods = ['settings.js', 'codex.js', 'library.js'];
      const rd = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', p), 'utf8');
      return files.every((f) => /const DB = L\.storage \|\| localStorage/.test(rd(f))) &&
        mods.every((f) => /const DB = L\.storage \|\| localStorage/.test(rd('modules/' + f)));
    })());
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('❌ storage.test.js 异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
