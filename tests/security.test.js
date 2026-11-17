/* =========================================================================
 * 安全回归测试（零依赖）
 * 在 Node 里模拟最小 window 后加载真实的 utils.js / store.js，验证：
 *   - HTML 转义、URL 协议白名单、颜色白名单
 *   - Markdown 不再生成 javascript: 链接
 *   - 导入备份的字段级清洗
 *   - 桥接层不再于本页用 new Function 执行用户代码
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'js');

/* ---------- 最小浏览器环境 ---------- */
const mem = {};
global.window = global;
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v) { mem[k] = String(v); },
  removeItem(k) { delete mem[k]; },
  clear() { for (const k in mem) delete mem[k]; }
};
global.document = {
  createElement() { return { href: '', download: '', click() {}, remove() {} }; },
  body: { appendChild() {} },
  querySelector() { return null; }
};
global.URL.createObjectURL = () => 'blob:mock';
global.URL.revokeObjectURL = () => {};
global.requestAnimationFrame = (fn) => fn();

let uidSeq = 0;
const L = global.LifeOS = {};
eval(fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8'));   // 真实工具层
L.utils.uid = () => 'uid-' + (++uidSeq);
L.buildInfo = { version: 'vTEST', builtAt: 'test' };
const DEFAULT = () => ({
  tasks: [], habits: [], notes: [], library: [], aiThread: [],
  settings: {
    aiBaseUrl: 'https://api.openai.com/v1', aiKey: '', aiModel: 'gpt-4o-mini',
    userName: '', theme: 'auto'
  }
});
L.bridge = {
  mode: 'browser',
  getDefaultState: DEFAULT,
  async load() { return null; },
  async save(state) { mem['lifeos-data'] = JSON.stringify(state); return true; }
};
eval(fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8'));    // 真实数据层
const U = L.utils;
const S = L.store;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async () => {
  await S.init();

  console.log('\n=== A. HTML 转义 ===');
  const esc = U.escapeHtml('<img src=x onerror="a" \'b\'>&');
  ok('尖括号与引号全部转义', !/[<>"']/.test(esc.replace(/&[a-z#0-9]+;/g, '')), esc);
  ok('& 先于其他字符转义', esc.indexOf('&amp;') >= 0);

  console.log('\n=== B. URL 协议白名单 ===');
  ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
    '  javascript:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'blob:https://x/y'].forEach((u, i) => {
    ok('危险协议被拦截 #' + (i + 1), U.safeUrl(u) === '#', JSON.stringify(u) + ' → ' + U.safeUrl(u));
  });
  ok('https 链接放行', U.safeUrl('https://example.com/a?x=1&y=2') === 'https://example.com/a?x=1&y=2');
  ok('mailto 链接放行', U.safeUrl('mailto:a@b.com') === 'mailto:a@b.com');
  ['#anchor', '/path/to', './x.md', '../up', '?q=1'].forEach((u) => {
    ok('相对链接放行 ' + u, U.safeUrl(u) === u);
  });

  console.log('\n=== C. 颜色白名单 ===');
  ok('合法 hex 放行', U.safeColor('#176c6b') === '#176c6b' && U.safeColor('#abc') === '#abc');
  ok('属性注入串被替换', U.safeColor('red" onmouseover="window.__hit=1') === '#176c6b');
  ok('空值回退', U.safeColor(null) === '#176c6b');

  console.log('\n=== D. Markdown 链接 ===');
  const bad = U.markdown('[点我](javascript:window.__md=1)');
  ok('javascript: 链接被降级为 #', bad.indexOf('href="javascript') < 0 && bad.indexOf('href="#"') >= 0, bad);
  const good = U.markdown('[外链](https://example.com)');
  ok('正常外链仍可渲染', good.indexOf('href="https://example.com"') >= 0, good);
  ok('加粗/双向链接未回归', U.markdown('**粗** [[目标|显示]]').indexOf('<strong>粗</strong>') >= 0);

  console.log('\n=== E. 导入备份字段级清洗 ===');
  const evil = {
    app: 'LifeOS', schema: 1,
    data: {
      tasks: [{ id: 'a" onclick="x', title: '<img src=x onerror=1>', note: '正文' }],
      habits: [{ id: 'h1', name: 'x', color: 'red" onmouseover="window.__hit=1' }],
      notes: [], aiThread: [],
      library: [{ id: 'k1', title: 'k', source: { url: 'javascript:alert(1)', label: '源' } }],
      settings: { userName: '<b>注入</b>', theme: 'evil', aiBaseUrl: 'javascript:alert(1)' }
    }
  };
  const p = S.parseImport(JSON.stringify(evil));
  ok('导入保留原始文本内容（不擅自改写）', p.data.tasks[0].title === '<img src=x onerror=1>');
  ok('危险 id 被替换为安全 id', /^[A-Za-z0-9_-]{1,64}$/.test(p.data.tasks[0].id), p.data.tasks[0].id);
  ok('危险 color 被替换为合法 hex', /^#[0-9a-fA-F]{3,8}$/.test(p.data.habits[0].color), p.data.habits[0].color);
  ok('危险 source.url 被降级', p.data.library[0].source.url === '#');
  ok('非法 theme 回退到 auto', p.data.settings.theme === 'auto');
  ok('非法 aiBaseUrl 回退到默认值', p.data.settings.aiBaseUrl === 'https://api.openai.com/v1');
  ok('非法 JSON 仍被拒绝', throws(() => S.parseImport('not json{')));
  ok('无关 JSON 仍被拒绝', throws(() => S.parseImport('{"hello":1}')));
  ok('数组里的非对象条目被过滤', S.parseImport(JSON.stringify({ tasks: [null, 1, 'x', { id: 't1', title: 'ok' }] })).data.tasks.length === 1);

  console.log('\n=== F. 源码层防护（防回归） ===');
  ok('总览问候语对 userName 做转义', /U\.escapeHtml\(st\.settings\.userName\)/.test(read('app.js')));
  ok('知识库来源 URL 走协议白名单', /U\.escapeHtml\(U\.safeUrl\(src\.url\)\)/.test(read('modules/library.js')));
  const bridgeSrc = read('bridge.js');
  ok('桥接层不再在本页 new Function 执行用户代码', !/const fn = new Function\('console', code\)/.test(bridgeSrc));
  ok('桥接层使用 sandbox iframe 隔离', bridgeSrc.indexOf("setAttribute('sandbox', 'allow-scripts')") >= 0);
  ok('桥接层使用可终止的 Worker', bridgeSrc.indexOf('w.terminate()') >= 0);
  // 隔离 Worker 的代码是字符串拼出来的，括号拼错会让整个运行器失效；在 Node 层就解析一次
  const wm = bridgeSrc.match(/const workerSrc = \[([\s\S]*?)\]\.join\('\\n'\)/);
  let workerSyntaxOK = false, workerSyntaxErr = '未提取到 workerSrc';
  if (wm) {
    try {
      const arr = Function('return [' + wm[1] + ']')();
      new Function(arr.join('\n'));        // 只解析、不执行
      workerSyntaxOK = true;
    } catch (e) { workerSyntaxErr = e.message; }
  }
  ok('隔离 Worker 脚本语法有效', workerSyntaxOK, workerSyntaxErr);
  const appSrc = read('app.js');
  ok('存在 hashchange 监听', appSrc.indexOf("addEventListener('hashchange'") >= 0);
  ok('主题元信息随主题更新', appSrc.indexOf("meta[name=\"theme-color\"]") >= 0);

  console.log('\n=== G. 密钥存储与备份边界（防回归） ===');
  const storeSrc = read('store.js');
  ok('导出与快照都剔除密钥类字段',
    /SECRET_SETTING_KEYS/.test(storeSrc) &&
    (storeSrc.match(/portableSettings\(s\.settings\)/g) || []).length >= 2);
  ok('导入不接受外部备份覆盖密钥或接口地址',
    /portableSettings\(raw\.settings\)/.test(storeSrc) &&
    /Object\.assign\(\{\}, portableSettings\(d\.settings\), keep\)/.test(storeSrc));
  ok('恢复快照保留本机密钥且兼容旧快照',
    /SECRET_SETTING_KEYS\.forEach\(\(k\) => \{ this\.state\.settings\[k\] = prev\[k\]/.test(storeSrc));
  ok('旧快照明文密钥会被一次性清理', /sanitizeStoredSnapshots/.test(storeSrc));
  ok('网页版支持仅本次会话保存密钥',
    /aiKeySessionOnly === true/.test(bridgeSrc) &&
    /writeSessionKey\(out\.settings\.aiKey/.test(bridgeSrc) &&
    /out\.settings\.aiKey = ''/.test(bridgeSrc) &&
    /readSessionKey\(\)/.test(bridgeSrc));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常', e); process.exit(1); });
