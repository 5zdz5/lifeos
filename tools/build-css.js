/* =========================================================================
 * LifeOS · CSS 单一来源构建（零依赖）
 * -------------------------------------------------------------------------
 * 把 css/style.css（基础层）+ css/finesse.css（覆盖层）按确定性顺序合并为
 * src/css/app.css。index.html 与单文件离线版只引这一份，消除「两个 <link>
 * 互相覆盖」的双层引入；两个源文件仍保留为兼容层与唯一编辑入口。
 *
 * 为什么不用 esbuild：
 *   - 依赖审查门禁要求「作者 / 维护度 / MIT / 已知漏洞 / lockfile 锁定」全过；
 *     本沙箱未安装 esbuild，联网拉取二进制包会引入未审查的供应链面；
 *   - 本任务只是两份自有 CSS 的确定性拼接，零依赖 Node 脚本 100% 可复现、
 *     无第三方代码，正是方案预设的「审查不通过则降级为自研零依赖脚本」。
 *
 * 视觉零风险：输出顺序与 index.html 原先的两个 <link> 完全一致
 *   （style 在前、finesse 在后），脚本不改任何规则，只归一化行尾与空行、
 *   加来源分隔注释、并统计重复选择器作为层叠覆盖的可观测指标。
 *   W3 评估结论：这些重复是「基础层 → 设计系统覆盖层」的有意层叠，
 *   不做规则级破坏性删除（理由与撤销条件见 .ai-memory/handoff.md W3）。
 * 规则级去重与冲突收敛留到 W3（视觉治理 Wave）。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'css');
const OUT = path.join(ROOT, 'app.css');
const PARTS = [
  { file: 'style.css', role: '基础层（令牌 / 组件 / 深浅主题）' },
  { file: 'finesse.css', role: '覆盖层（finesse 设计系统 / Codex 信任层 / 窄屏）' }
];

function normalize(s) {
  return String(s).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

/* 粗略提取顶层规则选择器，仅用于统计重复度，不参与改写 */
function selectors(css) {
  const out = [];
  const re = /(^|\})\s*([^{}@][^{}]*?)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    const s = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (s && s.charAt(0) !== '@') out.push(s);
  }
  return out;
}

/* 纯函数：给定 [{file, role, src}] 返回合并后的 CSS 字符串 */
function merge(parts) {
  const chunks = parts.map((p) => ({ file: p.file, role: p.role, src: normalize(p.src) }));
  const all = chunks.map((c) => c.src).join('\n');
  const sels = selectors(all);
  const seen = Object.create(null);
  let dup = 0;
  sels.forEach((s) => { if (seen[s]) dup++; else seen[s] = 1; });

  const header = [
    '/* ===== app.css · 由 tools/build-css.js 自动生成，请勿手改 =====',
    ' * 单一来源：style.css（基础）+ finesse.css（覆盖），顺序与原 <link> 一致。',
    ' * 改样式请编辑源文件后运行 npm run build；跨文件重复为有意层叠覆盖，不做破坏性删除。',
    ' * 生成统计：' + chunks.map((c) => c.file + ' ' + c.src.split('\n').length + ' 行').join(' · ') +
      ' · 规则 ' + sels.length + ' 处（跨文件重复 ' + dup + ' 处）',
    ' * ==================================================================== */',
    ''
  ].join('\n');

  let out = header;
  chunks.forEach((c) => {
    out += '\n/* ===== ' + c.file + ' · ' + c.role + ' ===== */\n' + c.src;
  });
  return out;
}

function main() {
  const parts = PARTS.map((p) => ({
    file: p.file,
    role: p.role,
    src: fs.readFileSync(path.join(ROOT, p.file), 'utf8')
  }));
  const out = merge(parts);
  fs.writeFileSync(OUT, out, 'utf8');
  const sels = selectors(parts.map((p) => p.src).join('\n'));
  console.log('✅ app.css 已生成：' + out.split('\n').length + ' 行 · ' +
    (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
  console.log('   来源 ' + PARTS.map((p) => p.file).join(' + ') +
    ' · 规则 ' + sels.length + ' 处（跨文件重复 ' +
    (sels.length - new Set(sels).size) + ' 处，为有意层叠覆盖）');
  return out;
}

if (require.main === module) main();
module.exports = { main, merge, normalize, selectors, ROOT, OUT, PARTS };
