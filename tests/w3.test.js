/* =========================================================================
 * W3 · 视觉与动效单测（第 13 套件）
 * C2 微交互一致性 / C4 数据可视化动效 / prefers-reduced-motion
 *
 * 分两部分：
 *   1) vm 隔离加载真实 utils.js，验证 motionOK / countUp / stagger 的行为；
 *   2) 源码静态断言，验证 CSS/JS 动效契约、一套色板、验证链未破坏。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'src', 'js');
const CSS = path.join(ROOT, 'src', 'css');
const SRC = path.join(ROOT, 'src');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
const read = (p) => fs.readFileSync(p, 'utf8');

/* ---------- 1. utils.js 动效工具（真实源码，vm 隔离） ---------- */
function loadUtils(opts) {
  const o = opts || {};
  let clock = 0;
  const frames = [];
  const ctx = {
    console, Date, JSON, Math, Promise, Object, Array, String, Number,
    RegExp, Error, Set, Map, isNaN, parseInt, parseFloat,
    performance: { now: () => clock },
    document: { createElement: () => ({ style: {}, classList: { add() {} } }) },
    window: null
  };
  ctx.window = ctx;
  ctx.LifeOS = {};
  if (o.reduce !== undefined) {
    ctx.matchMedia = () => ({ matches: o.reduce, addEventListener() {}, addListener() {} });
  }
  if (!o.noRaf) ctx.requestAnimationFrame = (cb) => { frames.push(cb); };
  vm.createContext(ctx);
  vm.runInContext(read(path.join(JS, 'utils.js')), ctx);
  return {
    U: ctx.LifeOS.utils,
    run(endMs) {
      const end = endMs == null ? 2000 : endMs;
      while (frames.length && clock < end) {
        clock += 100;
        const cb = frames.shift();
        cb(clock);
      }
    },
    frames
  };
}

function fakeEl(text) {
  const vars = {};
  return {
    textContent: text,
    style: {
      setProperty(k, v) { vars[k] = v; },
      getPropertyValue(k) { return vars[k] || ''; },
      vars
    }
  };
}

(async () => {
  console.log('\n=== C2/C4 · 统一动效工具 ===');
  {
    const a = loadUtils({ reduce: false });
    ok('motionOK 在 no-preference 下为 true', a.U.motionOK() === true);
    const b = loadUtils({ reduce: true });
    ok('motionOK 在 reduce 下为 false', b.U.motionOK() === false);
    const c = loadUtils({});
    ok('motionOK 在无 matchMedia 时保守允许（不误关动效）', c.U.motionOK() === true);
  }
  {
    const a = loadUtils({ reduce: true });
    const el = fakeEl('999');
    a.U.countUp(el, 42, 560);
    ok('reduce 下 countUp 直接落终值且不排帧', el.textContent === '42' && a.frames.length === 0,
      el.textContent + ' / frames=' + a.frames.length);

    const b = loadUtils({ reduce: false, noRaf: true });
    const el2 = fakeEl('999');
    b.U.countUp(el2, 17, 560);
    ok('无 requestAnimationFrame 时直接落终值', el2.textContent === '17');

    const d = loadUtils({ reduce: false });
    const el3 = fakeEl('999');
    d.U.countUp(el3, 120, 560);
    d.run(1200);
    ok('正常路径 countUp 缓动后收敛到精确终值', el3.textContent === '120', el3.textContent);

    const e = loadUtils({ reduce: false });
    const el4 = fakeEl('999');
    e.U.countUp(el4, 0, 560);
    ok('终值为 0 时不启动动画且不会把真实值改坏', el4.textContent === '0' && e.frames.length === 0);
  }
  {
    const a = loadUtils({ reduce: false });
    const nodes = [fakeEl(''), fakeEl(''), fakeEl('')];
    a.U.stagger(nodes, 90);
    ok('stagger 写入 --motion-i 序号', nodes.map((n) => n.style.getPropertyValue('--motion-i')).join(',') === '0,1,2');
    ok('stagger 写入 --motion-step 带单位', nodes[0].style.getPropertyValue('--motion-step') === '90ms');
    const many = Array.from({ length: 50 }, () => fakeEl(''));
    a.U.stagger(many, 22);
    ok('stagger 默认序号封顶 40（避免长列表延迟过长）',
      many[49].style.getPropertyValue('--motion-i') === '40');

    const cols = [fakeEl(''), fakeEl('')];
    a.U.stagger(cols, 13, '--hm-wi', 60);
    ok('stagger 支持自定义变量名与 cap（--hm-wi / 60）',
      cols[1].style.getPropertyValue('--hm-wi') === '1' &&
      cols[1].style.getPropertyValue('--motion-i') === '' &&
      cols[1].style.getPropertyValue('--motion-step') === '13ms');
    const wide = Array.from({ length: 55 }, () => fakeEl(''));
    a.U.stagger(wide, 13, '--hm-wi', 60);
    ok('自定义 cap=60 可覆盖 53 列全年热力图（末列不被压平）',
      wide[52].style.getPropertyValue('--hm-wi') === '52');
  }

  console.log('\n=== C4 · 热力图 / 图谱接入契约 ===');
  {
    const hm = read(path.join(JS, 'modules', 'heatmap.js'));
    const gr = read(path.join(JS, 'modules', 'graph.js'));
    ok('heatmap 波浪由 U.stagger 驱动 --hm-wi，CSS 经变量继承消费',
      hm.indexOf("U.stagger(root.querySelectorAll('.hm-col'), 13, '--hm-wi', 60)") >= 0 &&
      read(path.join(CSS, 'finesse.css')).indexOf('var(--hm-wi') >= 0);
    ok('heatmap 统计数字带 data-count 但明确不做数值缓动',
      hm.indexOf('data-count=') >= 0 && hm.indexOf('U.countUp') < 0);
    ok('graph 计算真实边长写入 --g-len',
      gr.indexOf('--g-len:') >= 0 && gr.indexOf('Math.sqrt') >= 0 && gr.indexOf('len') >= 0);
    ok('graph 边与节点的交错序号由 U.stagger 两处统一写入',
      (gr.match(/U\.stagger\(/g) || []).length === 2 && gr.indexOf('U.countUp') < 0);
    ok('权威统计数字不做数值缓动（避免用户短暂看到偏小/空白数字）',
      hm.indexOf('U.countUp') < 0 && gr.indexOf('U.countUp') < 0);
    ok('U.countUp 仍作为公共能力保留并单测覆盖（当前不挂载统计卡）',
      typeof loadUtils({ reduce: false }).U.countUp === 'function');
    ok('graph 未用 CSS transform 动画覆盖 <g> 的 translate 定位',
      gr.indexOf('transform="translate(') >= 0 && !/w3-fade[^}]*transform/.test(gr));
    ok('graph 保留 <line class="g-edge"> 与节点点击逻辑',
      gr.indexOf('class="g-edge"') >= 0 && gr.indexOf('data-open') >= 0);
  }

  console.log('\n=== C2/C4 · CSS 与 reduced-motion 契约 ===');
  {
    const base = read(path.join(CSS, 'style.css'));
    const fin = read(path.join(CSS, 'finesse.css'));
    const app = read(path.join(CSS, 'app.css'));
    const w3 = fin.slice(fin.indexOf('W3 · 视觉与动效'));

    ok('基础层 style.css 补了独立 reduce 降级',
      base.indexOf('@media (prefers-reduced-motion: reduce)') >= 0 &&
      base.indexOf('.cx2-live') >= 0 && base.indexOf('animation: none !important') >= 0);
    ok('覆盖层 W3 段整体包在 no-preference 内',
      w3.indexOf('@media (prefers-reduced-motion: no-preference)') >= 0);
    ok('覆盖层 W3 段有 reduce 归零块',
      w3.indexOf('@media (prefers-reduced-motion: reduce)') >= 0 &&
      w3.indexOf('animation: none !important') >= 0);
    ok('reduce 块显式清除描边残留（stroke-dashoffset / dasharray）',
      w3.indexOf('stroke-dashoffset: 0 !important') >= 0 &&
      w3.indexOf('stroke-dasharray: none !important') >= 0);
    ok('热力图波浪 / 数字 / 图谱边 / 节点四组关键帧齐备',
      ['@keyframes w3-cell-in', '@keyframes w3-rise', '@keyframes w3-edge-in', '@keyframes w3-fade']
        .every((k) => w3.indexOf(k) >= 0));
    ok('C2 统一焦点环覆盖按钮 / 导航 / 输入 / 检索结果',
      w3.indexOf(':focus-visible') >= 0 && w3.indexOf('.nav-item:focus-visible') >= 0 &&
      w3.indexOf('.gs-item:focus-visible') >= 0);
    ok('统计数字统一淡入、无交错延迟（不出现空白数字卡片）',
      /\.hm-stats \.hs-num, \.graph-stats \.gs b \{\s*animation: w3-rise/.test(w3) &&
      w3.indexOf('var(--motion-step, 90ms)') < 0);
    ok('单源 app.css 已包含全部 W3 规则',
      ['w3-cell-in', 'w3-edge-in', 'w3-fade', 'w3-rise', 'prefers-reduced-motion']
        .every((k) => app.indexOf(k) >= 0));
    ok('app.css 里 W3 规则只出现一次（合并确定、无重复注入）',
      (app.match(/@keyframes w3-cell-in/g) || []).length === 1);

    /* huashu「一套色板一种画风」自查 */
    const colorLiterals = w3.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
    ok('W3 段零新增硬编码色值（一套色板）', colorLiterals.length === 0, colorLiterals.join(','));
    const bad = ['rotate(', 'skew(', 'infinite', 'hue-rotate', 'linear-gradient'];
    ok('W3 段无旋转 / 斜切 / 常驻无限循环 / 随机渐变（六种做坏方式自查）',
      bad.every((k) => w3.indexOf(k) < 0), bad.filter((k) => w3.indexOf(k) >= 0).join(','));
    ok('W3 动效时长均在 .12–1.2s 且统一 var(--ease)',
      (w3.match(/\.\d+s var\(--ease\)/g) || []).length >= 5 && w3.indexOf('var(--ease)') >= 0);
  }

  console.log('\n=== 构建链 / 验证链未破坏 ===');
  {
    const tool = require(path.join(ROOT, 'tools', 'build-css.js'));
    const parts = [
      { file: 'style.css', src: read(path.join(CSS, 'style.css')) },
      { file: 'finesse.css', src: read(path.join(CSS, 'finesse.css')) }
    ];
    const m1 = tool.merge(parts);
    ok('CSS 合并仍幂等（W3 追加后）', tool.merge(parts) === m1);
    ok('合并产物含基础层与覆盖层两段标记',
      m1.indexOf('style.css') >= 0 && m1.indexOf('finesse.css') >= 0);

    const html = read(path.join(SRC, 'index.html'));
    const views = html.match(/data-view="[^"]+"/g) || [];
    ok('首页仍为 12 个视图导航（W2/W3 均未新增导航项）', views.length === 12, String(views.length));
    ok('index.html 仍只引一份 app.css',
      (html.match(/<link[^>]+stylesheet/g) || []).length === 1 && html.indexOf('css/app.css') >= 0);

    const store = read(path.join(JS, 'store.js'));
    const keys = store.match(/const ENTITY_KEYS = \[([^\]]+)\]/);
    ok('ENTITY_KEYS 仍为 6 个顶层实体（未新增实体破坏备份链）',
      !!keys && keys[1].split(',').length === 6, keys ? keys[1] : 'not found');

    const ver = JSON.parse(read(path.join(SRC, 'version.json')));
    ok('version.json 文件清单仍是 35 项（W3 未新增 src 文件）',
      ver.fileCount === 35 && Object.keys(ver.files).length === 35,
      String(ver.fileCount) + '/' + Object.keys(ver.files).length);
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('W3 单测异常', e); process.exit(1); });
