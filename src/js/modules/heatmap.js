/* =========================================================================
 * LifeOS · 全年活动热力图（力扣 / GitHub 贡献图风格）
 * 53 周 × 7 天，按日活跃度分 5 档着色；含连续天数、最长连续、总活跃统计。
 * 数据来源：任务创建/完成/截止、习惯打卡、笔记创建/编辑、AI 对话。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;
  const ST = L.stats;

  function keyOf(d) {
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 10);
  }

  /* 生成周列（周一为首日），覆盖最近 365 天 */
  function buildWeeks() {
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const rangeStart = new Date(end); rangeStart.setDate(rangeStart.getDate() - 364);
    const start = new Date(rangeStart);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // 对齐周一
    const weeks = [];
    let cur = new Date(start);
    while (cur <= end) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cur); d.setDate(d.getDate() + i);
        week.push({ key: keyOf(d), inRange: d >= rangeStart && d <= end, month: d.getMonth() + 1 });
      }
      weeks.push(week);
      cur.setDate(cur.getDate() + 7);
    }
    return weeks;
  }

  function monthLabels(weeks) {
    const out = [];
    let last = -1;
    weeks.forEach((w) => {
      const mid = w[3]; // 用周四判断月份，视觉更稳
      if (mid.inRange && mid.month !== last) { out.push(mid.month + '月'); last = mid.month; }
      else out.push('');
    });
    return out;
  }

  /* 可选：生成演示数据，明确由用户点击触发 */
  function seedDemo() {
    const st = S.state;
    const DAY = 86400000;
    const now = Date.now();
    if (!st.habits.some((h) => h.name === '阅读')) {
      const checkins = {};
      for (let i = 0; i < 300; i++) {
        if (Math.random() < 0.62) checkins[ST.dayKey(now - i * DAY)] = true;
      }
      st.habits.push({ id: U.uid(), name: '阅读', emoji: '▤', color: '#176c6b', createdAt: now - 300 * DAY, checkins });
    }
    if (!st.habits.some((h) => h.name === '运动')) {
      const checkins = {};
      for (let i = 0; i < 300; i++) {
        if (Math.random() < 0.4) checkins[ST.dayKey(now - i * DAY)] = true;
      }
      st.habits.push({ id: U.uid(), name: '运动', emoji: '◆', color: '#34d399', createdAt: now - 300 * DAY, checkins });
    }
    if (st.tasks.length < 12) {
      const names = ['整理周计划', '回复邮件', '代码评审', '写日报', '学习 ArkTS', '复盘项目', '整理笔记', '健身计划'];
      for (let i = 0; i < 16; i++) {
        const c = now - Math.floor(Math.random() * 300) * DAY;
        st.tasks.push({
          id: U.uid(), title: names[i % names.length], note: '', priority: 'medium',
          status: Math.random() < .7 ? 'done' : 'todo', due: ST.dayKey(c),
          tags: [], createdAt: c, updatedAt: c + DAY
        });
      }
    }
    if (st.notes.length < 6) {
      const titles = ['LifeOS 构想', '双向链接设计', '习惯养成笔记', '周复盘', '读书摘录'];
      titles.forEach((t, i) => {
        const c = now - Math.floor(Math.random() * 250) * DAY;
        st.notes.push({ id: U.uid(), title: t, body: '这是一篇示例笔记，可以试试 [[LifeOS 构想]] 这样的双向链接。', tags: [], createdAt: c, updatedAt: c });
      });
    }
    S.persist();
    U.toast('已生成演示数据（示例习惯/任务/笔记）');
    L.app.refresh();
  }

  function render() {
    const map = ST.activity();
    const dates = ST.daysBack(365);
    const sk = ST.streaks(map, dates);
    const activeDays = dates.filter((d) => map[d] && map[d].count).length;
    const total = dates.reduce((s, d) => s + ((map[d] && map[d].count) || 0), 0);
    const weeks = buildWeeks();
    const labels = monthLabels(weeks);
    const dow = ['', '一', '', '三', '', '五', ''];

    const monthRow = labels.map((m) => '<div class="hm-month">' + (m || '') + '</div>').join('');
    const cols = weeks.map((w, wi) => {
      const cells = w.map((c) => {
        if (!c.inRange) return '<div class="hy-cell out"></div>';
        const cnt = map[c.key] ? map[c.key].count : 0;
        const lv = ST.level(cnt);
        const tip = c.key + ' · ' + cnt + ' 次活动';
        const isToday = c.key === U.todayStr();
        return '<div class="hy-cell lv' + lv + (isToday ? ' is-today' : '') + '" data-date="' + c.key + '" title="' + tip + '"></div>';
      }).join('');
      return '<div class="hm-col" data-wi="' + wi + '">' + cells + '</div>';
    }).join('');

    const dowCol = dow.map((d) => '<div class="hm-dow">' + d + '</div>').join('');

    const hasData = total > 0;

    return '' +
      '<div class="page hm-page">' +
      '  <div class="toolbar">' +
      '    <div class="page-sub">全年活动热力图 · 像力扣一样记录每一天的积累 ◆</div>' +
      '    <div class="spacer"></div>' +
      '    <button class="btn ghost" id="hm-seed">载入演示数据</button>' +
      '  </div>' +
      '  <div class="hm-stats">' +
      '    <div class="hs"><div class="hs-num" data-count="' + total + '">' + total + '</div><div class="hs-label">全年活动</div></div>' +
      '    <div class="hs"><div class="hs-num" data-count="' + activeDays + '">' + activeDays + '</div><div class="hs-label">活跃天数</div></div>' +
      '    <div class="hs"><div class="hs-num" data-count="' + sk.current + '">' + sk.current + '</div><div class="hs-label">当前连续</div></div>' +
      '    <div class="hs"><div class="hs-num" data-count="' + sk.longest + '">' + sk.longest + '</div><div class="hs-label">最长连续</div></div>' +
      '  </div>' +
      (hasData ? '' : '<div class="hm-hint">还没有活动记录。开始创建任务、打卡习惯或写笔记，格子就会亮起来；也可以点右上角「载入演示数据」先看效果。</div>') +
      '  <div class="hm-panel">' +
      '    <div class="hm-body">' +
      '      <div class="hm-dow-col">' + dowCol + '</div>' +
      '      <div class="hm-main">' +
      '        <div class="hm-months">' + monthRow + '</div>' +
      '        <div class="hm-cols">' + cols + '</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="hm-foot">' +
      '      <span class="hm-note">点击任意格子可跳转到日历查看当天明细</span>' +
      '      <span class="hm-legend">少 <i class="hy-cell lv0"></i><i class="hy-cell lv1"></i><i class="hy-cell lv2"></i><i class="hy-cell lv3"></i><i class="hy-cell lv4"></i> 多</span>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function bind(root) {
    const seed = root.querySelector('#hm-seed');
    if (seed) seed.addEventListener('click', async () => {
      if (await U.confirm('将写入若干示例习惯、任务与笔记，方便预览热力图效果。现有数据不会被删除。继续吗？')) seedDemo();
    });
    root.querySelectorAll('.hy-cell[data-date]').forEach((c) => {
      c.addEventListener('click', () => {
        if (L.modules.calendar.go) L.modules.calendar.go(c.getAttribute('data-date'));
      });
    });

    /* W3 · 波浪点亮的唯一驱动源：按列写 --hm-wi（CSS 变量继承到每个格子）。
     * 统计数字是权威数据，只做统一淡入，不做数值缓动 / 交错隐藏。 */
    if (U.stagger) U.stagger(root.querySelectorAll('.hm-col'), 13, '--hm-wi', 60);
  }

  L.modules.heatmap = { render, bind };
})(window.LifeOS);
