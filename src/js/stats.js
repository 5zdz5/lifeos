/* =========================================================================
 * LifeOS · 活动统计核心
 * 把任务/习惯/笔记/AI 对话聚合成「按日活跃度」，供日历与全年热力图共用。
 * 纯计算，不改动数据，兼容旧数据缺字段。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  /* 时间戳 -> 本地时区 YYYY-MM-DD */
  function dayKey(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 10);
  }

  function bump(map, date, item) {
    if (!date) return;
    if (!map[date]) map[date] = { count: 0, items: [] };
    map[date].count += 1;
    map[date].items.push(item);
  }

  /* 返回 { 'YYYY-MM-DD': { count, items:[{type,icon,label}] } } */
  function activity() {
    const st = (L.store && L.store.state) || {};
    const map = {};

    (st.tasks || []).forEach((t) => {
      const created = dayKey(t.createdAt);
      bump(map, created, { type: 'task', icon: '✓', label: '创建任务 · ' + (t.title || '无标题') });
      if (t.status === 'done') {
        bump(map, dayKey(t.updatedAt), { type: 'done', icon: '✔', label: '完成任务 · ' + (t.title || '无标题') });
      }
      if (t.due) bump(map, t.due, { type: 'due', icon: '▦', label: '任务截止 · ' + (t.title || '无标题') });
    });

    (st.habits || []).forEach((h) => {
      Object.keys(h.checkins || {}).forEach((d) => {
        if (h.checkins[d]) bump(map, d, { type: 'habit', icon: '◆', label: '打卡 · ' + (h.emoji || '◆') + ' ' + (h.name || '') });
      });
    });

    (st.notes || []).forEach((n) => {
      bump(map, dayKey(n.createdAt), { type: 'note', icon: '✎', label: '新建笔记 · ' + (n.title || '无标题') });
      const u = dayKey(n.updatedAt);
      if (u && u !== dayKey(n.createdAt)) bump(map, u, { type: 'edit', icon: '✎', label: '编辑笔记 · ' + (n.title || '无标题') });
    });

    (st.aiThread || []).forEach((m) => {
      if (m.ts) bump(map, dayKey(m.ts), { type: 'ai', icon: '◇', label: 'AI 对话' });
    });

    // 用户手动添加的日程也算当天活动，日历与热力图同步亮起
    (st.events || []).forEach((e) => {
      if (e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) {
        bump(map, e.date, { type: 'event', icon: '◷', label: '日程 · ' + (e.time ? e.time + ' ' : '') + (e.title || '未命名') });
      }
    });

    return map;
  }

  /* 活跃度分档 0-4（力扣 / GitHub 风格） */
  function level(count) {
    if (!count) return 0;
    if (count <= 1) return 1;
    if (count <= 3) return 2;
    if (count <= 6) return 3;
    return 4;
  }

  /* 近 N 天（含今天）的日期数组，正序 */
  function daysBack(n) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d.getTime());
      x.setDate(x.getDate() - i);
      const off = x.getTimezoneOffset() * 60000;
      out.push(new Date(x.getTime() - off).toISOString().slice(0, 10));
    }
    return out;
  }

  /* 连续天数：current=截至今天的连续，longest=全年最长 */
  function streaks(map, dates) {
    let current = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (map[dates[i]] && map[dates[i]].count) current++;
      else break;
    }
    let longest = 0, run = 0;
    dates.forEach((d) => {
      if (map[d] && map[d].count) { run++; if (run > longest) longest = run; }
      else run = 0;
    });
    return { current: current, longest: longest };
  }

  L.stats = { dayKey: dayKey, activity: activity, level: level, daysBack: daysBack, streaks: streaks };
})(window.LifeOS);
