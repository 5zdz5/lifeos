/* =========================================================================
 * LifeOS · AI 助手模块
 * 支持：流式对话、规划今天、总结笔记、习惯建议
 * 通过 LifeOS.bridge 调用（Electron 走主进程代理 / 浏览器走 fetch，无 key 时本地 mock）
 * ========================================================================= */
window.LifeOS = window.LifeOS || {};
LifeOS.modules = LifeOS.modules || {};

(function (L) {
  'use strict';
  const U = L.utils;
  const S = L.store;

  let streamingMsg = null;   // 正在接收流式内容的助手消息对象
  let busy = false;

  /* 构建系统提示词：注入用户上下文，让 AI 了解你的生活数据 */
  function buildSystem() {
    const st = S.state;
    const name = st.settings.userName ? st.settings.userName + '，' : '';
    let ctx = '你是 LifeOS 的内置 AI 助手，帮助用户管理任务、习惯与笔记，给出温暖、具体、可执行的建议。';

    const open = st.tasks.filter((t) => t.status !== 'done');
    if (open.length) {
      ctx += '\n\n【我的任务】\n' + open.map((t) =>
        '- ' + t.title + '（优先级：' + ({ high: '高', medium: '中', low: '低' }[t.priority] || '中') +
        (t.due ? '，截止 ' + t.due : '') + (t.tags && t.tags.length ? '，标签 ' + t.tags.join('/') : '') + ')'
      ).join('\n');
    }
    if (st.habits.length) {
      ctx += '\n\n【我的习惯】\n' + st.habits.map((h) => {
        const c = h.checkins || {};
        let n = 0; const d = new Date();
        while (true) { const off = d.getTimezoneOffset() * 60000; const k = new Date(d.getTime() - off).toISOString().slice(0, 10); if (c[k]) { n++; d.setDate(d.getDate() - 1); } else break; }
        return '- ' + (h.emoji || '') + h.name + '（当前连续 ' + n + ' 天）';
      }).join('\n');
    }
    const recent = st.notes.slice(0, 5);
    if (recent.length) {
      ctx += '\n\n【近期笔记（节选）】\n' + recent.map((n) => '《' + n.title + '》：' + (n.body || '').slice(0, 200)).join('\n---\n');
    }

    // PetOS · 概念 4 装备专家系统：戴上什么就是什么专家，改写人格与职责边界
    if (L.pet) {
      const pet = L.pet.activePet();
      if (pet) {
        const gear = L.pet.gearOf(pet.equip);
        const PERSONA = {
          scholar: '你现在佩戴「学者帽」：回答注重引用来源、区分事实与推测，优先从用户笔记与知识库中找依据，没有依据就明说。',
          cleaner: '你现在佩戴「清道夫」：专注识别重复、过期与冗余内容；你只能提出清理建议，绝不擅自删除——任何删除都必须经主控点头授权。',
          banker: '你现在佩戴「庄家领结」：善于把大任务拆成可执行的小步骤，指出哪些步骤可并行、哪些有依赖，并提醒成本与失败兜底。',
          twin: '你现在是用户的「数字分身」：语气和判断贴近用户本人，优先复用他的既有习惯与偏好，而不是套用通用模板。',
          none: ''
        };
        if (PERSONA[gear.id]) ctx += '\n\n【当前装备的专家身份】\n' + PERSONA[gear.id];

        // 概念 8 数字分身：把从真实行为学到的偏好注入 System Prompt
        const skills = L.pet.userSkills();
        if (skills.length) {
          ctx += '\n\n【从用户行为学到的偏好（数字分身）】\n' + skills.map((s) => '- ' + s).join('\n');
          ctx += '\n在建议时主动贴合这些偏好，但不要声称来自用户明示，除非确有记录。';
        }
      }
    }
    return ctx;
  }

  function send(userText, opts) {
    opts = opts || {};
    if (busy) { U.toast('请等待上一条回复完成', 'error'); return; }
    const text = (userText || '').trim();
    if (!text) return;

    // 追加用户消息
    S.pushAI({ role: 'user', content: text });
    // 创建助手占位消息
    streamingMsg = { role: 'assistant', content: '', ts: Date.now() };
    S.state.aiThread.push(streamingMsg);
    busy = true;
    L.app.refresh();

    // 流式占位消息（空 content 的 assistant）不能发给模型：
    // 否则演示回复会复读成「你刚才说：""」，真实接口也可能拒绝空消息。
    const messages = [{ role: 'system', content: buildSystem() }].concat(
      S.state.aiThread
        .filter((m) => m !== streamingMsg && !(m.role === 'assistant' && !m.content))
        .map((m) => ({ role: m.role, content: m.content }))
    );
    L.bridge.aiChat({ messages, settings: S.state.settings });
  }

  function onAIEvent(e) {
    if (!streamingMsg) return;
    if (e.type === 'chunk') {
      streamingMsg.content += e.data;
      renderStreaming();
    } else if (e.type === 'done') {
      const finished = streamingMsg;
      busy = false; streamingMsg = null;
      S.persist();
      if (finished && finished.content && S.state.settings.mindseaAuto !== false) {
        const previous = S.state.aiThread[S.state.aiThread.length - 2];
        L.bridge.mindsea.capture({ messages: [previous, finished].filter(Boolean).map((m) => ({ role: m.role, text: m.content, ts: m.ts })), settings: S.state.settings }).catch(() => {});
      }
      L.app.refresh();
    } else if (e.type === 'error') {
      streamingMsg.content += '\n\n! ' + e.data;
      busy = false; streamingMsg = null;
      S.persist();
      L.app.refresh();
      U.toast('AI 调用遇到问题', 'error');
    }
  }

  function renderStreaming() {
    const box = document.getElementById('ai-messages');
    if (box) {
      const last = box.querySelector('.msg.assistant:last-child .msg-body');
      if (last) last.innerHTML = U.markdown(streamingMsg.content);
      box.scrollTop = box.scrollHeight;
    }
  }

  function render() {
    const thread = S.state.aiThread;
    const connected = !!S.state.settings.aiKey;
    const msgs = thread.length ? thread.map((m) => {
      const demo = !connected && m.role === 'assistant' && /演示模式|本地生成|本地示例/.test(m.content || '');
      return '<div class="msg ' + m.role + '">' +
        '  <div class="msg-role">' + (m.role === 'user' ? '我' : (demo ? 'AI · 示例回复' : 'AI')) + '</div>' +
        '  <div class="msg-body">' + U.markdown(m.content) + '</div>' +
        '</div>';
    }).join('') : '<div class="empty ai-empty"> 嗨，我是你的 LifeOS 助手。可以让我帮你规划今天、总结笔记，或随便聊聊。</div>';

    return '' +
      '<div class="page ai-page">' +
      '  <div class="ai-status-bar' + (connected ? '' : ' demo') + '">' +
      '    <span class="ai-dot ' + (connected ? 'on' : '') + '"></span>' +
      '    <span>' + (connected
        ? 'AI 已连接（' + U.escapeHtml(S.state.settings.aiModel || '默认模型') + '）'
        : '演示模式 · 下方回复由本地模板生成，不是真实 AI。配置 API Key 后才会调用大模型。') + '</span>' +
      '    <div class="spacer"></div>' +
      (connected ? '' : '<button class="btn ghost btn-xs" id="ai-go-settings">去设置 →</button>') +
      '    <button class="btn ghost" id="ai-clear">清空对话</button>' +
      '  </div>' +
      (L.pet ? (function () {
        const pet = L.pet.activePet();
        if (!pet) return '';
        return '  <div class="ai-gearbar"><span class="agb-label">装备专家</span>' +
          L.pet.equipment().map((e) =>
            '<button class="agb-item' + (e.id === pet.equip ? ' on' : '') + '" data-aigear="' + e.id + '" ' +
            'title="' + U.escapeHtml(e.role) + '" aria-pressed="' + (e.id === pet.equip) + '">' +
            U.escapeHtml(e.glyph) + ' ' + U.escapeHtml(e.name) + '</button>').join('') +
          '</div>';
      })() : '') +
      '  <div class="ai-messages" id="ai-messages">' + msgs + '</div>' +
      '  <div class="ai-quick">' +
      '    <button class="chip" data-act="plan">▦ 规划今天</button>' +
      '    <button class="chip" data-act="summary">▤ 总结笔记</button>' +
      '    <button class="chip" data-act="habit">◆ 习惯建议</button>' +
      '  </div>' +
      '  <div class="ai-input">' +
      '    <textarea id="ai-text" class="input" rows="2" placeholder="输入你想问的事…"></textarea>' +
      '    <button class="btn primary" id="ai-send">发送</button>' +
      '  </div>' +
      '  <div class="ai-foot-hint">Enter 发送 · Shift+Enter 换行' + (connected ? '' : ' · 当前为演示回复') + '</div>' +
      '</div>';
  }

  function bind(root) {
    L.bridge.initAI(onAIEvent);

    const text = root.querySelector('#ai-text');
    const doSend = () => { send(text.value); text.value = ''; };

    root.querySelector('#ai-send').addEventListener('click', doSend);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    root.querySelector('#ai-clear').addEventListener('click', async () => {
      if (await U.confirm('确定清空当前对话？')) { S.clearAI(); L.app.refresh(); }
    });
    const goSettings = root.querySelector('#ai-go-settings');
    if (goSettings) goSettings.addEventListener('click', () => L.app.showView('settings'));

    // PetOS 概念 4：装备专家，切换后 system 人格随之改变（见 buildSystem）
    root.querySelectorAll('[data-aigear]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-aigear');
      if (L.pet && L.pet.equipActive(id)) {
        const g = L.pet.gearOf(id);
        U.toast('已装备「' + g.name + '」· 后续对话将按该专家人格回答');
        L.app.refresh();
      }
    }));

    root.querySelector('[data-act="plan"]').addEventListener('click', () =>
      send('请根据我今天的任务和习惯，为我制定一个合理的今日时间安排（按时间顺序，标注优先级与预估耗时），并说明为什么这样排。'));
    root.querySelector('[data-act="summary"]').addEventListener('click', () =>
      send('请总结我最近的笔记要点，提炼出可执行的行动项。'));
    root.querySelector('[data-act="habit"]').addEventListener('click', () =>
      send('请基于我的打卡数据，分析我的习惯坚持情况，并给出 3 条切实可行、容易坚持的改进建议。'));

    const box = root.querySelector('#ai-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  L.modules.ai = { render, bind };
})(window.LifeOS);
