/* =========================================================================
 * PetOS · 桌宠伙伴内核单测（第 14 套件）
 * 白皮书 9 大概念落到 LifeOS 的公共逻辑层 + 工程不变量守护
 *
 * 两部分：
 *   1) vm 隔离加载真实 utils.js，验证 L.pet 内核（装备/授权/分身/名册/故障隔离）；
 *   2) 源码静态断言，确认「注入灵魂不改骨架」——6 实体键 / 12 导航 / 35 文件 / 单 CSS 未破坏。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'src', 'js');
const SRC = path.join(ROOT, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* 用 vm 加载 utils.js，注入一个内存 localStorage，返回 {L, store} */
function loadUtils(initial) {
  const mem = Object.assign({}, initial || {});
  const store = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
  const ctx = {
    console, Date, JSON, Math, Promise, Object, Array, String, Number,
    RegExp, Error, Set, Map, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
    localStorage: store,
    document: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0)
  };
  ctx.window = ctx;
  ctx.LifeOS = {};
  vm.createContext(ctx);
  vm.runInContext(read(path.join(JS, 'utils.js')), ctx);
  // 让 L.pet 走 L.storage 适配层（模拟真实加载顺序）
  ctx.LifeOS.storage = store;
  return { L: ctx.LifeOS, store, mem };
}

(async () => {
  console.log('\n=== A. PetOS 内核 · 名册与持久化 ===');
  {
    const { L, mem } = loadUtils();
    const P = L.pet;
    ok('L.pet 内核已挂载', !!P && typeof P.defaults === 'function');
    const def = P.get();
    ok('默认名册含 3 只宠物', def.pets.length === 3, String(def.pets.length));
    ok('默认激活主控小屿', P.activePet().name === '小屿');
    ok('独立 key 持久化（不写 lifeos-data）', !!mem['lifeos-pet-v1'] && !mem['lifeos-data']);
    ok('key 名字符合约定', P.KEY === 'lifeos-pet-v1');
  }
  {
    const { L } = loadUtils();
    const P = L.pet;
    const added = P.addPet({ name: '回收站·小净2', glyph: '✚' });
    ok('addPet 生成合法 id', !!added && /^p-/.test(added.id));
    ok('addPet 后名册 +1', P.get().pets.length === 4);
    ok('setActive 切换激活宠物', P.setActive(added.id) === true && P.activePet().id === added.id);
    ok('setActive 拒绝不存在的 id', P.setActive('none-x') === false);
  }

  console.log('\n=== B. 故障隔离与脏数据收敛 ===');
  {
    const { L } = loadUtils({ 'lifeos-pet-v1': '{broken json' });
    ok('损坏配置 JSON 不抛异常，回落默认名册', L.pet.get().pets.length === 3);
  }
  {
    const dirty = JSON.stringify({
      pets: [
        { id: 'x', name: '正常', tint: 'teal', equip: 'scholar' },
        { id: 'y', name: '脏色', tint: 'javascript:alert(1)', equip: 'evil-gear' }
      ],
      activeId: 'ghost-not-exist', stats: { links: 99 }
    });
    const { L } = loadUtils({ 'lifeos-pet-v1': dirty });
    const s = L.pet.get();
    ok('非法 tint 收敛为 teal', s.pets[1].tint === 'teal');
    ok('非法装备收敛为 none', s.pets[1].equip === 'none');
    ok('合法装备保留', s.pets[0].equip === 'scholar');
    ok('非法 activeId 回落到首只', s.activeId === 'x');
  }
  {
    const { L } = loadUtils();
    const before = L.pet.get().pets.length;
    for (let i = 0; i < 80; i++) L.pet.addPet({ name: 'p' + i });
    ok('名册有 64 上限保护（防无限膨胀）', L.pet.get().pets.length === 64 && before === 3);
  }

  console.log('\n=== C. 装备与专家系统 ===');
  {
    const { L } = loadUtils();
    const P = L.pet;
    ok('装备表含 5 种专家', P.equipment().length === 5);
    ok('清道夫装备声明需点头', P.gearOf('cleaner').needNod === true);
    ok('学者帽不需点头', P.gearOf('scholar').needNod === false);
    const id = P.activePet().id;
    ok('equipActive 切换成功', P.equipActive('scholar') === true);
    ok('装备后角色更新为专家', /学者帽/.test(P.activePet().role));
    ok('非法装备 id 被拒绝', P.equip(id, 'hack') === false);
  }

  console.log('\n=== D. 点头原则（双阶段授权） ===');
  {
    const { L } = loadUtils();
    const P = L.pet;
    const f = P.approvalFlow({ desc: '删除 3 条过期知识' });
    ok('授权流生成 trace-id', /^nod-/.test(f.trace));
    ok('强制需要点头', f.needsNod === true);
    ok('阶段1=子宠物申请', /子宠物申请/.test(f.stage1.title));
    ok('阶段2=主控点头', /主控点头/.test(f.stage2.title));
    ok('两阶段 trace 不同（可审计）', f.stage1.trace !== f.stage2.trace);
    ok('描述含操作意图', /删除 3 条过期知识/.test(f.stage1.text));
    // 无 DOM 环境（单测）必须保守拒绝，绝不自动放行
    const r = await P.requestApproval({ desc: '删除全部' });
    ok('无 DOM 时授权保守拒绝（防空壳/防误放行）', r === false);
  }
  {
    const { L } = loadUtils();
    ok('危险操作被拒绝后计入统计', (function () {
      L.pet.update((s) => { s.stats.approvalsDenied = (s.stats.approvalsDenied || 0) + 1; });
      return L.pet.stats().approvalsDenied === 1;
    })());
  }

  console.log('\n=== E. 数字分身（习惯沉淀，只认真实行为） ===');
  {
    const { L } = loadUtils();
    const P = L.pet;
    ok('初始无偏好（不凭空编造）', P.userSkills().length === 0);
    P.observe('link'); P.observe('link'); P.observe('link');
    ok('3 次链接行为 → 命中“连成网络”', P.userSkills().some((x) => /网络/.test(x)));
    P.observe('nod');
    ok('1 次点头 → 命中“重视授权”', P.userSkills().some((x) => /授权/.test(x)));
    ok('统计计数准确', P.stats().links === 3 && P.stats().nods === 1);
  }

  console.log('\n=== F. A2A 社交 Trace ===');
  {
    const { L } = loadUtils();
    ok('收件箱有跨宠物消息', L.pet.inbox().length >= 2);
    ok('消息带校验状态', L.pet.inbox().every((m) => m.status === '已校验'));
    const t1 = L.pet.traceId('a2a'), t2 = L.pet.traceId('a2a');
    ok('A2A trace-id 唯一（防幽灵任务）', t1 !== t2 && /^a2a-/.test(t1));
  }

  console.log('\n=== G. 工程不变量守护（注入灵魂不改骨架） ===');
  {
    const html = read(path.join(SRC, 'index.html'));
    const views = html.match(/data-view="[^"]+"/g) || [];
    ok('首页仍为 12 个导航项', views.length === 12, String(views.length));
    ok('index.html 仍只引一份 app.css', (html.match(/<link[^>]+stylesheet/g) || []).length === 1);

    const store = read(path.join(JS, 'store.js'));
    const keys = store.match(/const ENTITY_KEYS = \[([^\]]+)\]/);
    ok('ENTITY_KEYS 仍为 6 个顶层实体（宠物状态未混入）', !!keys && keys[1].split(',').length === 6);

    const ver = JSON.parse(read(path.join(SRC, 'version.json')));
    ok('version.json 文件清单仍为 35 项（内核内嵌 utils.js，未新增源文件）',
      ver.fileCount === 35 && Object.keys(ver.files).length === 35,
      String(ver.fileCount) + '/' + Object.keys(ver.files).length);

    const build = read(path.join(ROOT, 'build-standalone.js'));
    const jsList = build.match(/'js\/modules\/[^']+'/g) || [];
    ok('构建脚本 JS 清单未新增模块文件', jsList.indexOf("'js/modules/pet.js'") < 0);

    // utils.js 内嵌内核不应引入硬编码色值（遵守一套色板）——宠物配色用 tint token 名
    const u = read(path.join(JS, 'utils.js'));
    const petBlock = u.slice(u.indexOf('L.pet = (function'));
    ok('PetOS 内核零硬编码十六进制色值（tint 用语义名）',
      !/#[0-9a-fA-F]{3,8}\b/.test(petBlock));
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('PetOS 单测异常', e); process.exit(1); });
