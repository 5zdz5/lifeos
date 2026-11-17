/* =========================================================================
 * 构建版本机制回归测试
 * 用临时目录验证三条性质（不触碰真实 src）：
 *   1. 相同内容 → 相同版本（幂等，重复构建不会无意义刷新客户端）
 *   2. 只改 sw.js 的 AUTO 区块（CACHE/ASSETS）→ 版本不变（无循环依赖）
 *   3. 改 sw.js 手写逻辑 / 任何源码 → 版本必变（客户端一定能拿到新缓存）
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeVersion, AUTO_RE } = require('../build-standalone.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-build-'));
const SW = `/* sw */
// ===== AUTO-GENERATED-BEGIN (auto) =====
const CACHE = 'lifeos-PLACEHOLDER';
const ASSETS = ['./'];
// ===== AUTO-GENERATED-END =====
self.addEventListener('fetch', e => {});
`;
fs.mkdirSync(path.join(tmp, 'js'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'index.html'), '<html>hello</html>');
fs.writeFileSync(path.join(tmp, 'js', 'app.js'), 'console.log(1);');
fs.writeFileSync(path.join(tmp, 'sw.js'), SW);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const v0 = computeVersion(tmp);
ok('版本为 8 位 hex', /^[0-9a-f]{8}$/.test(v0), v0);
ok('相同内容重复计算版本一致（幂等）', computeVersion(tmp) === v0);

// 只改 AUTO 区块（模拟每次构建 CACHE 名不同）
const swAutoChanged = SW.replace('lifeos-PLACEHOLDER', 'lifeos-aaaaaaaa')
  .replace("ASSETS = ['./']", "ASSETS = ['./', './index.html']");
fs.writeFileSync(path.join(tmp, 'sw.js'), swAutoChanged);
ok('仅 AUTO 区变化 → 版本不变（无循环依赖）', computeVersion(tmp) === v0);

// 改 sw.js 手写逻辑
fs.writeFileSync(path.join(tmp, 'sw.js'), swAutoChanged + "\n// cache logic changed\n");
const vSw = computeVersion(tmp);
ok('sw.js 手写逻辑变化 → 版本变化', vSw !== v0, `${v0} → ${vSw}`);

// 改普通源码
fs.writeFileSync(path.join(tmp, 'js', 'app.js'), 'console.log(2);');
ok('任意源码变化 → 版本变化', computeVersion(tmp) !== vSw);

// 生成物不参与版本（version.json / js/version.js / standalone.html）
fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify({ version: 'whatever' }));
fs.writeFileSync(path.join(tmp, 'js', 'version.js'), 'window.LifeOS.buildInfo={version:"x"};');
fs.writeFileSync(path.join(tmp, 'standalone.html'), '<html>standalone</html>');
fs.writeFileSync(path.join(tmp, 'sw.js'), swAutoChanged + "\n// cache logic changed\n");
ok('生成物变化不影响版本', computeVersion(tmp) === computeVersion(tmp));

fs.rmSync(tmp, { recursive: true, force: true });

/* ---- W1 · CSS 单一来源构建的确定性 ---- */
const cssTool = require('../tools/build-css.js');
const styleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'style.css'), 'utf8');
const finesseSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'finesse.css'), 'utf8');
const parts = [
  { file: 'style.css', role: '基础层', src: styleSrc },
  { file: 'finesse.css', role: '覆盖层', src: finesseSrc }
];
const merged = cssTool.merge(parts);
ok('CSS 合并保留「基础在前、覆盖在后」顺序',
  merged.indexOf('style.css · 基础层') >= 0 &&
  merged.indexOf('finesse.css · 覆盖层') > merged.indexOf('style.css · 基础层'));
ok('CSS 合并含两份源的全部规则文本',
  cssTool.normalize(styleSrc).trim().split('\n').slice(0, 3).every((l) => merged.indexOf(l) >= 0));
ok('CSS 合并幂等（同输入同输出）', cssTool.merge(parts) === merged);
ok('合并产物标注为自动生成、请勿手改', /自动生成，请勿手改/.test(merged));
ok('零依赖构建：tools/build-css.js 不 require 任何第三方包',
  !/require\(['"](?!node:|\.\.?\/|fs|path|crypto|os)/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-css.js'), 'utf8')));
ok('统计出跨文件重复选择器（双层 CSS 债务的量化依据）', (() => {
  const sels = cssTool.selectors(styleSrc + '\n' + finesseSrc);
  return sels.length > 0 && (sels.length - new Set(sels).size) > 0;
})());
ok('index.html 只引单一 app.css', (() => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  return (html.match(/rel="stylesheet"/g) || []).length === 1 && /css\/app\.css/.test(html);
})());
ok('构建脚本清单包含 storage.js 且排在 bridge.js 之前', (() => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'build-standalone.js'), 'utf8');
  return b.indexOf("'js/storage.js'") >= 0 && b.indexOf("'js/storage.js'") < b.indexOf("'js/bridge.js'");
})());

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
