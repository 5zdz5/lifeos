/* =========================================================================
 * LifeOS · 视觉回归截图工具
 *
 *   LIFEOS_TEST_URL="https://.../?sharecode=..." node tools/capture-shots.js
 *
 * 环境变量：
 *   SHOTS_SET=all（默认，11 张全视图基线）| w3（8 张核心视图 + 3 张动效静帧）
 *   PREFIX=w1 / w3       输出到 docs/<PREFIX>-<name>.png
 *   OUT=docs
 *
 * W3 模式会注入确定性演示数据，并模拟 prefers-reduced-motion 拍静帧。
 * 只产出 PNG 到 docs/，不改动源码、不参与版本 hash。
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const URL_ = process.env.LIFEOS_TEST_URL;
const OUT = path.join(__dirname, '..', process.env.OUT || 'docs');
const PREFIX = process.env.PREFIX || 'w1';
const SET = process.env.SHOTS_SET || 'all';

let PW = null;
for (const c of ['playwright', 'playwright-core',
  '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright',
  '/root/.nvm/versions/node/v22.13.0/lib/node_modules/playwright']) {
  try { PW = require(c); break; } catch (_) { /* next */ }
}
const chrome = [process.env.CHROME_PATH, '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });

if (!URL_ || !PW || !chrome) {
  console.error('需要 LIFEOS_TEST_URL、Playwright 与 Chrome');
  process.exit(1);
}

const VP = { width: 1440, height: 960 };
const MOBILE = { width: 320, height: 720 };

/* 全视图基线（W1 起沿用） */
const BASE = [
  { name: 'dashboard-dark', view: 'dashboard', theme: 'dark', viewport: VP },
  { name: 'dashboard-light', view: 'dashboard', theme: 'light', viewport: VP },
  { name: 'settings-storage', view: 'settings', theme: 'dark', viewport: VP },
  { name: 'notes', view: 'notes', theme: 'dark', viewport: VP },
  { name: 'graph', view: 'graph', theme: 'dark', viewport: VP },
  { name: 'calendar', view: 'calendar', theme: 'light', viewport: VP },
  { name: 'heatmap', view: 'heatmap', theme: 'dark', viewport: VP },
  { name: 'library', view: 'library', theme: 'light', viewport: VP },
  { name: 'mindsea', view: 'mindsea', theme: 'dark', viewport: VP },
  { name: 'tasks', view: 'tasks', theme: 'light', viewport: VP },
  { name: 'mobile-320', view: 'dashboard', theme: 'dark', viewport: MOBILE }
];

/* W3 · 3 张动效静帧：波浪中间帧 / 描边中间帧 / reduced-motion 静帧 */
const MOTION = [
  { name: 'motion-heatmap-wave', view: 'heatmap', theme: 'dark', viewport: VP, wait: 150, motion: true },
  { name: 'motion-graph-draw', view: 'graph', theme: 'dark', viewport: VP, wait: 190, motion: true },
  { name: 'motion-reduced', view: 'dashboard', theme: 'dark', viewport: VP,
    wait: 120, reducedMotion: 'reduce' }
];

/* 逐张视觉回归清单（S3 判据③）：深色/浅色总览、笔记、图谱、日历、热力图、
   设置、320px 窄屏 + 动效静帧 3 张 = 11 张 */
const VISUAL11 = [BASE[0], BASE[1], BASE[3], BASE[4], BASE[5], BASE[6], BASE[2], BASE[10]]
  .concat(MOTION)
  /* 基线证据必须拍「稳定态」：heatmap/graph 等入场动画结束；动效静帧仍用短等待 */
  .map((s) => ((s.view === 'heatmap' || s.view === 'graph') && !s.motion)
    ? Object.assign({}, s, { wait: 1200 }) : s);
const SHOTS = SET === 'w3' ? VISUAL11 : BASE;

/* 确定性演示数据：保证热力图有格子、图谱有节点与边（仅测试会话） */
async function seedVisualData(p) {
  await p.evaluate(() => {
    const L = window.LifeOS, S = L && L.store;
    if (!S || !S.state) return;
    const now = Date.now(), DAY = 86400000;
    const dk = (t) => {
      const d = new Date(t), off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().slice(0, 10);
    };
    const ck = {};
    for (let i = 0; i < 200; i++) if (i % 3 !== 0) ck[dk(now - i * DAY)] = true;
    S.state.habits = S.state.habits || [];
    if (!S.state.habits.some((h) => h.id === 'w3-h')) {
      S.state.habits.push({ id: 'w3-h', name: '阅读', emoji: '▤', color: '#176c6b',
        createdAt: now - 200 * DAY, checkins: ck });
    }
    S.state.notes = S.state.notes || [];
    if (!S.state.notes.some((n) => n.id === 'w3-n1')) {
      const seed = [
        { id: 'w3-n1', title: 'W3 节点甲', body: '链接到 [[W3 节点乙]] 与 [[W3 节点丙]]。' },
        { id: 'w3-n2', title: 'W3 节点乙', body: '链接回 [[W3 节点甲]]。' },
        { id: 'w3-n3', title: 'W3 节点丙', body: '链接到 [[W3 节点甲]] 与 [[待创建节点]]。' }
      ];
      seed.forEach((n, i) => S.state.notes.push(Object.assign({
        tags: [], createdAt: now - (4 - i) * DAY, updatedAt: now - (4 - i) * DAY
      }, n)));
    }
    S.state.tasks = S.state.tasks || [];
    for (let i = 0; i < 12; i++) {
      if (S.state.tasks.some((t) => t.id === 'w3-t' + i)) continue;
      const c = now - (i * 9 + 2) * DAY;
      S.state.tasks.push({ id: 'w3-t' + i, title: '示例任务 ' + (i + 1), note: '',
        priority: 'medium', status: i % 3 === 0 ? 'todo' : 'done',
        due: dk(c), tags: [], createdAt: c, updatedAt: c + DAY });
    }
    if (S.persist) S.persist();
    if (L.app && L.app.refresh) L.app.refresh();
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await PW.chromium.launch({
    headless: true, executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: VP });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(500);
  if (SET === 'w3') await seedVisualData(p);

  console.log('截图集合：' + SET + ' · ' + SHOTS.length + ' 张');
  for (const s of SHOTS) {
    await p.emulateMedia({ reducedMotion: s.reducedMotion || 'no-preference' });
    await p.setViewportSize(s.viewport);
    await p.evaluate((cfg) => {
      const app = window.LifeOS && window.LifeOS.app;
      if (!app) return;
      app.applyTheme(cfg.theme);
      if (cfg.motion) app.showView('dashboard'); // 强制重渲染，重播入场动画
      app.showView(cfg.view);
    }, { theme: s.theme, view: s.view, motion: !!s.motion });
    await p.waitForTimeout(s.wait == null ? 420 : s.wait);
    const file = path.join(OUT, PREFIX + '-' + s.name + '.png');
    await p.screenshot({ path: file, fullPage: false });
    console.log('  📷 ' + path.basename(file));
  }

  await browser.close();
  console.log('\n完成 ' + SHOTS.length + ' 张截图 · 页面脚本报错 ' + errs.length + ' 条');
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
})().catch((e) => { console.error('截图失败：', e); process.exit(1); });
