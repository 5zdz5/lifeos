/* =========================================================================
 * 浏览器回归测试（真实渲染层，条件运行）
 *
 *   LIFEOS_TEST_URL="https://.../?sharecode=..." npm run test:browser
 *
 * 未设置 URL 或环境里没有 Playwright/Chrome 时自动跳过，不影响 npm test。
 * 覆盖：真实渲染、XSS 不执行、Markdown 协议白名单、hash 深链、主题元信息、
 *       JS 隔离执行与死循环终止、320px 无溢出、控制台零报错；
 *       密钥边界（备份/快照不含密钥、导入不覆盖、会话模式）与日期中文回显。
 * ========================================================================= */
const fs = require('fs');

const TEST_URL = process.env.LIFEOS_TEST_URL;
let PW = null;
for (const c of [
  'playwright', 'playwright-core',
  '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright',
  '/root/.nvm/versions/node/v22.13.0/lib/node_modules/playwright'
]) {
  try { PW = require(c); break; } catch (_) { /* 继续找 */ }
}
const chrome = [process.env.CHROME_PATH, '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });

if (!TEST_URL || !PW || !chrome) {
  console.log('⏭  跳过浏览器回归：需 LIFEOS_TEST_URL、Playwright 与 Chrome（可用 CHROME_PATH 指定）');
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
  const browser = await PW.chromium.launch({
    headless: true, executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  const resp = await p.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(600);

  console.log('\n=== A. 页面渲染 ===');
  ok('首页返回 200', resp && resp.status() === 200, resp && String(resp.status()));
  ok('标题正确', (await p.title()).indexOf('LifeOS') >= 0);
  ok('12 个视图导航齐全', (await p.locator('#nav .nav-item').count()) === 12);
  ok('导航全部使用 SVG 图标', (await p.locator('#nav .nav-item svg').count()) === 12);

  console.log('\n=== B. 存储型 XSS 已封堵 ===');
  const xss = await p.evaluate(async () => {
    window.__hit = 0;
    LifeOS.store.setSettings({ userName: '<img src=x onerror="window.__hit=1">' });
    LifeOS.app.showView('dashboard');
    await new Promise((r) => setTimeout(r, 400));
    return { hit: window.__hit, text: (document.querySelector('.greet') || {}).textContent || '' };
  });
  ok('注入的 userName 不执行脚本', xss.hit === 0, 'hit=' + xss.hit);
  ok('注入内容按纯文本显示', xss.text.indexOf('<img') >= 0);
  const md = await p.evaluate(() => LifeOS.utils.markdown('[点我](javascript:alert(1))'));
  ok('Markdown 不再生成 javascript: 链接', md.indexOf('href="javascript') < 0, md);

  console.log('\n=== C. 深链与主题 ===');
  await p.evaluate(() => { location.hash = '#mindsea'; });
  await p.waitForTimeout(600);
  const h = await p.evaluate(() => ({
    title: document.getElementById('view-title').textContent,
    active: (document.querySelector('.nav-item.active') || {}).getAttribute
      ? document.querySelector('.nav-item.active').getAttribute('data-view') : null
  }));
  ok('改 hash 直接切换视图（无需刷新）', h.title === '识海记忆' && h.active === 'mindsea',
    JSON.stringify(h));
  const tc1 = await p.evaluate(() => document.querySelector('meta[name="theme-color"]').content);
  await p.click('#theme-toggle');
  await p.waitForTimeout(250);
  const tc2 = await p.evaluate(() => document.querySelector('meta[name="theme-color"]').content);
  ok('主题切换同步 theme-color', tc1 !== tc2 && ['#e9eeed', '#0d1514'].indexOf(tc2) >= 0,
    tc1 + ' → ' + tc2);

  console.log('\n=== D. JS 隔离执行 ===');
  const run = await p.evaluate(() => LifeOS.bridge.agent.runCode({
    language: 'js', code: 'console.log("hi", 2 + 3);'
  }));
  ok('隔离执行返回正常输出', run.code === 0 && run.stdout.indexOf('hi 5') >= 0,
    JSON.stringify(run));
  const leak = await p.evaluate(async () => {
    window.__SECRET = 'topsecret-value';
    const r = await LifeOS.bridge.agent.runCode({
      language: 'js',
      code: 'console.log(typeof localStorage, typeof document); try { console.log("SEEN=" + parent.__SECRET); } catch (e) { console.log("BLOCKED"); }'
    });
    return r.stdout;
  });
  ok('隔离环境读不到父页存储与数据', leak.indexOf('topsecret-value') < 0 &&
    (leak.indexOf('BLOCKED') >= 0 || leak.indexOf('undefined') >= 0), leak);
  const loop = await p.evaluate(async () => {
    const t0 = Date.now();
    const r = await LifeOS.bridge.agent.runCode({ language: 'js', code: 'while(true){}' });
    return { code: r.code, ms: Date.now() - t0, note: r.note };
  });
  ok('死循环可被终止且不卡死页面', loop.code === -1 && loop.ms < 8000, JSON.stringify(loop));

  console.log('\n=== F. 弹窗键盘契约 ===');
  await p.evaluate(() => LifeOS.store.setSettings({ userName: '' }));
  await p.locator('.nav-item[data-view="tasks"]').click();
  await p.locator('#add-task').click();
  await p.waitForTimeout(200);
  const focused = await p.evaluate(() => ({
    id: document.activeElement && document.activeElement.id,
    inModal: !!(document.activeElement && document.activeElement.closest('.modal-overlay'))
  }));
  ok('弹窗打开后自动聚焦输入框', focused.id === 'f-title' && focused.inModal, JSON.stringify(focused));
  await p.locator('#f-title').fill('键盘建的任务');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(350);
  ok('输入框按 Enter 可提交',
    (await p.locator('.modal-overlay.show').count()) === 0 &&
    (await p.locator('#view').innerText()).indexOf('键盘建的任务') >= 0);
  await p.locator('#add-task').click();
  await p.waitForTimeout(150);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  ok('ESC 可关闭弹窗', (await p.locator('.modal-overlay.show').count()) === 0);
  await p.locator('#add-task').click();
  await p.waitForTimeout(150);
  await p.locator('.modal-overlay.show [data-act="save"]').click();
  await p.waitForTimeout(250);
  const emptyFeedback = await p.evaluate(() => ({
    stillOpen: !!document.querySelector('.modal-overlay.show'),
    toast: (document.querySelector('.toast') || {}).textContent || ''
  }));
  ok('空标题保存有明确反馈', emptyFeedback.stillOpen && /标题/.test(emptyFeedback.toast), JSON.stringify(emptyFeedback));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  console.log('\n=== G. 演示模式诚实化 ===');
  ok('顶栏常驻演示标识', await p.locator('#demo-pill').isVisible());
  await p.locator('.nav-item[data-view="ai"]').click();
  await p.waitForTimeout(200);
  ok('AI 助手有醒目的演示状态条', await p.locator('.ai-status-bar.demo').count() === 1);
  await p.locator('#ai-text').fill('帮我规划今天');
  await p.locator('#ai-send').click();
  await p.waitForTimeout(1800);
  const planText = await p.locator('#ai-messages').innerText();
  ok('演示回复不再出现空引号（有上下文分支）',
    planText.indexOf('“”。') < 0 && /根据你的任务与习惯/.test(planText), planText.slice(0, 160));
  // 无上下文分支：验证 mockReply 能正确回显用户输入，而不是空字符串
  await p.evaluate(() => { LifeOS.store.clearAI(); LifeOS.app.refresh(); });
  await p.waitForTimeout(250);
  await p.locator('#ai-text').fill('测试演示回复');
  await p.locator('#ai-send').click();
  await p.waitForTimeout(1500);
  const echoText = await p.locator('#ai-messages').innerText();
  ok('演示回复正确回显用户输入', /你刚才说：“测试演示回复”/.test(echoText) &&
    echoText.indexOf('“”。') < 0, echoText.slice(0, 160));
  ok('AI 页不再把操作说明塞进 placeholder',
    (await p.locator('#ai-text').getAttribute('placeholder')).indexOf('Enter') < 0);

  console.log('\n=== H. 示例内容 / 日历日程 / 视觉破损 / 多标签 ===');
  await p.locator('.nav-item[data-view="library"]').click();
  await p.waitForTimeout(250);
  const seedBefore = await p.evaluate(() => LifeOS.seedLibrary.count(LifeOS.store));
  ok('知识库明确标注示例内容', seedBefore > 0 && (await p.locator('#kb-clear-seed').count()) === 1);
  await p.locator('#kb-clear-seed').click();
  await p.waitForTimeout(200);
  await p.locator('.modal-overlay.show [data-act="ok"]').click();
  await p.waitForTimeout(350);
  ok('清除示例后不再灌回',
    (await p.evaluate(() => LifeOS.seedLibrary.count(LifeOS.store))) === 0);

  await p.locator('.nav-item[data-view="calendar"]').click();
  await p.waitForTimeout(250);
  await p.locator('#cal-new-event').click();
  await p.waitForTimeout(200);
  await p.locator('#ev-title').fill('交方案');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  ok('日历能真正新增日程', (await p.locator('.cal-event').count()) >= 1);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.locator('.nav-item[data-view="calendar"]').click();
  await p.waitForTimeout(250);
  ok('日程刷新后仍持久化', (await p.locator('.cal-event').count()) >= 1);

  await p.locator('.nav-item[data-view="mindsea"]').click();
  await p.waitForTimeout(250);
  const msStyle = await p.evaluate(() => {
    const el = document.querySelector('.ms-stats');
    return el ? getComputedStyle(el).overflow : 'missing';
  });
  ok('识海统计卡不再被裁切', msStyle === 'visible', msStyle);

  const p2 = await ctx.newPage();
  await p2.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await p2.waitForTimeout(350);
  await p2.evaluate(() => LifeOS.store.addTask({ title: '另一个标签页建的' }));
  await p.waitForTimeout(700);
  const synced = await p.evaluate(() =>
    (LifeOS.store.state.tasks || []).some((t) => t.title === '另一个标签页建的'));
  ok('多标签数据同步生效', synced);
  await p2.close();

  console.log('\n=== I. 密钥边界与中文日期（本轮新增） ===');
  const secretProbe = await p.evaluate(() => {
    LifeOS.store.setSettings({ aiKey: 'sk-browser-secret', aiBaseUrl: 'https://private.example/v1' });
    const payload = LifeOS.store.exportPayload();
    return {
      inExport: JSON.stringify(payload).indexOf('sk-browser-secret') >= 0,
      hasKey: 'aiKey' in payload.data.settings,
      hasBase: 'aiBaseUrl' in payload.data.settings,
      hasModel: typeof payload.data.settings.aiModel === 'string',
      snapHasKey: (localStorage.getItem('lifeos-snapshots') || '').indexOf('sk-browser-secret') >= 0
    };
  });
  ok('导出备份不含密钥与接口地址',
    !secretProbe.inExport && !secretProbe.hasKey && !secretProbe.hasBase && secretProbe.hasModel,
    JSON.stringify(secretProbe));
  ok('本地快照不含明文密钥', !secretProbe.snapHasKey);

  const importProbe = await p.evaluate(async () => {
    const before = LifeOS.store.state.settings.aiKey;
    const evil = JSON.stringify({ app: 'LifeOS', schema: 1, data: {
      tasks: [], habits: [], notes: [], aiThread: [],
      settings: { aiKey: 'sk-attacker', aiBaseUrl: 'https://evil.example/v1', userName: '外部用户' }
    }});
    await LifeOS.store.importPayload(evil, 'replace');
    const s = LifeOS.store.state.settings;
    return { before, after: s.aiKey, base: s.aiBaseUrl, user: s.userName };
  });
  ok('导入他人备份不改本机密钥 / 接口地址',
    importProbe.after === importProbe.before &&
    importProbe.base === 'https://private.example/v1' &&
    importProbe.user === '外部用户', JSON.stringify(importProbe));

  const sessionProbe = await p.evaluate(async () => {
    const st = LifeOS.store.state;
    await LifeOS.bridge.save(Object.assign({}, st, {
      settings: Object.assign({}, st.settings, { aiKey: 'sk-session-only', aiKeySessionOnly: true })
    }));
    const long = JSON.parse(localStorage.getItem('lifeos-data') || '{}');
    const reloaded = await LifeOS.bridge.load();
    return {
      longKey: (long.settings || {}).aiKey || '',
      flag: (long.settings || {}).aiKeySessionOnly === true,
      shortKey: sessionStorage.getItem('lifeos-session-key') || '',
      loadedKey: (reloaded.settings || {}).aiKey || ''
    };
  });
  ok('仅本次会话保存：长期存储不留明文',
    sessionProbe.longKey === '' && sessionProbe.flag, JSON.stringify(sessionProbe));
  ok('仅本次会话保存：会话内可正常读回',
    sessionProbe.shortKey === 'sk-session-only' && sessionProbe.loadedKey === 'sk-session-only',
    JSON.stringify(sessionProbe));

  await p.evaluate(() => {
    LifeOS.store.setSettings({ aiKey: '', aiKeySessionOnly: false, userName: '' });
    try { sessionStorage.removeItem('lifeos-session-key'); } catch (_) { /* noop */ }
  });
  await p.locator('.nav-item[data-view="settings"]').click();
  await p.waitForTimeout(250);
  ok('设置页提供「仅本次会话保存」开关', (await p.locator('#s-key-session').count()) === 1);
  ok('设置页说明备份不含密钥',
    (await p.locator('#view').innerText()).indexOf('备份与本地快照都不含密钥') >= 0);

  await p.locator('.nav-item[data-view="calendar"]').click();
  await p.waitForTimeout(250);
  await p.locator('#cal-new-event').click();
  await p.waitForTimeout(200);
  const cn0 = await p.locator('#ev-date-cn').innerText();
  ok('新建日程默认显示中文日期',
    /当前选择：\d{4}年\d{1,2}月\d{1,2}日 · 周[日一二三四五六]/.test(cn0), cn0);
  await p.evaluate(() => {
    const el = document.querySelector('#ev-date');
    el.value = '2026-12-25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(120);
  const cn1 = await p.locator('#ev-date-cn').innerText();
  ok('改动日期后中文回显实时更新', cn1.indexOf('2026年12月25日') >= 0 && cn1 !== cn0, cn1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  await p.locator('.nav-item[data-view="tasks"]').click();
  await p.waitForTimeout(200);
  await p.locator('#add-task').click();
  await p.waitForTimeout(150);
  await p.evaluate(() => {
    const el = document.querySelector('#f-due');
    el.value = '2026-12-25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const tcn = await p.locator('#f-due-cn').innerText();
  ok('任务截止日也有中文实时回显', tcn.indexOf('2026年12月25日') >= 0, tcn);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  console.log('\n=== J. 统一存储引擎（W1 新增）===');
  const stStat = await p.evaluate(() => {
    const S = window.LifeOS && window.LifeOS.storage;
    return S ? S.status() : null;
  });
  ok('统一存储适配层已加载并暴露 status()', !!stStat && typeof stStat.mode === 'string');
  ok('status() 含完整灰度字段（supported/degraded/active）',
    !!stStat && typeof stStat.supported === 'boolean' &&
    typeof stStat.degraded === 'boolean' && typeof stStat.active === 'boolean',
    JSON.stringify(stStat));
  ok('当前模式属于 legacy/dual/idb 三态之一',
    !!stStat && ['legacy', 'dual', 'idb'].indexOf(stStat.mode) >= 0, stStat && stStat.mode);

  const dualWrite = await p.evaluate(async () => {
    const S = window.LifeOS.storage;
    const key = 'lifeos-w1-probe';
    S.setItem(key, 'w1-browser-value');
    const localNow = localStorage.getItem(key);
    const syncNow = S.getItem(key);
    await S.flush();
    const rows = await S.idbGetAll();
    const mirrored = Array.isArray(rows) &&
      rows.some((r) => r && r.k === key && r.v === 'w1-browser-value');
    S.removeItem(key);
    await S.flush();
    return { localNow, syncNow, mirrored };
  });
  ok('setItem 同步写 localStorage（回滚基线永不丢）', dualWrite.localNow === 'w1-browser-value');
  ok('同步 getItem 与 localStorage 一致', dualWrite.syncNow === 'w1-browser-value');
  ok('双写镜像生效或已正确降级（IDB 不可用时不误判）',
    dualWrite.mirrored || !stStat.supported || stStat.mode === 'legacy',
    JSON.stringify(dualWrite) + ' / ' + JSON.stringify(stStat));

  const cssProbe = await p.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const cs = getComputedStyle(document.documentElement);
    return {
      links: links.length,
      href: links[0] ? links[0].getAttribute('href') : '',
      radius: cs.getPropertyValue('--r').trim(),
      bg: cs.getPropertyValue('--bg').trim()
    };
  });
  ok('页面只引单一 app.css（CSS 双层已合并）',
    cssProbe.links === 1 && cssProbe.href.indexOf('app.css') >= 0, JSON.stringify(cssProbe));
  ok('合并后设计令牌仍生效（视觉零破损）',
    cssProbe.radius === '18px' && cssProbe.bg.length > 0, JSON.stringify(cssProbe));

  await p.locator('.nav-item[data-view="settings"]').click();
  await p.waitForTimeout(250);
  ok('设置页提供存储引擎三态选择器', (await p.locator('#s-storage-mode option').count()) === 3);
  ok('设置页提供「导出备份并切换」与「一键回滚」',
    (await p.locator('#s-storage-apply').count()) === 1 &&
    (await p.locator('#s-storage-rollback').count()) === 1);
  ok('设置页标注默认双写灰度与迁移前强制备份',
    /双写灰度/.test(await p.locator('#view').innerText()) &&
    /强制先导出一份备份/.test(await p.locator('#view').innerText()));

  console.log('\n=== L. 知识内容 W2（真实运行时）===');
  // B1：反链上下文与未链接提及
  const b1 = await p.evaluate(async () => {
    const S = LifeOS.store;
    // 造两篇互相引用 / 纯文本提及的笔记
    S.state.notes = S.state.notes.filter((n) => !/^W2-/.test(n.title || ''));
    const a = S.addNote({ title: 'W2-甲', body: '总纲', tags: [] });
    const b = S.addNote({ title: 'W2-乙', body: '见 [[W2-甲]] 的说明。\n另外 W2-甲 也常被口头提起。', tags: [] });
    const ctxs = LifeOS.links.backlinkContexts(a);
    const mentions = LifeOS.links.unlinkedMentions(a);
    // 安全重命名
    const before = b.body;
    const rn = LifeOS.links.renameNoteLinks(S.state, a.id, 'W2-甲', 'W2-甲改名');
    return {
      ctxCount: ctxs.length, hasSnippet: ctxs.some((c) => c.snippets.some((s) => s.indexOf('[[W2-甲]]') >= 0)),
      mentionCount: mentions.length, rnCount: rn.changed,
      rewritten: b.body.indexOf('[[W2-甲改名]]') >= 0, aliasBefore: before.indexOf('[[W2-甲]]') >= 0,
      vault: !!LifeOS.vault, search: !!LifeOS.search, daily: !!(LifeOS.modules && LifeOS.modules.daily)
    };
  });
  ok('B1 反链上下文给出引用原文', b1.ctxCount >= 1 && b1.hasSnippet, JSON.stringify(b1));
  ok('B1 未链接提及识别出纯文本命中', b1.mentionCount >= 1, JSON.stringify(b1));
  ok('B1/B3 重命名安全改写全库 wikilink', b1.rnCount >= 1 && b1.rewritten && b1.aliasBefore, JSON.stringify(b1));
  ok('W2 三个新核心模块均已加载', b1.vault && b1.search && b1.daily, JSON.stringify(b1));

  // B3：Markdown 往返
  const b3 = await p.evaluate(() => {
    const n = { title: 'W2-导出测试', body: '正文 [[链接A]]\n第二行', tags: ['x'], createdAt: Date.now(), updatedAt: Date.now() };
    const md = LifeOS.vault.noteToMarkdown(n);
    const back = LifeOS.vault.markdownToNote(md, 'x.md');
    const files = LifeOS.vault.exportNotes([n, Object.assign({}, n)]);
    return { hasFm: /^---\ntitle:/.test(md), title: back.title, hasWiki: back.body.indexOf('[[链接A]]') >= 0,
      dedup: files[0].filename !== files[1].filename };
  });
  ok('B3 .md 导出含 frontmatter 且往返还原标题', b3.hasFm && b3.title === 'W2-导出测试', JSON.stringify(b3));
  ok('B3 .md 往返保留 wikilink 正文', b3.hasWiki, JSON.stringify(b3));
  ok('B3 全库导出同名文件自动去重', b3.dedup, JSON.stringify(b3));

  // B4：全局检索面板（顶栏按钮 + 快捷键 + 聚合结果）
  await p.setViewportSize({ width: 1440, height: 960 });
  await p.locator('.nav-item[data-view="notes"]').click();
  await p.waitForTimeout(200);
  ok('B4 笔记工具栏有每日/导入/导出入口',
    (await p.locator('#note-daily').count()) === 1 &&
    (await p.locator('#note-import-md').count()) === 1 &&
    (await p.locator('#note-export-md').count()) === 1);
  await p.locator('#global-search').click();
  await p.waitForTimeout(250);
  ok('B4 顶栏按钮打开全局检索面板', (await p.locator('#gs-input').count()) === 1);
  await p.locator('#gs-input').fill('W2-');
  await p.waitForTimeout(300);
  const gsCount = await p.locator('.gs-item').count();
  ok('B4 跨实体聚合出结果', gsCount >= 1, '结果 ' + gsCount + ' 条');
  ok('B4 结果高亮命中关键词', (await p.locator('.gs-item mark').count()) >= 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  ok('B4 ESC 关闭检索面板', (await p.locator('.gs-input').count()) === 0);
  // Ctrl+K 快捷键
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(250);
  ok('B4 Ctrl+K 快捷键打开检索', (await p.locator('#gs-input').count()) === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // B2：每日笔记视图 + 日历联动
  await p.locator('#note-daily').click();
  await p.waitForTimeout(250);
  ok('B2 每日笔记视图渲染分栏', (await p.locator('.dl-grid .dl-col').count()) === 3);
  ok('B2 每日笔记有中文日期回显', /当前选择：\d{4}年/.test(await p.locator('#dl-date-cn').innerText()));
  const dailyOpenBefore = await p.evaluate(() => LifeOS.store.state.notes.filter((n) => LifeOS.modules.daily.isDaily(n)).length);
  await p.locator('#dl-open').click();
  await p.waitForTimeout(300);
  const dailyOpenAfter = await p.evaluate(() => LifeOS.store.state.notes.filter((n) => LifeOS.modules.daily.isDaily(n)).length);
  ok('B2 创建当日日记并打开编辑器', dailyOpenAfter >= dailyOpenBefore && (await p.locator('#e-body').count()) === 1,
    dailyOpenBefore + ' → ' + dailyOpenAfter);
  ok('B2 日记是普通笔记（daily 标记，不新增顶层实体）', await p.evaluate(() =>
    LifeOS.store.state.notes.some((n) => LifeOS.modules.daily.isDaily(n))));

  await p.locator('.nav-item[data-view="calendar"]').click();
  await p.waitForTimeout(250);
  ok('B2 日历侧栏有「当日日记」入口', (await p.locator('#cal-open-daily').count()) === 1);

  console.log('\n=== E. 窄屏抽屉与控制台 ===');
  await p.setViewportSize({ width: 375, height: 812 });
  await p.waitForTimeout(250);
  ok('窄屏显示菜单按钮', await p.locator('#nav-toggle').isVisible());
  await p.locator('#nav-toggle').click();
  await p.waitForTimeout(250);
  const drawer = await p.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const t = document.querySelector('.nav-item .nav-text');
    return { open: !!sb && sb.classList.contains('open'), textVisible: !!t && getComputedStyle(t).display !== 'none' };
  });
  ok('抽屉展开后能看见文字标签', drawer.open && drawer.textVisible, JSON.stringify(drawer));
  await p.locator('.nav-item[data-view="notes"]').click();
  await p.waitForTimeout(250);
  ok('点击导航后抽屉自动收起',
    !(await p.evaluate(() => document.querySelector('.sidebar').classList.contains('open'))));
  await p.setViewportSize({ width: 320, height: 720 });
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('320px 无横向溢出', overflow <= 1, 'overflow=' + overflow);

  console.log('\n=== K. URL 应急回滚与一键回滚（W1 新增）===');
  // 用独立标签页，避免切换主页面的存储模式影响其它断言。
  // 必须用 URL 对象写 searchParams：字符串拼接会把参数塞进 #fragment（W3 实测修复）。
  const legacyU = new URL(TEST_URL);
  legacyU.searchParams.set('storage', 'legacy');
  const legacyURL = legacyU.toString();
  const p3 = await ctx.newPage();
  const errs3 = [];
  p3.on('pageerror', (e) => errs3.push('pageerror: ' + e.message));
  p3.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
  await p3.setViewportSize({ width: 1440, height: 960 });
  await p3.goto(legacyURL, { waitUntil: 'networkidle', timeout: 60000 });
  await p3.waitForTimeout(500);
  const rollbackProbe = await p3.evaluate(() => {
    const S = window.LifeOS && window.LifeOS.storage;
    if (!S) return null;
    const before = S.status();
    // 写一条数据，模拟「回滚后仍需可读」
    S.setItem('lifeos-w1-rollback-probe', 'keep-me');
    const readable = S.getItem('lifeos-w1-rollback-probe');
    const local = localStorage.getItem('lifeos-w1-rollback-probe');
    const after = S.rollback();
    const stillReadable = S.getItem('lifeos-w1-rollback-probe');
    return { mode: before.mode, override: before.urlOverride, readable, local,
      afterMode: after.mode, stillReadable };
  });
  ok('URL ?storage=legacy 强制切回旧存储且优先级最高',
    !!rollbackProbe && rollbackProbe.mode === 'legacy' && rollbackProbe.override === 'legacy',
    JSON.stringify(rollbackProbe));
  ok('一键回滚后 mode=legacy 且原有数据仍可读（S6 硬卡）',
    !!rollbackProbe && rollbackProbe.afterMode === 'legacy' &&
    rollbackProbe.readable === 'keep-me' && rollbackProbe.local === 'keep-me' &&
    rollbackProbe.stillReadable === 'keep-me', JSON.stringify(rollbackProbe));
  ok('应急回滚标签页无脚本报错', errs3.length === 0, errs3.join(' | '));
  await p3.close();

  /* ==================== M. W3 动效与 reduced-motion ==================== */
  console.log('\n=== M. W3 动效（C2/C4）与 reduced-motion ===');

  /* 先注入确定性的演示数据，保证热力图有格子、图谱有节点与边 */
  await p.evaluate(() => {
    const L = window.LifeOS, S = L && L.store;
    if (!S || !S.state) return;
    const now = Date.now(), DAY = 86400000;
    const dk = (t) => { const d = new Date(t), off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().slice(0, 10); };
    const ck = {};
    for (let i = 0; i < 180; i++) if (i % 3 !== 0) ck[dk(now - i * DAY)] = true;
    S.state.habits = S.state.habits || [];
    if (!S.state.habits.some((h) => h.id === 'w3-h')) {
      S.state.habits.push({ id: 'w3-h', name: '阅读', emoji: '▤', color: '#176c6b',
        createdAt: now - 180 * DAY, checkins: ck });
    }
    S.state.notes = S.state.notes || [];
    if (!S.state.notes.some((n) => n.id === 'w3-n1')) {
      S.state.notes.push({ id: 'w3-n1', title: 'W3 节点甲',
        body: '链接到 [[W3 节点乙]]。', tags: [], createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY });
      S.state.notes.push({ id: 'w3-n2', title: 'W3 节点乙',
        body: '链接回 [[W3 节点甲]] 与 [[待创建节点]]。', tags: [],
        createdAt: now - DAY, updatedAt: now - DAY });
    }
    if (S.persist) S.persist();
    if (L.app && L.app.refresh) L.app.refresh();
  });

  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.evaluate(() => window.LifeOS.app.showView('heatmap'));
  await p.waitForTimeout(160);
  const hm = await p.evaluate(() => {
    const cells = document.querySelectorAll('.hm-cols .hy-cell[data-date]');
    const cols = document.querySelectorAll('.hm-col[style*="--hm-wi"]');
    const nums = Array.from(document.querySelectorAll('.hs-num[data-count]'));
    const first = cells[0], later = cells[35] || cells[cells.length - 1];
    return {
      cells: cells.length, cols: cols.length,
      anim: first ? getComputedStyle(first).animationName : '',
      delay: later ? getComputedStyle(later).animationDelay : '',
      numDelay: nums[1] ? getComputedStyle(nums[1]).animationDelay : '',
      lastOpacity: nums[3] ? getComputedStyle(nums[3]).opacity : '',
      numsTrue: nums.every((n) => n.textContent.trim() === n.getAttribute('data-count')),
      motionOK: window.LifeOS.utils.motionOK()
    };
  });
  ok('M1 no-preference 下 motionOK 为 true', hm.motionOK === true);
  ok('M2 热力图列写入 --hm-wi 且有真实格子',
    hm.cols > 0 && hm.cells > 300, JSON.stringify(hm));
  ok('M3 热力图格子启用波浪入场关键帧', /w3-cell-in/.test(hm.anim), hm.anim);
  ok('M4 --hm-wi 的 calc 变量继承在真实浏览器生效', parseFloat(hm.delay) > 0, hm.delay);
  ok('M5 权威统计数字无交错延迟、4 个数字同时可见',
    parseFloat(hm.numDelay) === 0 && parseFloat(hm.lastOpacity) > 0,
    'delay=' + hm.numDelay + ' opacity=' + hm.lastOpacity);
  ok('M6 统计数字渲染即真值（不做数值缓动，无误导中间值）',
    hm.numsTrue === true, JSON.stringify(hm));

  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.evaluate(() => window.LifeOS.app.showView('heatmap'));
  await p.waitForTimeout(80);
  const hmR = await p.evaluate(() => {
    const c = document.querySelector('.hm-cols .hy-cell[data-date]');
    const nums = Array.from(document.querySelectorAll('.hs-num[data-count]'));
    return {
      motionOK: window.LifeOS.utils.motionOK(),
      anim: c ? getComputedStyle(c).animationName : '',
      immediate: nums.every((n) => n.textContent.trim() === n.getAttribute('data-count'))
    };
  });
  ok('M7 reduce 下 motionOK 为 false', hmR.motionOK === false);
  ok('M8 reduce 下热力图格子动画归零', hmR.anim === 'none', hmR.anim);
  ok('M9 reduce 下统计数字立即为终值（无缓动）', hmR.immediate === true);

  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.evaluate(() => window.LifeOS.app.showView('graph'));
  await p.waitForTimeout(120);
  const gr = await p.evaluate(() => {
    const edges = document.querySelectorAll('.graph-canvas .g-edge');
    const nodes = document.querySelectorAll('.graph-canvas .g-node');
    const e = edges[0], n = nodes[0];
    return {
      edges: edges.length, nodes: nodes.length,
      len: e ? parseFloat(getComputedStyle(e).getPropertyValue('--g-len')) : 0,
      anim: e ? getComputedStyle(e).animationName : '',
      nodeVar: n ? (n.getAttribute('style') || '').indexOf('--motion-i') >= 0 : false
    };
  });
  ok('M10 图谱渲染出真实节点与边', gr.edges > 0 && gr.nodes >= 2, JSON.stringify(gr));
  ok('M11 --g-len 为真实边长正数', gr.len > 0, String(gr.len));
  ok('M12 边启用描边生长关键帧', /w3-edge-in/.test(gr.anim), gr.anim);
  ok('M13 节点带 --motion-i 交错序号', gr.nodeVar === true);

  await p.waitForTimeout(1100);
  const grOff = await p.evaluate(() => {
    const e = document.querySelector('.graph-canvas .g-edge');
    return e ? getComputedStyle(e).strokeDashoffset : '';
  });
  ok('M14 描边生长结束后 stroke-dashoffset 归零', parseFloat(grOff) === 0, grOff);

  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.evaluate(() => window.LifeOS.app.showView('graph'));
  await p.waitForTimeout(60);
  const grR = await p.evaluate(() => {
    const e = document.querySelector('.graph-canvas .g-edge');
    const n = document.querySelector('.graph-canvas .g-node');
    if (!e || !n) return null;
    return { anim: getComputedStyle(e).animationName,
      off: getComputedStyle(e).strokeDashoffset,
      dash: getComputedStyle(e).strokeDasharray,
      nodeAnim: getComputedStyle(n).animationName };
  });
  ok('M15 reduce 下边动画归零且无描边残留',
    !!grR && grR.anim === 'none' && parseFloat(grR.off) === 0 && grR.dash === 'none',
    JSON.stringify(grR));
  ok('M16 reduce 下节点淡入动画归零', !!grR && grR.nodeAnim === 'none', JSON.stringify(grR));

  await p.emulateMedia({ reducedMotion: 'no-preference' });
  ok('M17 W3 未改变 12 个视图导航', (await p.locator('#nav .nav-item').count()) === 12);

  /* ==================== 结束 ==================== */
  ok('页面无脚本报错', errs.length === 0, errs.join(' | '));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('浏览器测试异常', e); process.exit(1); });
