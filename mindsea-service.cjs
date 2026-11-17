/*
 * LifeOS · 识海桌面服务
 * 数据核心来自 SQHLnb666/mindsea（MIT），上游提交见 vendor/mindsea/UPSTREAM.json。
 * 这里只负责：建库、生命周期、OpenAI 兼容判分适配、离线兜底与 IPC 数据形状。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, at TEXT, speaker INTEGER,
  body TEXT, platform INTEGER, emotion TEXT, importance INTEGER, hits INTEGER DEFAULT 0,
  voiced INTEGER DEFAULT 0, unconfirmed INTEGER DEFAULT 0, origin TEXT, text TEXT,
  occurred TEXT, vector BLOB, digest TEXT, old_id TEXT, event_id INTEGER,
  version_id INTEGER, stage_id INTEGER, s INTEGER, dec INTEGER, emotion_old TEXT,
  place TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, topic TEXT,
  n INTEGER DEFAULT 0, dec_count INTEGER DEFAULT 0, first_at TEXT, last_at TEXT,
  summary TEXT, status TEXT DEFAULT 'live', last_mention TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL,
  n INTEGER DEFAULT 0, UNIQUE(event_id, name)
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, version_id INTEGER,
  name TEXT NOT NULL, n INTEGER DEFAULT 0, UNIQUE(event_id, version_id, name)
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER, event_id INTEGER,
  obj TEXT, text TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS wanders (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, start_tag TEXT, path TEXT NOT NULL,
  spoke INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_at ON memories(at);
CREATE INDEX IF NOT EXISTS idx_memories_speaker ON memories(speaker);
CREATE INDEX IF NOT EXISTS idx_memories_voiced ON memories(voiced);
CREATE INDEX IF NOT EXISTS idx_wanders_at ON wanders(at);`;

const DOC_DEFS = [
  { key: 'soul', title: '人格', file: 'SOUL.md', text: '# 人格\n\n真诚、清晰、重视事实，不假装记得没有记录的事。\n' },
  { key: 'identity', title: '名字与形象', file: 'IDENTITY.md', text: '# 身份\n\n我是 LifeOS，本地优先的个人系统与编程 Agent。\n' },
  { key: 'user', title: '用户', file: 'USER.md', text: '# 用户\n\n在这里记录用户主动提供、希望长期保留的资料。\n' },
  { key: 'memory', title: '长期记忆规矩', file: 'MEMORY.md', text: '# 长期记忆规矩\n\n- 原话不改写\n- 工具与系统注入不进入记忆\n- 不确定时先查识海，不编造\n' },
  { key: 'relationship', title: '协作偏好', file: 'relationship.md', text: '# 协作偏好\n\n在这里记录用户明确要求的沟通与协作方式。\n' }
];

function localTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function classify(line) {
  const text = line.text;
  const code = /代码|编程|项目|文件|修复|报错|测试|源码|Agent|Codex|LifeOS|识海|插件/i.test(text);
  const schedule = /今天|明天|昨天|日程|出差|上班|双休|几点|周[一二三四五六日天]/.test(text);
  const decided = /决定|确定|以后|不要|必须|就用|改为|选择|口径/.test(text);
  const ev = schedule ? '日程' : (/识海|记忆插件|SQLite/i.test(text) ? '识海改造' : (code ? 'LifeOS 编程' : ''));
  const emo = [];
  if (/太好了|谢谢|喜欢|开心|太好了/.test(text)) emo.push('喜');
  if (/担心|害怕|风险/.test(text)) emo.push('惧');
  if (/讨厌|垃圾|糟糕/.test(text)) emo.push('恶');
  return {
    text: line.text.slice(0, 8000), at: line.at, speaker: line.speaker,
    ev, nd: ev === '识海改造' || ev === 'LifeOS 编程' ? '当前实现' : '',
    st: ev === '识海改造' || ev === 'LifeOS 编程' ? '进行中' : '',
    s: decided ? 75 : (code || schedule ? 60 : 40), emo,
    dec: decided ? 1 : 0, decobj: decided ? (ev || '协作口径') : '',
    place: ev ? 'event' : 'chat', category: decided ? '规矩' : (code || schedule ? '干活' : '闲聊')
  };
}

async function createMindSeaService(options) {
  options = options || {};
  const baseDir = options.baseDir;
  const dbPath = options.dbPath || path.join(baseDir, 'sea2.db');
  const logPath = options.logPath || path.join(baseDir, 'capture-log.jsonl');
  const docsDir = path.join(baseDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  process.env.LIFEOS_MINDSEA_LOG = logPath;

  const root = path.join(__dirname, 'vendor', 'mindsea', 'lib');
  const [query, write, capture, tail] = await Promise.all([
    import(pathToFileURL(path.join(root, 'query.mjs')).href),
    import(pathToFileURL(path.join(root, 'write.mjs')).href),
    import(pathToFileURL(path.join(root, 'capture.mjs')).href),
    import(pathToFileURL(path.join(root, 'tail.mjs')).href)
  ]);
  const writer = write.createWriter(dbPath);
  writer.exec('PRAGMA journal_mode = WAL');
  writer.exec(SCHEMA);
  const store = query.createStore(dbPath);

  function table(name) { return store.all(`SELECT * FROM ${name}`); }
  function count(name) { return Number(store.get(`SELECT count(*) AS c FROM ${name}`)?.c || 0); }
  function safeLog(entry) { capture.appendLog(entry); }

  async function localCapture(events, reason) {
    const lines = capture.collectLines(events);
    const items = [];
    for (const line of lines) {
      const dup = writer.get('SELECT id FROM memories WHERE at = ? AND speaker = ? AND text = ? LIMIT 1', line.at, line.speaker, line.text);
      if (!dup) items.push(classify(line));
    }
    const result = items.length ? write.writeMemories(writer, { items }) : { ok: true, written: 0, ids: [], created: { events: [], versions: [], stages: [] }, errors: [] };
    safeLog({ level: result.ok ? 'ok' : 'fail', mode: 'local', reason: reason || '本地规则沉淀', lines: lines.length, chars: capture.totalChars(lines), written: result.written, ids: result.ids, created: result.created });
    return Object.assign({ mode: 'local', lines: lines.length }, result);
  }

  function llmAdapter(settings) {
    const base = String(settings.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      listProviders: () => [{ id: 'openai-compatible' }],
      listModels: async () => [{ id: settings.aiModel || 'gpt-4o-mini' }],
      async *stream(opts) {
        const messages = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        for (const m of opts.messages || []) {
          const content = Array.isArray(m.content) ? m.content.map((b) => b.text || '').join('\n') : m.content;
          messages.push({ role: m.role, content });
        }
        try {
          const resp = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.aiKey },
            body: JSON.stringify({ model: settings.aiModel || 'gpt-4o-mini', messages, temperature: 0.1, max_tokens: opts.maxTokens || 2000 }),
            signal: opts.signal
          });
          if (!resp.ok) throw new Error('AI 接口 ' + resp.status + '：' + (await resp.text()).slice(0, 240));
          const data = await resp.json();
          const text = data.choices?.[0]?.message?.content || '';
          if (!text) throw new Error('判分模型返回空内容');
          yield { type: 'text-delta', text };
          yield { type: 'finish', reason: { kind: 'stop' } };
        } catch (error) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: error.message } } };
        }
      }
    };
  }

  const api = {
    mode: 'electron', dbPath,
    async search(args) {
      args = args || {};
      const r = query.searchMemories(store, args);
      // LifeOS 改造：上游事池查询只给事 / 版本 / 阶段层级，工作台把命中原话一起列出。
      if (r.pool !== 'chat') {
        const q = String(args.q || '').trim();
        const names = (r.events || []).map((e) => e.name);
        let rows = [];
        if (q || names.length) {
          const cond = q ? 'instr(m.text, ?) > 0' : 'e.name IN (' + names.map(() => '?').join(',') + ')';
          const params = q ? [q] : names;
          rows = store.all('SELECT m.id, m.at, m.speaker AS sp, m.s, m.emotion, m.text, m.dec, m.category AS cat, m.place, ' +
            'e.name AS ev, v.name AS nd, g.name AS st FROM memories m ' +
            'LEFT JOIN events e ON e.id=m.event_id LEFT JOIN versions v ON v.id=m.version_id ' +
            'LEFT JOIN stages g ON g.id=m.stage_id WHERE m.event_id IS NOT NULL AND ' + cond +
            ' ORDER BY m.at DESC, m.id DESC LIMIT 20', ...params);
        }
        const eventWords = rows.map((w) => Object.assign(w, { emo: query.emotionNames(w.emotion) }));
        r.words = (r.words || []).concat(eventWords);
        r.eventWordCount = eventWords.length;
      }
      return r;
    },
    async event(args) { return query.readEvent(store, args || {}); },
    async write(args) { return write.writeMemories(writer, args || {}); },
    async update(args) { return write.updateMemory(writer, args || {}); },
    async tail() { return tail.tailText(store); },
    async capture(payload) {
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const events = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim()).map((m, i) => ({
        type: m.role === 'user' ? 'user/message' : 'assistant/message', seq: i + 1, at: localTime(m.ts),
        data: { message: { role: m.role, content: [{ type: 'text', text: String(m.text) }] } }
      }));
      const settings = payload?.settings || {};
      if (!events.length) return { ok: true, written: 0, skipped: 'empty' };
      if (settings.mindseaAI === true && settings.aiKey) {
        try {
          const result = await capture.captureTurn({ llm: llmAdapter(settings), writer, store, agent: null, events, noLog: false });
          if (result.ok) return Object.assign({ mode: 'ai' }, result);
          return await localCapture(events, 'AI 判分失败，已离线兜底：' + (result.errors || []).join('；'));
        } catch (error) {
          return await localCapture(events, 'AI 判分异常，已离线兜底：' + error.message);
        }
      }
      return await localCapture(events, settings.aiKey ? 'AI 判分已关闭' : '未配置 Key，离线沉淀');
    },
    async overview() {
      const words = store.all(`SELECT m.id, m.at, m.speaker AS sp, m.s, m.emotion, m.text, m.place,
        m.dec, m.category AS cat, e.name AS ev, v.name AS nd, g.name AS st
        FROM memories m LEFT JOIN events e ON e.id=m.event_id
        LEFT JOIN versions v ON v.id=m.version_id LEFT JOIN stages g ON g.id=m.stage_id
        ORDER BY m.at DESC, m.id DESC LIMIT 500`).map((w) => Object.assign(w, { emo: query.emotionNames(w.emotion) }));
      let bytes = 0;
      try { bytes = fs.statSync(dbPath).size; } catch (_) { /* noop */ }
      return {
        ok: true, mode: 'electron', dbPath, bytes,
        counts: { memories: count('memories'), events: count('events'), versions: count('versions'), stages: count('stages'), decisions: count('decisions'), wanders: count('wanders') },
        words, events: table('events'), versions: table('versions'), stages: table('stages'), decisions: table('decisions'), wanders: table('wanders'),
        logs: capture.readLogTail(100), capture: capture.readCaptureStatus(store, { enabled: true })
      };
    },
    async docs() {
      return DOC_DEFS.map((d) => {
        const file = path.join(docsDir, d.file);
        let text = d.text;
        try { text = fs.readFileSync(file, 'utf8'); } catch (_) { /* 默认模板 */ }
        return { key: d.key, title: d.title, path: file, text };
      });
    },
    async writeDoc(args) {
      const d = DOC_DEFS.find((x) => x.key === args?.key);
      if (!d) throw new Error('未知人设文档');
      const text = String(args?.text || '');
      if (text.length > 1024 * 1024) throw new Error('单份文档不能超过 1MB');
      fs.writeFileSync(path.join(docsDir, d.file), text, 'utf8');
      return { ok: true, key: d.key };
    },
    async wanderNow() {
      const now = new Date();
      const day = localTime(now).slice(0, 10);
      const parse = (s) => new Date(String(s || '').replace(' ', 'T')).getTime();
      const last = store.get('SELECT at FROM memories ORDER BY at DESC LIMIT 1');
      const lastWander = store.get('SELECT at FROM wanders ORDER BY at DESC LIMIT 1');
      const state = {
        minutesOfDay: now.getHours() * 60 + now.getMinutes(),
        sinceSpeakSec: last ? Math.max(0, Math.floor((now.getTime() - parse(last.at)) / 1000)) : 86400,
        todayCount: Number(store.get('SELECT count(*) AS n FROM memories WHERE substr(at,1,10)=?', day)?.n || 0),
        sinceWanderMin: lastWander ? Math.max(0, Math.floor((now.getTime() - parse(lastWander.at)) / 60000)) : 1440,
        weekday: now.getDay()
      };
      const d = 541;
      const value = ((state.minutesOfDay * 1000003) % d + (state.sinceSpeakSec * 10007) % d + (state.todayCount * 101) % d + (state.sinceWanderMin * 7) % d + state.weekday) % d;
      return { ok: true, state, divisor: d, value, hit: value === 0, remain: value === 0 ? 0 : d - value, note: '保留上游 541 拍算法；这里只在主动打开页面时计算，不伪装后台心跳。' };
    },
    async recordWander(args) {
      const item = { id: crypto.randomUUID(), at: localTime(), start_tag: String(args?.startTag || '手动联想'), path: JSON.stringify(args?.path || []), spoke: 0 };
      writer.run('INSERT INTO wanders (id,at,start_tag,path,spoke) VALUES (?,?,?,?,?)', item.id, item.at, item.start_tag, item.path, item.spoke);
      return { ok: true, item };
    },
    async exportData() {
      return { app: 'LifeOS-MindSea', schema: 1, upstream: 'SQHLnb666/mindsea', exportedAt: new Date().toISOString(), data: {
        memories: table('memories'), events: table('events'), versions: table('versions'), stages: table('stages'), decisions: table('decisions'), wanders: table('wanders')
      } };
    },
    async importData(payload) {
      const rows = payload?.data?.memories;
      if (!Array.isArray(rows)) throw new Error('备份中没有 memories 数组');
      const oldEvents = Array.isArray(payload?.data?.events) ? payload.data.events : [];
      const oldVersions = Array.isArray(payload?.data?.versions) ? payload.data.versions : [];
      const oldStages = Array.isArray(payload?.data?.stages) ? payload.data.stages : [];
      const items = rows.slice(0, 10000).map((m) => ({
        text: m.text, at: m.at, speaker: m.speaker,
        ev: oldEvents.find((e) => e.id === m.event_id)?.name || '',
        nd: oldVersions.find((v) => v.id === m.version_id)?.name || '',
        st: oldStages.find((s) => s.id === m.stage_id)?.name || '',
        s: m.s, emo: query.emotionNames(m.emotion), dec: m.dec ? 1 : 0,
        decobj: m.dec ? '导入决定' : '', place: m.place || '', category: m.category || ''
      }));
      return write.writeMemories(writer, { items });
    },
    async close() { store.close(); writer.close(); }
  };
  return api;
}

module.exports = { createMindSeaService, SCHEMA, DOC_DEFS, classify, localTime };
