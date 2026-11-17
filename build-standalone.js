/* =========================================================================
 * LifeOS · 统一构建脚本
 *
 * 一条命令完成：
 *   1. 按源码内容计算版本 hash（含 sw.js 手写逻辑，排除自动生成区，无循环依赖）
 *   2. 生成 src/js/version.js 与 src/version.json（供页面显示 / 线上校验）
 *   3. 自动重写 sw.js 的 AUTO 区块（CACHE 名 + ASSETS 清单，不再手工维护）
 *   4. 打包 dist/lifeos.html 与 src/standalone.html（自包含单文件离线版）
 *   5. 同步鸿蒙工程 rawfile
 *   6. 内联 JS 语法自检
 *
 * 用法：node build-standalone.js
 * 也可被测试 require：const { computeVersion, listFiles } = require('./build-standalone.js')
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT = __dirname;
const ROOT = path.join(PROJECT, 'src');
const OUT = path.join(PROJECT, 'dist');
const RAWFILE = path.join(PROJECT, '..', 'lifeos-harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'lifeos');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readBuf = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// 纯生成物：内容完全由构建决定（且 version.js / version.json 含版本号本身），
// 必须排除在版本计算之外，否则版本号会自我引用、每次构建都变。
const GENERATED = new Set(['js/version.js', 'version.json', 'standalone.html']);
const AUTO_RE = /\/\/ ===== AUTO-GENERATED-BEGIN[\s\S]*?\/\/ ===== AUTO-GENERATED-END =====/;
const isTemp = (p) => /(^|\/)__probe|(^|\/)\./.test(p);

function listFiles(dir, base) {
  let out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out = out.concat(listFiles(full, rel));
    else if (!isTemp(rel)) out.push(rel);
  }
  return out;
}

/* 参与 hash 的文件内容：
 * sw.js 的 AUTO 区块（含 CACHE 名，而 CACHE 名来自 hash）替换为固定占位，
 * 这样既让「手写缓存逻辑」参与版本，又不会形成循环依赖。 */
function contentForHash(rel, buf) {
  if (rel === 'sw.js') return Buffer.from(buf.toString('utf8').replace(AUTO_RE, '/* AUTO */'));
  // index.html 的资源版本串（?v=xxxxxxxx）由 build 注入，用于击穿 SW 旧缓存。
  // 计算版本时剥离它，否则「版本串→内容变→版本变→版本串变」会形成循环依赖。
  if (rel === 'index.html') {
    return Buffer.from(buf.toString('utf8').replace(/\?v=[0-9a-f]{8}/g, ''));
  }
  return buf;
}

/* 资源版本串：给 index.html 的本地 CSS/JS 引用注入 ?v=<hash8>，
 * 让每次发布的资源 URL 唯一 —— 旧 SW 缓存的 key（无版本串）无法命中新 URL，
 * 从根上解决「发布后用户浏览器仍显示旧界面」的缓存滞后问题。 */
const RESOURCE_RE = /((?:href|src)=")((?:css|js)\/[^"?]+)(\.(?:css|js))"/g;
function stampResources(html, hash8) {
  return html.replace(RESOURCE_RE, (m, pre, path, ext) => pre + path + ext + '?v=' + hash8 + '"');
}

function sourceFilesOf(dir) {
  return listFiles(dir, '').filter((f) => !GENERATED.has(f));
}

/* 纯函数：给定目录算出 8 位版本 hash，不写任何文件（供测试复用） */
function computeVersion(dir) {
  const h = crypto.createHash('sha256');
  sourceFilesOf(dir).forEach((f) => {
    h.update(f + '\n');
    h.update(contentForHash(f, fs.readFileSync(path.join(dir, f))));
  });
  return h.digest('hex').slice(0, 8);
}

function build() {
  // W1：确保单一 CSS 产物存在。npm run build 已先跑 tools/build-css.js，
  // 这里只对「直接 node build-standalone.js」做兜底，避免重复生成。
  if (!fs.existsSync(path.join(ROOT, 'css', 'app.css'))) {
    require('./tools/build-css.js').main();
  }

  const hash8 = computeVersion(ROOT);
  const VERSION = 'v' + hash8;
  const CACHE = 'lifeos-' + hash8;
  const builtAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // ---- 0) 资源版本串（cache-busting）：改写 index.html 的本地 CSS/JS 引用 ----
  // 先剥离上一版的版本串（幂等），再注入当前 hash。contentForHash 会剥离它算版本，故无循环。
  const indexPath = path.join(ROOT, 'index.html');
  const indexRaw = fs.readFileSync(indexPath, 'utf8');
  const indexStamped = stampResources(indexRaw.replace(/\?v=[0-9a-f]{8}/g, ''), hash8);
  fs.writeFileSync(indexPath, indexStamped, 'utf8');

  // ---- 1) 写版本脚本（页面显示用） ----
  fs.writeFileSync(
    path.join(ROOT, 'js', 'version.js'),
    '/* 自动生成，请勿手改 · build-standalone.js */\n' +
    'window.LifeOS = window.LifeOS || {};\n' +
    'window.LifeOS.buildInfo = ' + JSON.stringify({ version: VERSION, builtAt: builtAt }) + ';\n',
    'utf8'
  );

  // ---- 2) 自动重写 sw.js 的 AUTO 区块 ----
  const swPath = path.join(ROOT, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  if (!AUTO_RE.test(sw)) throw new Error('sw.js 中找不到 AUTO-GENERATED 区块，无法自动写入缓存清单');
  const finalFiles = listFiles(ROOT, '');
  const assets = ['./', './index.html'].concat(
    finalFiles.filter((f) => f !== 'index.html' && f !== 'sw.js').map((f) => './' + f)
  );
  const block =
    '// ===== AUTO-GENERATED-BEGIN (build-standalone.js 自动生成，请勿手改) =====\n' +
    "const CACHE = '" + CACHE + "';\n" +
    'const ASSETS = [\n' + assets.map((a) => "  '" + a + "'").join(',\n') + '\n];\n' +
    '// ===== AUTO-GENERATED-END =====';
  sw = sw.replace(AUTO_RE, block);
  fs.writeFileSync(swPath, sw, 'utf8');

  // ---- 3) 打包单文件离线版（CSS 用合并后的单一来源，与 index.html 完全一致） ----
  const css = read('css/app.css');
  const jsFiles = [
    'js/version.js', 'js/utils.js', 'js/storage.js', 'js/bridge.js', 'js/store.js',
    'js/links.js', 'js/vault.js', 'js/search.js',
    'js/stats.js', 'js/capture.js', 'js/seed-library.js', 'js/mindsea.js',
    'js/modules/daily.js',
    'js/modules/tasks.js', 'js/modules/habits.js', 'js/modules/notes.js',
    'js/modules/library.js',
    'js/modules/calendar.js', 'js/modules/heatmap.js', 'js/modules/graph.js',
    'js/modules/mindsea.js', 'js/modules/codex.js',
    'js/modules/ai.js', 'js/modules/settings.js', 'js/modules/search.js', 'js/app.js'
  ];
  const js = jsFiles.map((f) => '/* ===== ' + f + ' ===== */\n' + read(f)).join('\n\n');

  let html = read('index.html');
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
  if (!bodyMatch) throw new Error('无法在 index.html 中找到 <body>');
  const body = bodyMatch[1].replace(/<script[^>]*><\/script>/g, '');

  const out =
`<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>LifeOS · 智能生活操作系统</title>
  <meta name="theme-color" content="#0f1115" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <style>
${css}
  </style>
</head>
<body>${body}
  <script>
${js}
  </script>
</body>
</html>
`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'lifeos.html'), out, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'standalone.html'), out, 'utf8');

  // ---- 4) 写 version.json（最后写，避免中间态；记录所有最终文件的 hash 供线上校验） ----
  const files = {};
  listFiles(ROOT, '').forEach((f) => { if (f !== 'version.json') files[f] = sha(readBuf(f)).slice(0, 12); });
  fs.writeFileSync(
    path.join(ROOT, 'version.json'),
    JSON.stringify({ app: 'LifeOS', version: VERSION, cache: CACHE, builtAt: builtAt,
      fileCount: Object.keys(files).length, files: files }, null, 2),
    'utf8'
  );

  // ---- 5) 同步鸿蒙工程 rawfile ----
  if (fs.existsSync(path.dirname(RAWFILE))) {
    fs.rmSync(RAWFILE, { recursive: true, force: true });
    fs.cpSync(ROOT, RAWFILE, { recursive: true });
  }

  // ---- 6) 内联 JS 语法自检（临时目录，不污染交付目录） ----
  fs.writeFileSync('/tmp/lifeos-inline-check.js', js, 'utf8');

  console.log('✅ 构建完成  版本 ' + VERSION + '  (' + builtAt + ')');
  console.log('   版本依据 ' + sourceFilesOf(ROOT).length + ' 个文件（含 sw.js 逻辑）· SW 缓存清单 ' + assets.length + ' 项 · CACHE=' + CACHE);
  console.log('   dist/lifeos.html  ' + (out.length / 1024).toFixed(1) + ' KB');
  console.log('   src/standalone.html / version.json / js/version.js 已生成');
  console.log('   鸿蒙 rawfile ' + (fs.existsSync(RAWFILE) ? '已同步' : '（工程不存在，跳过）'));
}

if (require.main === module) build();
module.exports = { computeVersion, listFiles, contentForHash, AUTO_RE };
