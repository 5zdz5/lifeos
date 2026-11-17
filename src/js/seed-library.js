/* =========================================================================
 * LifeOS · 内置知识库种子内容
 *
 * 为什么要有这份文件：知识库不能是个空壳。首次启动时注入一批「有内容」的条目，
 * 打开就能用、能搜、能转笔记，而不是给一个「点这里采集」的空页面。
 *
 * 来源诚实标注：
 *   - type:'ai'   = AI 依据公开方法学整理，内容具体、含步骤/数字，非占位示例
 *   - type:'url'  = 本次构建前真实 HTTP 抓取自公开接口（带 URL 与抓取日期）
 * 用户可随时删除、编辑；删空后不会自动灌回（用 lifeos-seeded 标记）。
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};

(function (L) {
  'use strict';
  // 统一存储适配层：未加载 storage.js 时（如单测）无缝回落原生 localStorage
  const DB = L.storage || localStorage;

  const AI_TIME = Date.parse('2026-11-09T22:00:00+08:00');
  const FETCH_TIME = Date.parse('2026-11-09T22:30:00+08:00');
  const ai = (label) => ({ type: 'ai', label: label, url: '', fetchedAt: AI_TIME });

  const items = [
    {
      title: 'GTD：五步把脑子清空',
      summary: '把所有待办从大脑移到外部系统，按「捕获 → 理清 → 组织 → 回顾 → 执行」处理，判断只做一次。',
      points: [
        '捕获：任何念头 30 秒内写进收件箱，不判断、不排序',
        '理清：逐条问「下一步动作是什么」，2 分钟内能做完的立刻做',
        '组织：按「项目 / 等待 / 将来也许 / 日程」四类归档',
        '回顾：每周固定 30 分钟清空收件箱、更新清单',
        '执行：按情境、可用时间、精力挑当下能做的那一条'
      ],
      tags: ['效率', 'GTD', '任务管理'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '两分钟法则',
      summary: '2 分钟内能完成的事立刻做，不要放进清单——记录和回顾它的成本往往超过直接做完。',
      points: [
        '适用：回一条消息、把文件放回原处、在日历上记一个日期',
        '来自 GTD：理清阶段判断「下一步动作」时顺手执行',
        '例外：正在深度工作时先记下来，避免打断心流',
        '经验值：收件箱里常有 1/3 的条目可以直接用这条法则清掉'
      ],
      tags: ['效率', '微习惯'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '番茄工作法：25/5 与长休息',
      summary: '以 25 分钟专注 + 5 分钟休息为一个番茄钟，用固定节奏对抗分心，并给「专注」一个可计数的单位。',
      points: [
        '一个番茄钟 = 25 分钟只做一件事 + 5 分钟完全离开屏幕',
        '每完成 4 个番茄钟，休息 15–30 分钟',
        '钟内不做任何与任务无关的事；走神就在纸上记一笔再回来',
        '不足 25 分钟的小任务合并进同一个番茄钟，不单独切分',
        '每天记录番茄钟数量，用来估计任务真实耗时'
      ],
      tags: ['专注', '时间管理'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '时间块 Time Blocking',
      summary: '把一天切成 30–90 分钟的块，每块只安排一类工作，先给深度工作锁住精力最好的时段。',
      points: [
        '先放固定事项（会议、吃饭、接送），再填深度工作块',
        '每块预留约 20% 缓冲，避免一处超时导致全天崩盘',
        '每天最多安排 3–4 个深度块，其余留给沟通与杂事',
        '同类琐事（回消息、报销）合并到一个块里批量处理',
        '一天结束后对比计划与实际，修正下一次的估时'
      ],
      tags: ['日程', '专注'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '艾森豪威尔矩阵：四象限判据',
      summary: '用「重要 / 紧急」两个轴把任务分四类，关键是识别「重要但不紧急」并主动排进日程。',
      points: [
        '重要且紧急：立刻做（危机、临近截止）',
        '重要不紧急：排进日程，这是最该主动投入的一类',
        '紧急不重要：委托他人或批量限时处理',
        '不重要不紧急：直接删掉，不做也不解释',
        '判据：问「不做这件事，三个月后会有后果吗」来判定重要性'
      ],
      tags: ['优先级', '决策'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '每周回顾 Weekly Review',
      summary: '固定一个时段（如周五 30 分钟）清空所有收件箱、更新清单，让系统重新可信。',
      points: [
        '清空所有收件箱：邮件、笔记、聊天里的待办、随手记',
        '逐项回顾上周完成与未完成，未完成项重新排期或直接删除',
        '更新项目清单，确认每个项目都有明确的「下一步动作」',
        '扫描「将来也许」清单，决定哪些启动、哪些继续搁置',
        '回顾前先把日历翻一遍上周与下周，捞出遗漏的承诺'
      ],
      tags: ['GTD', '复盘'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: 'PARA：给信息一个固定去处',
      summary: '按「项目 / 领域 / 资源 / 归档」四类存放信息，分类依据是「可行动程度」而非主题。',
      points: [
        'Projects 项目：有明确目标与截止期，正在推进',
        'Areas 领域：需要长期维持的责任，如健康、财务、团队',
        'Resources 资源：将来可能用到的主题资料',
        'Archives 归档：已完成或不再活跃，原样保留不删除',
        '判断顺序：先问「这件事有终点吗」，有终点就进 Projects'
      ],
      tags: ['知识管理', '分类'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '卡片盒笔记法 Zettelkasten',
      summary: '一条笔记只写一个想法，用自己的话重写，并用链接把卡片连成网络，而不是靠文件夹堆层级。',
      points: [
        '原子化：一条笔记只表达一个想法，方便被多处复用',
        '必须用自己的话重写，复制粘贴不算理解',
        '每条笔记至少有一条指向其他笔记的链接，并标注为什么相连',
        '定期浏览链接网络，把相关卡片组合成一篇文章或方案',
        '在笔记里写 [[另一篇标题]] 即可建立双向链接'
      ],
      tags: ['知识管理', '双向链接'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '渐进式总结：分五层加工资料',
      summary: '对同一份材料逐层加粗、高亮、摘要、成品化，让未来的自己能在几秒内找到重点。',
      points: [
        '第 1 层：保存原文',
        '第 2 层：加粗关键段落',
        '第 3 层：在加粗中再高亮核心句',
        '第 4 层：用自己的话写一段摘要',
        '第 5 层：把摘要做成可复用成品（清单、模板、决策依据）',
        '只对真正会重读的材料逐层加工，避免「为整理而整理」'
      ],
      tags: ['知识管理', '阅读'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '间隔重复与主动回忆',
      summary: '合上材料自测（主动回忆）比重读留存高得多，配合递增间隔把记忆固化。',
      points: [
        '主动回忆：先自问自答，再看答案，而不是反复重读',
        '复习间隔按 1 天 / 3 天 / 7 天 / 14 天 / 30 天递增',
        '答错的条目缩短间隔，答对的拉长',
        '每次只测 10–20 条，控制在 10 分钟内',
        '把要点写成问答卡片，直接拿来自测'
      ],
      tags: ['学习', '记忆'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '费曼技巧：用「讲不清」定位漏洞',
      summary: '假装把概念讲给完全不懂的人，卡住或只能背术语的地方，就是没真懂的地方。',
      points: [
        '选一个概念，写下讲给外行听的解释，不许用行话',
        '标出卡壳、绕圈、只能复述术语的段落',
        '回到原始材料补齐这些点，再讲一遍',
        '最后用一个具体例子收尾，检验能否迁移到新情境'
      ],
      tags: ['学习', '理解'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '习惯叠加与微习惯',
      summary: '用「做完 A 之后我就做 B」把新习惯挂在既有动作上，并把起步难度降到不可能失败。',
      points: [
        '公式：做完 [现有习惯] 之后，我就做 [新习惯]',
        '起步要小到不可能失败：读 1 页、做 1 个俯卧撑、写 1 句话',
        '固定同一时间、同一地点，减少每天的决策成本',
        '打卡只记「做了没」，不追求强度；连续天数比单次量更重要',
        '断了一天立刻接上，不用补卡、不重新开始计数'
      ],
      tags: ['习惯', '行为设计'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '稍后读的收敛：给输入设上限',
      summary: '收藏不等于掌握。给待读清单设硬上限，并为每条收藏写一句「为什么存它」。',
      points: [
        '设一个上限，例如待读不超过 20 条，超了就先清理再收藏',
        '每条收藏写一句「我为什么存它」，写不出来就删掉',
        '每周固定时段清理：读完提炼成 1 条笔记，或直接丢弃',
        '超过 30 天未打开的默认归档，不再占用注意力',
        '判断标准：这条信息会影响我未来一个月的某个决定吗'
      ],
      tags: ['信息饮食', '知识管理'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },
    {
      title: '本地优先软件与数据主权',
      summary: '数据默认存本机，联网只用于同步与获取外部内容；能用「断网测试」和「一键导出」判断真伪。',
      points: [
        '判断 1：断网时能否完整使用全部功能（不是只显示缓存页）',
        '判断 2：能否一键导出全部数据的可移植格式（JSON / Markdown）',
        '定期导出备份，避免被单一应用锁死',
        '日记、健康、财务等敏感内容优先选不上云的方案',
        '联网动作应当可解释、可关闭：只在你主动触发时发生'
      ],
      tags: ['本地优先', '隐私'], source: ai('AI 整理 · 公开方法学'), raw: ''
    },

    /* ↓ 以下 3 条是构建前真实 HTTP 抓取所得，保留原始出处与抓取时间，用来验证采集链路 */
    {
      title: '摘录 · 拉丁古谚',
      summary: '循此苦旅，终抵繁星。',
      points: [], tags: ['外部摘录', '真实抓取'],
      source: { type: 'url', label: '外部采集 · 一言公开接口（拉丁古谚）', url: 'https://v1.hitokoto.cn/?c=k&encode=json', fetchedAt: FETCH_TIME },
      raw: '循此苦旅，终抵繁星。 —— 拉丁古谚'
    },
    {
      title: '摘录 · 毛泽东《沁园春·长沙》',
      summary: '曾记否，到中流击水，浪遏飞舟。',
      points: [], tags: ['外部摘录', '真实抓取'],
      source: { type: 'url', label: '外部采集 · 一言公开接口（沁园春·长沙）', url: 'https://v1.hitokoto.cn/?c=d&encode=json', fetchedAt: FETCH_TIME },
      raw: '曾记否，到中流击水，浪遏飞舟。 —— 毛泽东《沁园春·长沙》'
    },
    {
      title: '摘录 · 苏轼《水调歌头》',
      summary: '明月几时有？把酒问青天。',
      points: [], tags: ['外部摘录', '真实抓取'],
      source: { type: 'url', label: '外部采集 · 一言公开接口（水调歌头·丙辰中秋）', url: 'https://v1.hitokoto.cn/?c=i&encode=json', fetchedAt: FETCH_TIME },
      raw: '明月几时有？把酒问青天。 —— 苏轼《水调歌头·丙辰中秋》'
    }
  ];

  const SEED_KEY = 'lifeos-seeded';

  /* 首次启动且知识库为空时注入；注入过一次后不再灌回（尊重用户删除） */
  function ensure(S) {
    try { if (DB.getItem(SEED_KEY)) return 0; } catch (e) { /* 无 localStorage 时继续 */ }
    if (!S || !S.state) return 0;
    if (!S.state.library) S.state.library = [];
    if (S.state.library.length) { markSeeded(); return 0; }
    const now = Date.now();
    items.forEach((it, i) => {
      S.state.library.push(Object.assign({
        id: 'seed-' + i,
        noteId: null,
        createdAt: now - (items.length - i) * 1000
      }, JSON.parse(JSON.stringify(it))));
    });
    S.persist();
    markSeeded();
    return items.length;
  }

  function markSeeded() {
    try { DB.setItem(SEED_KEY, '1'); } catch (e) { /* noop */ }
  }

  function isSeedItem(it) {
    return !!(it && /^seed-\d+$/.test(String(it.id || '')));
  }

  /* 清除内置示例：只删 seed- 前缀条目，用户自己采集/编辑的条目一律保留。
     同时打上已注入标记，避免刷新后又被灌回来。 */
  function clear(S) {
    if (!S || !S.state || !Array.isArray(S.state.library)) return 0;
    const before = S.state.library.length;
    S.state.library = S.state.library.filter((it) => !isSeedItem(it));
    markSeeded();
    const removed = before - S.state.library.length;
    if (removed) S.persist();
    return removed;
  }

  function count(S) {
    if (!S || !S.state || !Array.isArray(S.state.library)) return 0;
    return S.state.library.filter(isSeedItem).length;
  }

  L.seedLibrary = { items: items, ensure: ensure, clear: clear, count: count, isSeedItem: isSeedItem, SEED_KEY: SEED_KEY };
})(window.LifeOS);
