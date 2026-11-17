/* =========================================================================
 * LifeOS · 联网采集引擎
 *
 * 定位：本地优先 App 里「唯一会联网」的部分。三条真能跑的通道：
 *   1) AI 主题采集 —— 调用用户已配置的 OpenAI 兼容接口，把主题整理成结构化知识卡片
 *   2) URL / 公开源采集 —— 真实 fetch 允许跨域的公开接口；被 CORS 拒绝时明确报错，
 *      不假装「什么网页都能爬」
 *   3) 粘贴正文 —— 从任意 App 复制内容进来，本地确定性整理，断网也能用
 *
 * 所有产物都是纯数据对象，交由 store.addLibraryItem 落到本机，不做任何云端存储。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';

  /* 允许跨域、无需密钥的公开源。用户可换成自己的接口（如自建爬虫端点、RSS 代理）。
   * 这里只登记实测可直连的源，不堆一堆连不上的地址装样子。 */
  const PUBLIC_SOURCES = [
    { id: 'hitokoto-k', label: '一言 · 文学', url: 'https://v1.hitokoto.cn/?c=k&encode=json' },
    { id: 'hitokoto-d', label: '一言 · 生活', url: 'https://v1.hitokoto.cn/?c=d&encode=json' },
    { id: 'hitokoto-i', label: '一言 · 诗词', url: 'https://v1.hitokoto.cn/?c=i&encode=json' }
  ];

  /* ---------- 文本清洗 ---------- */
  function stripMarkup(s) {
    return String(s == null ? '' : s)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (m, a, b) { return b || a; })
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_>`#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(s, n) { return String(s == null ? '' : s).slice(0, n); }

  /* ---------- 网络请求（失败原因要说人话） ---------- */
  async function fetchText(url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    let resp;
    try {
      // 不加自定义 header，避免触发 CORS 预检被简单接口拒绝
      resp = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    } catch (e) {
      if (timer) clearTimeout(timer);
      const why = (e && e.name === 'AbortError') ? '请求超时（15 秒）' : (e && e.message ? e.message : String(e));
      throw new Error('抓不到这个地址：' + why +
        '。常见原因是目标站点未开放跨域(CORS)，浏览器不允许直接读取。请改用「粘贴正文」，或把采集源换成允许跨域的接口。');
    }
    if (timer) clearTimeout(timer);
    if (!resp.ok) throw new Error('抓取失败：HTTP ' + resp.status);
    return await resp.text();
  }

  /* 独立于 AI 助手对话通道：助手用流式回调，这里用一次性非流式请求，
   * 避免覆盖 bridge 的全局 AI 回调导致互相串扰。 */
  async function callAI(messages, settings) {
    if (!settings || !settings.aiKey) {
      throw new Error('未配置 API Key：请在「设置」填入 OpenAI 兼容接口的 Key 后使用 AI 采集；不填 Key 也能用「粘贴正文」走本地整理。');
    }
    const base = (settings.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 45000) : null;
    let resp;
    try {
      resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.aiKey },
        body: JSON.stringify({
          model: settings.aiModel || 'gpt-4o-mini',
          messages: messages, stream: false, temperature: 0.4
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      const why = (e && e.name === 'AbortError') ? '请求超时（45 秒）' : (e && e.message ? e.message : String(e));
      throw new Error('AI 接口不可达：' + why + '。请检查 Base URL、Key 与网络，或暂时改用「粘贴正文」。');
    }
    if (timer) clearTimeout(timer);
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('AI 接口错误 ' + resp.status + ' ' + truncate(t, 120));
    }
    const j = await resp.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!txt) throw new Error('AI 未返回内容');
    return txt;
  }

  /* 容错解析：剥掉 ```json 围栏、前后解释文字，支持单对象或数组 */
  function parseAIJson(text) {
    let s = String(text == null ? '' : text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = s.search(/[\[{]/);
    if (start < 0) throw new Error('AI 返回内容里找不到 JSON');
    s = s.slice(start);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (end >= 0) s = s.slice(0, end + 1);
    try { return JSON.parse(s); }
    catch (e) { throw new Error('AI 返回内容无法解析为 JSON：' + (e && e.message ? e.message : e)); }
  }

  const AI_ORGANIZE_PROMPT =
    '你是知识整理助手。把用户给出的内容整理成 1 条结构化知识卡片，提炼核心信息与可执行要点。' +
    '只输出严格 JSON，不要 Markdown 代码块、不要任何解释文字：' +
    '{"title":"简短标题","summary":"不超过120字的摘要","points":["要点1","要点2","要点3"],"tags":["标签1","标签2"]}';

  const AI_TOPIC_PROMPT =
    '你是知识采集助手。用户给出一个主题，请结合你掌握的公开知识，整理成 1 条结构化知识卡片。' +
    '要求内容具体、可执行，包含明确数字、步骤或判据，避免「要努力」「要做好规划」这类空泛套话。' +
    '只输出严格 JSON，不要 Markdown 代码块、不要任何解释文字：' +
    '{"title":"简短标题","summary":"不超过120字的摘要","points":["要点1","要点2","要点3"],"tags":["标签1","标签2"]}';

  /* 把模型/本地抽取的结果规范成统一的条数据结构 */
  function toItem(o, meta) {
    meta = meta || {};
    return {
      title: truncate(String((o && o.title) || meta.title || '未命名条目').trim(), 80) || '未命名条目',
      summary: truncate(String((o && o.summary) || '').trim(), 300),
      points: (o && Array.isArray(o.points) ? o.points : []).map((x) => truncate(String(x).trim(), 200)).filter(Boolean).slice(0, 8),
      tags: (o && Array.isArray(o.tags) ? o.tags : []).map((x) => truncate(String(x).trim(), 20)).filter(Boolean).slice(0, 8),
      source: Object.assign({ type: 'manual', label: '手动添加', url: '', fetchedAt: Date.now() }, meta.source || {}),
      raw: truncate(meta.raw || '', 6000)
    };
  }

  /* 不依赖 AI 的确定性整理：真的从文本里抽标题、摘要、要点、标签，不是塞假数据 */
  function localOrganize(rawText, meta) {
    meta = meta || {};
    const src = String(rawText == null ? '' : rawText).trim();
    const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);

    let title = truncate(String(meta.title || '').trim(), 60);
    if (!title) {
      const head = lines.find((l) => /^#{1,3}\s+/.test(l));
      title = head ? head.replace(/^#{1,3}\s+/, '') : (lines[0] || '');
    }
    title = truncate(cleanText(title).replace(/[\[\]]/g, ''), 60) || '未命名条目';

    let points = lines
      .filter((l) => /^(?:[-*•]|\d+[.、)])\s+/.test(l))
      .map((l) => l.replace(/^(?:[-*•]|\d+[.、)])\s+/, '').replace(/[*_`]/g, '').trim())
      .filter(Boolean);
    if (!points.length) {
      const sentences = cleanText(src).match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
      points = sentences.map((s) => s.trim()).filter((s) => s.length >= 10);
    }
    points = points.slice(0, 6);

    const flat = cleanText(src);
    const summary = truncate((points.length ? points.slice(0, 2).join(' ') : flat) || title, 140);

    let tags = (meta.tags || []).slice();
    if (!tags.length) {
      const m = src.match(/#[^\s#,，]{1,12}/g) || [];
      tags = m.map((x) => x.slice(1)).slice(0, 5);
    }

    return {
      title: title,
      summary: summary,
      points: points,
      tags: tags,
      source: Object.assign({ type: 'paste', label: '本地整理', url: '', fetchedAt: Date.now() }, meta.source || {}),
      raw: truncate(src, 6000)
    };
  }

  /* 整理：配了 Key 且勾选 AI 就用模型，否则本地抽取 */
  async function organize(rawText, opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    if (opts.useAI && opts.settings && opts.settings.aiKey) {
      const text = await callAI([
        { role: 'system', content: AI_ORGANIZE_PROMPT },
        { role: 'user', content: '请整理以下内容：\n\n' + truncate(rawText, 6000) }
      ], opts.settings);
      const obj = parseAIJson(text);
      const arr = Array.isArray(obj) ? obj : [obj];
      return arr.map((o) => toItem(o, meta));
    }
    return [localOrganize(rawText, meta)];
  }

  /* ---------- 通道 1：AI 主题采集 ---------- */
  async function collectTopic(topic, settings) {
    const t = String(topic || '').trim();
    if (!t) throw new Error('请输入要采集的主题');
    if (!settings || !settings.aiKey) {
      throw new Error('AI 主题采集需要 API Key（在「设置」里填）。没配 Key 时请用「粘贴正文」通道：同样能把外部内容整理进知识库，且不联网。');
    }
    const text = await callAI([
      { role: 'system', content: AI_TOPIC_PROMPT },
      { role: 'user', content: '主题：' + t }
    ], settings);
    const obj = parseAIJson(text);
    const arr = Array.isArray(obj) ? obj : [obj];
    return arr.map((o) => toItem(o, {
      source: { type: 'ai', label: 'AI 采集 · ' + truncate(t, 20), url: '', fetchedAt: Date.now() },
      raw: ''
    }));
  }

  /* ---------- 通道 2：URL 采集 ---------- */
  async function collectUrl(url, settings, opts) {
    opts = opts || {};
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) throw new Error('请填写以 http:// 或 https:// 开头的完整网址');
    const raw = await fetchText(u);
    let text = raw;
    let title = '';

    // 公开 JSON 接口：直接取结构化字段，无需 AI
    try {
      const j = JSON.parse(raw);
      if (j && j.hitokoto) {
        const t = '摘录 · ' + (j.from_who || j.from || '公开接口');
        return [toItem({ title: t, summary: String(j.hitokoto).slice(0, 140), points: [], tags: ['外部摘录'] }, {
          source: { type: 'url', label: '外部采集 · ' + (j.from || '公开接口'), url: u, fetchedAt: Date.now() },
          raw: String(j.hitokoto)
        })];
      }
      text = JSON.stringify(j, null, 1).slice(0, 6000);
    } catch (e) { /* 不是 JSON，按 HTML 处理 */ }

    if (/<[a-z][\s\S]*>/i.test(raw)) {
      text = stripMarkup(raw);
      const m = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) title = truncate(stripMarkup(m[1]), 60);
    }
    if (!text.trim()) throw new Error('抓取到的内容为空');

    return await organize(text, {
      useAI: !!opts.useAI, settings: settings,
      meta: {
        title: title,
        source: { type: 'url', label: opts.useAI ? '外部采集 · AI 整理' : '外部采集 · 本地整理', url: u, fetchedAt: Date.now() },
        raw: truncate(text, 6000)
      }
    });
  }

  /* ---------- 通道 3：粘贴正文 ---------- */
  async function collectText(text, title, settings, opts) {
    opts = opts || {};
    const src = String(text || '').trim();
    if (!src) throw new Error('请先粘贴要整理的内容');
    const useAI = !!opts.useAI && !!(settings && settings.aiKey);
    return await organize(src, {
      useAI: useAI, settings: settings,
      meta: {
        title: truncate(String(title || '').trim(), 60),
        source: { type: 'paste', label: useAI ? '粘贴 · AI 整理' : '粘贴 · 本地整理', url: '', fetchedAt: Date.now() },
        raw: truncate(src, 6000)
      }
    });
  }

  /* ---------- 联网刷新：批量拉已登记公开源，按来源去重 ---------- */
  async function refreshSources() {
    const added = [], skipped = [], errors = [];
    for (const src of PUBLIC_SOURCES) {
      try {
        const raw = await fetchText(src.url);
        const j = JSON.parse(raw);
        if (!j || !j.hitokoto) { errors.push(src.label + '：返回格式不是预期的一言 JSON'); continue; }
        const key = src.url + '#id=' + (j.id || j.uuid || String(j.hitokoto).slice(0, 10));
        if (L.store && L.store.hasLibrarySource(key)) { skipped.push(src.label); continue; }
        added.push({
          title: '摘录 · ' + (j.from_who || j.from || src.label),
          summary: truncate(j.hitokoto, 140),
          points: [],
          tags: ['外部摘录', String(src.label).replace('一言 · ', '')],
          source: { type: 'public', label: '联网刷新 · ' + src.label, url: key, fetchedAt: Date.now() },
          raw: String(j.hitokoto)
        });
      } catch (e) {
        errors.push(src.label + '：' + (e && e.message ? e.message : String(e)));
      }
    }
    return { added: added, skipped: skipped, errors: errors };
  }

  L.capture = {
    PUBLIC_SOURCES: PUBLIC_SOURCES,
    stripMarkup: stripMarkup, cleanText: cleanText, truncate: truncate,
    fetchText: fetchText, callAI: callAI, parseAIJson: parseAIJson,
    toItem: toItem, localOrganize: localOrganize, organize: organize,
    collectTopic: collectTopic, collectUrl: collectUrl, collectText: collectText,
    refreshSources: refreshSources
  };
})(window.LifeOS);
