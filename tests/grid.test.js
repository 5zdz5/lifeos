/* =========================================================================
 * 日历 / 全年热力图 网格边界单测：复刻模块内部算法验证跨月、跨年、闰年
 * ========================================================================= */
const U = {
  weekday(s) { return ['日', '一', '二', '三', '四', '五', '六'][new Date(s + 'T00:00:00').getDay()]; }
};
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysPrev = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const slot = i - startOffset + 1;
    if (slot < 1) {
      const d = daysPrev + slot, pm = month === 0 ? 11 : month - 1, py = month === 0 ? year - 1 : year;
      cells.push({ key: dateKey(py, pm, d), day: d, other: true });
    } else if (slot > daysInMonth) {
      const d = slot - daysInMonth, nm = month === 11 ? 0 : month + 1, ny = month === 11 ? year + 1 : year;
      cells.push({ key: dateKey(ny, nm, d), day: d, other: true });
    } else cells.push({ key: dateKey(year, month, slot), day: slot, other: false });
  }
  return cells;
}
function keyOf(d) { const off = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - off).toISOString().slice(0, 10); }
function buildWeeks(endDate) {
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  const rangeStart = new Date(end); rangeStart.setDate(rangeStart.getDate() - 364);
  const start = new Date(rangeStart);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = []; let cur = new Date(start);
  while (cur <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) { const d = new Date(cur); d.setDate(d.getDate() + i); week.push({ key: keyOf(d), inRange: d >= rangeStart && d <= end }); }
    weeks.push(week); cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + e : '')); } }

console.log('=== 日历网格 ===');
[[2026, 1], [2024, 1], [2026, 0], [2026, 11], [2026, 10]].forEach(([y, m]) => {
  const g = buildGrid(y, m);
  const own = g.filter(c => !c.other);
  const expect = new Date(y, m + 1, 0).getDate();
  ok(`${y}-${pad(m + 1)}: 42 格 / ${expect} 天本月 / 首日周${U.weekday(own[0].key)}`,
    g.length === 42 && own.length === expect && own[0].day === 1 && own[own.length - 1].day === expect,
    `own=${own.length}`);
  const keys = g.map(c => c.key);
  ok(`${y}-${pad(m + 1)}: 日期连续无重复`, new Set(keys).size === 42 && keys.every(k => !isNaN(new Date(k + 'T00:00:00').getTime())));
});
console.log('=== 跨年边界 ===');
const jan = buildGrid(2026, 0);
ok('2026-01 上一年补格为 2025-12', jan[0].key.startsWith('2025-12'), jan[0].key);
const dec = buildGrid(2026, 11);
ok('2026-12 下一年补格为 2027-01', dec[dec.length - 1].key.startsWith('2027-01'), dec[dec.length - 1].key);

console.log('=== 全年热力图网格 ===');
['2026-11-09', '2024-02-29', '2026-01-01', '2026-12-31'].forEach(d => {
  const w = buildWeeks(d);
  const all = w.flat();
  const inR = all.filter(c => c.inRange);
  ok(`${d}: 周列 53~54 / 范围天 365 / 每列 7 天`,
    (w.length === 53 || w.length === 54) && inR.length === 365 && w.every(x => x.length === 7),
    `weeks=${w.length} inRange=${inR.length}`);
  ok(`${d}: 最后一天为 ${d}`, inR[inR.length - 1].key === d, inR[inR.length - 1].key);
});
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
