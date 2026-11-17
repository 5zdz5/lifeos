/* =========================================================================
 * LifeOS · 识海浏览器适配层
 * 数据结构与三轴查询移植自 SQHLnb666/mindsea（MIT）。
 * 浏览器没有 node:sqlite，因此明确使用 localStorage；桌面端使用上游 SQLite。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;
  const KEY = 'lifeos-mindsea-v1';
  const EMOS = ['喜', '怒', '哀', '惧', '爱', '恶', '欲'];
  const CATS = ['闲聊', '暧昧', '干活', '知识', '规矩'];
  const DOCS = [
    { key: 'soul', title: '人格', text: '# 人格\n\n真诚、清晰、重视事实，不假装记得没有记录的事。\n' },
    { key: 'identity', title: '名字与形象', text: '# 身份\n\n我是 LifeOS，本地优先的个人系统与编程 Agent。\n' },
    { key: 'user', title: '用户', text: '# 用户\n\n在这里记录用户主动提供、希望长期保留的资料。\n' },
    { key: 'memory', title: '长期记忆规矩', text: '# 长期记忆规矩\n\n- 原话不改写\n- 工具与系统注入不进入记忆\n- 不确定时先查识海，不编造\n' },
    { key: 'relationship', title: '协作偏好', text: '# 协作偏好\n\n在这里记录用户明确要求的沟通与协作方式。\n' }
  ];

  function blank() { return { schema: 1, memories: [], events: [], versions: [], stages: [], decisions: [], wanders: [], logs: [], docs: {} }; }
  function load() {
    try {
      const s = JSON.parse(DB.getItem(KEY) || 'null');
      if (s && Array.isArray(s.memories)) return Object.assign(blank(), s);
    } catch (_) { /* 损坏时使用空库 */ }
    return blank();
  }
  let db = load();
  function save() {
    try { DB.setItem(KEY, JSON.stringify(db)); }
    catch (e) { throw new Error('识海浏览器存储写入失败：空间可能不足。请先在「运行状态」导出备份。' + (e.message || '')); }
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function localTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function nextId(rows) { return rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1; }
  function bitmap(emos) { return EMOS.map((_, i) => (emos || []).includes(EMOS[i]) ? '1' : '0').reverse().join(''); }
  function emoNames(bits) { return EMOS.filter((_, i) => String(bits || '')[6 - i] === '1'); }
  function log(entry) { db.logs.push(Object.assign({ at: localTime() }, entry)); if (db.logs.length > 200) db.logs = db.logs.slice(-200); }
  function stripNoise(text) {
    return String(text || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<available_skills>[\s\S]*?<\/available_skills>/gi, '')
      .split('\n').filter((l) => !/^\s*(Current runtime context|Runtime context|环境快照|系统提示)/i.test(l)).join('\n').trim();
  }
  function wordView(m) {
    const ev = db.events.find((e) => e.id === m.event_id);
    const nd = db.versions.find((v) => v.id === m.version_id);
    const st = db.stages.find((s) => s.id === m.stage_id);
    return { id: m.id, at: m.at, sp: m.speaker, s: m.s, emo: emoNames(m.emotion), text: m.text, place: m.place, dec: m.dec || 0, cat: m.category || '', ev: ev?.name || '', nd: nd?.name || '', st: st?.name || '' };
  }
  function normalizeItem(raw, i) {
    if (!raw || typeof raw !== 'object') throw new Error('items[' + i + '] 不是对象');
    const text = String(raw.text || '').trim();
    if (!text) throw new Error('items[' + i + '].text 原话不能为空');
    if (text.length > 8000) throw new Error('items[' + i + '].text 超过 8000 字');
    const speaker = Number(raw.speaker);
    if (speaker !== 0 && speaker !== 1) throw new Error('items[' + i + '].speaker 只能是 0 或 1');
    const at = String(raw.at || localTime()).replace('T', ' ');
    if (!/^\d{4}-\d{1,2}-\d{1,2}/.test(at)) throw new Error('items[' + i + '].at 时间格式不正确');
    const s = raw.s == null || raw.s === '' ? 50 : Number(raw.s);
    if (!Number.isInteger(s) || s < 0 || s > 100) throw new Error('items[' + i + '].s 必须是 0~100 整数');
    const ev = String(raw.ev || '').trim(), nd = String(raw.nd || '').trim(), st = String(raw.st || '').trim();
    if (nd && !ev) throw new Error('版本必须挂在事下');
    if (st && !nd) throw new Error('阶段必须挂在版本下');
    const emo = Array.isArray(raw.emo) ? raw.emo.filter((x) => EMOS.includes(x)) : String(raw.emo || '').split('').filter((x) => EMOS.includes(x));
    const dec = Number(raw.dec) === 1 ? 1 : 0;
    const decobj = String(raw.decobj || '').trim();
    if (dec && !decobj) throw new Error('决定必须填写 decobj');
    const category = CATS.includes(raw.category) ? raw.category : '';
    const place = ['event', 'chat', 'trash'].includes(raw.place) ? raw.place : (ev ? 'event' : 'chat');
    return { text, at, speaker, ev, nd, st, s, emo: [...new Set(emo)], dec, decobj, category, place };
  }
  function writeMemories(args) {
    const raw = Array.isArray(args?.items) ? args.items : [];
    if (!raw.length) return { ok: false, written: 0, ids: [], created: { events: [], versions: [], stages: [] }, errors: ['items 为空'] };
    const items = [];
    try { raw.forEach((x, i) => items.push(normalizeItem(x, i))); }
    catch (e) { return { ok: false, written: 0, ids: [], created: { events: [], versions: [], stages: [] }, errors: [e.message + '；整批未写入'] }; }
    const ids = [], skipped = [], errors = [], created = { events: [], versions: [], stages: [] };
    const touched = new Set();
    for (const item of items) {
      try {
        const dup = db.memories.find((m) => m.text === item.text && m.at.slice(0, 10) === item.at.slice(0, 10));
        if (dup) { skipped.push({ id: dup.id, text: item.text.slice(0, 24) }); continue; }
        let event = null, version = null, stage = null;
        if (item.ev) {
          event = db.events.find((e) => e.name === item.ev);
          if (!event) {
            event = { id: nextId(db.events), name: item.ev, topic: '', n: 0, dec_count: 0, first_at: item.at, last_at: item.at, summary: '', status: 'live', category: item.category };
            db.events.push(event); created.events.push(event.name);
          }
          if (item.nd) {
            version = db.versions.find((v) => v.event_id === event.id && v.name === item.nd);
            if (!version) { version = { id: nextId(db.versions), event_id: event.id, name: item.nd, n: 0 }; db.versions.push(version); created.versions.push(version.name); }
            if (item.st) {
              stage = db.stages.find((s) => s.version_id === version.id && s.name === item.st);
              if (!stage) { stage = { id: nextId(db.stages), event_id: event.id, version_id: version.id, name: item.st, n: 0 }; db.stages.push(stage); created.stages.push(stage.name); }
            }
          }
        }
        const m = { id: nextId(db.memories), at: item.at, speaker: item.speaker, text: item.text, emotion: bitmap(item.emo), s: item.s, dec: item.dec, event_id: event?.id || null, version_id: version?.id || null, stage_id: stage?.id || null, place: item.place, category: item.category };
        db.memories.push(m); ids.push(m.id);
        if (event) touched.add(event.id);
        if (item.dec) db.decisions.push({ id: nextId(db.decisions), memory_id: m.id, event_id: event?.id || null, obj: item.decobj, text: item.text, at: item.at });
      } catch (e) { errors.push(e.message); }
    }
    for (const id of touched) {
      const ev = db.events.find((e) => e.id === id);
      const ms = db.memories.filter((m) => m.event_id === id);
      ev.n = ms.length; ev.dec_count = ms.filter((m) => m.dec).length;
      ev.first_at = ms.map((m) => m.at).sort()[0] || ev.first_at; ev.last_at = ms.map((m) => m.at).sort().slice(-1)[0] || ev.last_at;
    }
    db.versions.forEach((v) => { v.n = db.memories.filter((m) => m.version_id === v.id).length; });
    db.stages.forEach((s) => { s.n = db.memories.filter((m) => m.stage_id === s.id).length; });
    save();
    return { ok: !errors.length, written: ids.length, ids, skipped, created, errors };
  }
  function matches(m, args, event) {
    const q = String(args.q || '').trim(), day = String(args.day || '').trim();
    if (q && !m.text.includes(q) && !(event && event.name.includes(q))) return false;
    if (day && !m.at.startsWith(day)) return false;
    const wanted = String(args.emo || '').split('').filter((x) => EMOS.includes(x));
    if (wanted.length && !wanted.some((x) => emoNames(m.emotion).includes(x))) return false;
    return true;
  }
  function searchMemories(args) {
    args = args || {};
    if (!args.q && !args.day && !args.emo) throw new Error('q / day / emo 至少给一个');
    const pool = args.pool || 'event';
    if (!['event', 'chat', 'all'].includes(pool)) throw new Error('pool 只能是 event/chat/all');
    const limit = Math.max(1, Math.min(pool === 'chat' ? 100 : 20, Number(args.limit) || (pool === 'chat' ? 30 : 6)));
    const axes = [args.q ? '词「' + args.q + '」' : '', args.day ? '时间「' + args.day + '」' : '', args.emo ? '情绪「' + args.emo + '」' : ''].filter(Boolean).join(' + ');
    const chats = pool !== 'event' ? db.memories.filter((m) => !m.event_id && matches(m, args)).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id) : [];
    const words = chats.slice(0, limit).map((m) => ({ id: m.id, at: m.at, speaker: m.speaker, s: m.s, emo: emoNames(m.emotion), text: m.text }));
    if (pool === 'chat') return { ok: true, pool, axes, hitCount: chats.length, words, note: chats.length ? '' : '闲聊池没有命中' };
    const hits = db.memories.filter((m) => m.event_id && matches(m, args, db.events.find((e) => e.id === m.event_id)));
    const groups = db.events.map((ev) => {
      const ms = hits.filter((m) => m.event_id === ev.id);
      if (!ms.length) return null;
      const versions = db.versions.filter((v) => v.event_id === ev.id).map((v) => ({ name: v.name, hits: ms.filter((m) => m.version_id === v.id).length, stages: db.stages.filter((s) => s.version_id === v.id).sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.name) })).filter((v) => v.hits).sort((a, b) => b.hits - a.hits).slice(0, 4);
      return { name: ev.name, topic: ev.topic || '', hits: ms.length, decisions: ms.filter((m) => m.dec).length, totalInEvent: ev.n, firstAt: ev.first_at, lastAt: ms.map((m) => m.at).sort().slice(-1)[0], versions, recentDecisions: db.decisions.filter((d) => d.event_id === ev.id).slice(-3) };
    }).filter(Boolean).sort((a, b) => b.hits - a.hits).slice(0, limit);
    // LifeOS 改造：上游事池只返回事 / 版本 / 阶段分组，工作台需要把命中的原话
    // 一并列出来，否则「命中 1 条」却看不到那条原话。原话仍逐字保留。
    const eventWords = hits.slice(0, limit).map((m) => ({
      id: m.id, at: m.at, speaker: m.speaker, s: m.s, emo: emoNames(m.emotion), text: m.text,
      dec: m.dec ? 1 : 0, category: m.category || '', place: m.place || 'event',
      ev: (db.events.find((e) => e.id === m.event_id) || {}).name || '',
      nd: (db.versions.find((v) => v.id === m.version_id) || {}).name || '',
      st: (db.stages.find((s) => s.id === m.stage_id) || {}).name || ''
    }));
    const out = { ok: true, axes, hitCount: hits.length, eventCount: new Set(hits.map((m) => m.event_id)).size, events: groups, words: eventWords, note: groups.length ? '' : '没有命中；可换词或用 pool:"all" 查闲聊池' };
    if (pool === 'all') Object.assign(out, { pool, chatHitCount: chats.length, words: words.concat(eventWords) });
    return out;
  }
  function readEvent(args) {
    const name = String(args?.name || '').trim();
    let ev = db.events.find((e) => e.name === name);
    const fuzzy = db.events.filter((e) => e.name.includes(name));
    if (!ev && fuzzy.length === 1) ev = fuzzy[0];
    if (!ev) return { ok: false, name, candidates: fuzzy.map((e) => e.name), versions: [], decisionsList: [], note: '识海里没有这件事' };
    return { ok: true, name: ev.name, topic: ev.topic || '', hits: ev.n, decisions: ev.dec_count, firstAt: ev.first_at, lastAt: ev.last_at,
      versions: db.versions.filter((v) => v.event_id === ev.id).map((v) => ({ name: v.name, hits: v.n, stages: db.stages.filter((s) => s.version_id === v.id).map((s) => ({ name: s.name, hits: s.n })) })),
      decisionsList: db.decisions.filter((d) => d.event_id === ev.id).map((d) => ({ at: d.at, obj: d.obj, text: d.text, memoryId: d.memory_id })), candidates: [], note: '' };
  }
  function classify(line) {
    const text = line.text;
    const code = /代码|编程|项目|文件|修复|报错|测试|源码|Agent|Codex|LifeOS|识海|插件/i.test(text);
    const schedule = /今天|明天|昨天|日程|出差|上班|双休|几点|周[一二三四五六日天]/.test(text);
    const decided = /决定|确定|以后|不要|必须|就用|改为|选择|口径/.test(text);
    const ev = schedule ? '日程' : (/识海|记忆插件|SQLite/i.test(text) ? '识海改造' : (code ? 'LifeOS 编程' : ''));
    return { text: text.slice(0, 8000), at: line.at, speaker: line.speaker, ev, nd: ev === '识海改造' || ev === 'LifeOS 编程' ? '当前实现' : '', st: ev ? '进行中' : '', s: decided ? 75 : (code || schedule ? 60 : 40), emo: [], dec: decided ? 1 : 0, decobj: decided ? (ev || '协作口径') : '', place: ev ? 'event' : 'chat', category: decided ? '规矩' : (code || schedule ? '干活' : '闲聊') };
  }
  async function captureTurn(payload) {
    const msgs = (payload?.messages || []).filter((m) => ['user', 'assistant'].includes(m.role) && stripNoise(m.text));
    const lines = msgs.slice(-40).map((m, i) => ({ i: i + 1, speaker: m.role === 'user' ? 0 : 1, at: localTime(m.ts), text: stripNoise(m.text).slice(0, 8000) }));
    if (!lines.length) return { ok: true, written: 0, skipped: 'empty' };
    const settings = payload?.settings || {};
    let judged = null, mode = 'local', reason = settings.aiKey ? 'AI 判分已关闭' : '未配置 Key，离线沉淀';
    if (settings.mindseaAI === true && settings.aiKey && lines.reduce((n, x) => n + x.text.length, 0) >= 60) {
      try {
        const candidates = db.events.slice(0, 40).map((e) => e.name).join(' / ') || '（暂无）';
        const prompt = '你是识海沉淀器。原话已保存，只输出编号和判断的纯 JSON：{"keep":[{"i":1,"ev":"事名","nd":"版本","st":"阶段","s":60,"emo":[],"dec":0,"decobj":"","cat":"干活"}],"drop":[],"trash":[]}。事名优先复用：' + candidates + '。cat 只能是闲聊/暧昧/干活/知识/规矩；不确定 ev 留空；dec=1 必须有 decobj。每条编号都要处理。\n' + lines.map((l) => '[' + l.i + '] ' + (l.speaker ? '助手' : '用户') + '：' + l.text.slice(0, 1200)).join('\n');
        const raw = await L.capture.callAI([{ role: 'user', content: prompt }], settings);
        judged = L.capture.parseAIJson(raw); mode = 'ai'; reason = 'AI 判分';
      } catch (e) { reason = 'AI 判分失败，离线兜底：' + e.message; }
    }
    const items = [];
    for (const line of lines) {
      const dup = db.memories.find((m) => m.at === line.at && m.speaker === line.speaker && m.text === line.text);
      if (dup) continue;
      const j = judged?.keep?.find((x) => Number(x.i) === line.i);
      if (judged && judged.drop?.includes(line.i)) continue;
      const item = j ? { text: line.text, at: line.at, speaker: line.speaker, ev: j.ev || '', nd: j.nd || '', st: j.st || '', s: Math.max(0, Math.min(100, Math.round(Number(j.s) || 50))), emo: j.emo || [], dec: Number(j.dec) === 1 && j.decobj ? 1 : 0, decobj: j.decobj || '', category: CATS.includes(j.cat) ? j.cat : '', place: judged.trash?.includes(line.i) ? 'trash' : '' } : classify(line);
      items.push(item);
    }
    const result = items.length ? writeMemories({ items }) : { ok: true, written: 0, ids: [], created: { events: [], versions: [], stages: [] }, errors: [] };
    log({ level: result.ok ? 'ok' : 'fail', mode, reason, lines: lines.length, written: result.written, created: result.created }); save();
    return Object.assign({ mode, lines: lines.length }, result);
  }
  function overview() {
    const words = db.memories.slice().sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, 500).map(wordView);
    const today = localTime().slice(0, 10);
    const todayLogs = db.logs.filter((x) => x.at.startsWith(today));
    return { ok: true, mode: 'browser', dbPath: '浏览器 localStorage · ' + KEY, bytes: JSON.stringify(db).length,
      counts: { memories: db.memories.length, events: db.events.length, versions: db.versions.length, stages: db.stages.length, decisions: db.decisions.length, wanders: db.wanders.length },
      words, events: clone(db.events), versions: clone(db.versions), stages: clone(db.stages), decisions: clone(db.decisions), wanders: clone(db.wanders), logs: clone(db.logs.slice().reverse()),
      capture: { enabled: true, stat: { wrote: todayLogs.reduce((n, x) => n + (x.written || 0), 0), runs: todayLogs.filter((x) => x.level === 'ok').length, failed: todayLogs.filter((x) => x.level === 'fail').length }, library: { total: db.memories.length, today: db.memories.filter((m) => m.at.startsWith(today)).length } } };
  }
  async function wanderNow() {
    const now = new Date(), day = localTime().slice(0, 10), last = db.memories.slice().sort((a, b) => b.at.localeCompare(a.at))[0], lastW = db.wanders.slice().sort((a, b) => b.at.localeCompare(a.at))[0];
    const parse = (s) => new Date(String(s || '').replace(' ', 'T')).getTime();
    const state = { minutesOfDay: now.getHours() * 60 + now.getMinutes(), sinceSpeakSec: last ? Math.max(0, Math.floor((now - parse(last.at)) / 1000)) : 86400, todayCount: db.memories.filter((m) => m.at.startsWith(day)).length, sinceWanderMin: lastW ? Math.max(0, Math.floor((now - parse(lastW.at)) / 60000)) : 1440, weekday: now.getDay() };
    const value = ((state.minutesOfDay * 1000003) % 541 + (state.sinceSpeakSec * 10007) % 541 + (state.todayCount * 101) % 541 + (state.sinceWanderMin * 7) % 541 + state.weekday) % 541;
    return { ok: true, state, divisor: 541, value, hit: value === 0, remain: value ? 541 - value : 0, note: '保留上游 541 拍算法；主动打开时计算，不伪装后台心跳。' };
  }
  L.mindsea = {
    search: async (args) => searchMemories(args), event: async (args) => readEvent(args), write: async (args) => writeMemories(args),
    update: async (args) => { const m = db.memories.find((x) => x.id === Number(args?.id)); if (!m) return { ok: false, error: '记忆不存在' }; if (args.category !== undefined) { if (args.category && !CATS.includes(args.category)) return { ok: false, error: '门类不正确' }; m.category = args.category || ''; } if (args.place !== undefined) { if (!['event', 'chat', 'trash'].includes(args.place)) return { ok: false, error: '去处不正确' }; m.place = args.place; } save(); return { ok: true, id: m.id }; },
    tail: async () => db.memories.slice().sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, 10).reverse().map((m) => '· ' + m.at.slice(5, 16) + ' ' + (m.speaker ? '我' : '用户') + '：' + m.text.replace(/\s+/g, ' ').slice(0, 120)).join('\n'),
    capture: captureTurn, overview: async () => overview(),
    docs: async () => DOCS.map((d) => ({ key: d.key, title: d.title, path: KEY + '#docs.' + d.key, text: db.docs[d.key] || d.text })),
    writeDoc: async (args) => { if (!DOCS.some((d) => d.key === args?.key)) throw new Error('未知文档'); db.docs[args.key] = String(args.text || '').slice(0, 1024 * 1024); save(); return { ok: true }; },
    wanderNow,
    recordWander: async (args) => { const item = { id: Date.now().toString(36), at: localTime(), start_tag: args?.startTag || '手动联想', path: JSON.stringify(args?.path || []), spoke: 0 }; db.wanders.push(item); save(); return { ok: true, item }; },
    exportData: async () => ({ app: 'LifeOS-MindSea', schema: 1, exportedAt: new Date().toISOString(), data: clone({ memories: db.memories, events: db.events, versions: db.versions, stages: db.stages, decisions: db.decisions, wanders: db.wanders }) }),
    importData: async (payload) => { if (!Array.isArray(payload?.data?.memories)) throw new Error('备份中没有 memories'); const es = payload.data.events || [], vs = payload.data.versions || [], ss = payload.data.stages || []; return writeMemories({ items: payload.data.memories.map((m) => ({ text: m.text, at: m.at, speaker: m.speaker, ev: es.find((e) => e.id === m.event_id)?.name || '', nd: vs.find((v) => v.id === m.version_id)?.name || '', st: ss.find((s) => s.id === m.stage_id)?.name || '', s: m.s, emo: emoNames(m.emotion), dec: m.dec, decobj: m.dec ? '导入决定' : '', place: m.place, category: m.category })) }); },
    _resetForTest: () => { db = blank(); save(); }
  };
})(window.LifeOS);
