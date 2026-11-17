/* =========================================================================
 * LifeOS · 发布后线上校验
 *
 * 比对「本地构建产物」与「线上实际内容」，确认发布真的生效（而不只是返回 200）：
 *   - version.json 的版本号 / 缓存名一致
 *   - 首页 12 个视图导航齐全（含知识库、识海与 Codex）
 *   - sw.js 的 CACHE 名一致（防止旧 SW 清单残留）
 *   - 抽样文件内容 hash 与本地一致（防止 CDN 返回旧缓存）
 *
 * 用法：
 *   node verify-release.js                       # 校验默认线上地址
 *   node verify-release.js "https://xxx/?sharecode=..."  # 指定地址
 *   node verify-release.js --json                # 机器可读输出
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'src');
const DEFAULT_URL = 'https://alifeosv3nov09.app.workbuddy.host/?sharecode=33O3OVO2Z3';
const asJSON = process.argv.includes('--json');
const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const BASE_URL = urlArg || DEFAULT_URL;

const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

// 把 sharecode 等查询参数带到每个资源请求上
let u;
try { u = new URL(BASE_URL); } catch (e) { fail('URL 不合法：' + BASE_URL); }
function resourceURL(rel) {
  const x = new URL(rel, u.origin + '/');
  for (const [k, v] of u.searchParams) x.searchParams.set(k, v);
  return x.toString();
}

let pass = 0, failCount = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push({ name, ok: true }); }
  else { failCount++; results.push({ name, ok: false, extra: extra || '' }); }
}
function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

/* 必须按字节取：图标等二进制资源若用 r.text() 会被 UTF-8 解码，
 * 无效字节替换成 U+FFFD 后 hash 就对不上了（全量校验时才会暴露）。 */
async function fetchBuf(rel) {
  const r = await fetch(resourceURL(rel), { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function get(rel) { return (await fetchBuf(rel)).toString('utf8'); }
const shortHash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

async function main() {
  if (!asJSON) {
    console.log('本地构建版本：' + local.version + '  (' + local.builtAt + ')');
    console.log('校验目标：' + u.origin + '\n');
  }

  // 1) 线上 version.json
  let remote = null;
  try { remote = JSON.parse(await get('version.json')); }
  catch (e) { ok('线上 version.json 可读取', false, e.message); }
  if (remote) {
    ok('线上 version.json 可读取', true);
    ok('版本号一致（' + local.version + '）', remote.version === local.version,
      '线上=' + remote.version + ' 本地=' + local.version);
    ok('SW 缓存名一致', remote.cache === local.cache, '线上=' + remote.cache);
    ok('源文件数一致', remote.fileCount === local.fileCount,
      '线上=' + remote.fileCount + ' 本地=' + local.fileCount);
  }

  // 2) 首页导航
  try {
    const index = await get('index.html');
    const views = (index.match(/data-view="[a-z]+"/g) || []);
    ok('首页含 12 个视图导航', views.length === 12, '实际 ' + views.length + ' 个');
    ['library', 'calendar', 'heatmap', 'graph', 'mindsea', 'codex'].forEach((v) => {
      ok('首页含 ' + v + ' 入口', index.indexOf('data-view="' + v + '"') >= 0);
    });
  } catch (e) { ok('首页可读取', false, e.message); }

  // 3) sw.js 的 CACHE 名
  try {
    const sw = await get('sw.js');
    const m = sw.match(/const CACHE = '([^']+)'/);
    ok('线上 sw.js CACHE 名一致', !!m && m[1] === local.cache, m ? m[1] : '未找到');
    ok('线上 sw.js 为 network-first', sw.indexOf("mode === 'navigate'") >= 0);
  } catch (e) { ok('sw.js 可读取', false, e.message); }

  // 4) 全量文件内容 hash：以 version.json 的 files 清单为准，不再只抽样核心文件
  const samples = Object.keys(local.files);
  ok('校验覆盖全部构建文件（' + samples.length + ' 个）',
    samples.length === local.fileCount,
    '清单 ' + samples.length + ' 个 / fileCount ' + local.fileCount);
  for (const f of samples) {
    try {
      const buf = await fetchBuf(f);
      const lh = local.files[f];
      const rh = shortHash(buf);
      ok('内容一致 ' + f, !lh || rh === lh,
        lh ? '线上=' + rh + ' 本地=' + lh : '本地清单缺失');
    } catch (e) { ok('可读取 ' + f, false, e.message); }
  }

  if (asJSON) {
    console.log(JSON.stringify({ version: local.version, target: u.origin, pass, fail: failCount, results }, null, 2));
  } else {
    results.forEach((r) => console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.ok ? '' : '  → ' + r.extra)));
    console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败');
    console.log(failCount === 0
      ? '✅ 线上内容与本地构建完全一致，发布已生效'
      : '❌ 线上与本地不一致，可能是缓存或发布未覆盖，请重新发布并检查');
  }
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => fail('校验异常：' + e.message));
