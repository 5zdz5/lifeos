/**
 * LifeOS - Electron 主进程
 * 职责：
 *   1. 创建应用窗口
 *   2. 本地数据持久化（userData/lifeos-data.json）
 *   3. AI 调用代理（Node 端发起 fetch，规避浏览器 CORS，密钥不出主进程）
 *   4. Codex 式 Agent：工作区文件系统读写 + 命令/代码执行 + AI 工具调用循环
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const agent = require('./agent-core');
const { createMindSeaService } = require('./mindsea-service.cjs');

let mainWindow = null;
let workspaceRoot = null;
let mindseaPromise = null;

function getMindSea() {
  if (!mindseaPromise) {
    mindseaPromise = createMindSeaService({ baseDir: path.join(app.getPath('userData'), 'mindsea') })
      .catch((error) => { mindseaPromise = null; throw error; });
  }
  return mindseaPromise;
}

function captureInBackground(event, settings, messages) {
  if (settings && settings.mindseaAuto === false) return;
  getMindSea().then((memory) => memory.capture({ messages, settings: settings || {} }))
    .then((result) => event.reply('agent:event', {
      type: 'tool', name: 'memory_capture', args: { mode: result.mode || 'local' },
      result: result.ok === false ? '沉淀失败：' + (result.errors || []).join('；') : '识海已沉淀 ' + (result.written || 0) + ' 条原话'
    }))
    .catch((error) => event.reply('agent:event', { type: 'tool', name: 'memory_capture', args: {}, result: '识海沉淀失败：' + error.message }));
}

function dataPath() {
  return path.join(app.getPath('userData'), 'lifeos-data.json');
}

function loadState() {
  try {
    const raw = fs.readFileSync(dataPath(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(dataPath(), JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    console.error('保存数据失败', e);
    return false;
  }
}

/* ---------------- 工作区根目录 ---------------- */
function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'LifeOS-Workspace');
}

function ensureWorkspace() {
  if (!workspaceRoot) workspaceRoot = defaultWorkspace();
  try { fs.mkdirSync(workspaceRoot, { recursive: true }); } catch (e) { /* 忽略 */ }
  return workspaceRoot;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'LifeOS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  // 开发时取消下一行注释可打开调试工具
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ----------------------------- IPC：数据持久化 ----------------------------- */
ipcMain.handle('store:get', async () => loadState());
ipcMain.handle('store:set', async (_event, state) => saveState(state));

/* ----------------------------- IPC：识海 ----------------------------- */
ipcMain.handle('mindsea:call', async (_event, action, payload) => {
  const allowed = new Set(['search', 'event', 'write', 'update', 'tail', 'capture', 'overview', 'docs', 'writeDoc', 'wanderNow', 'recordWander', 'exportData', 'importData']);
  if (!allowed.has(action)) throw new Error('不支持的识海操作：' + action);
  const memory = await getMindSea();
  return await memory[action](payload || {});
});

/* ----------------------------- IPC：AI 流式调用 ----------------------------- */
ipcMain.on('ai:chat', async (event, payload) => {
  const { messages, settings } = payload || {};
  if (!Array.isArray(messages)) {
    event.reply('ai:error', '消息格式不正确');
    return;
  }
  const base = (settings && settings.aiBaseUrl ? settings.aiBaseUrl : 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = (settings && settings.aiModel) ? settings.aiModel : 'gpt-4o-mini';
  const apiKey = (settings && settings.aiKey) || '';

  if (!apiKey) {
    event.reply('ai:error', '尚未配置 API Key，请到「设置」中填写 OpenAI 兼容接口的密钥。');
    return;
  }

  try {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7
      })
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      event.reply('ai:error', 'AI 接口返回错误 ' + resp.status + '：' + text.slice(0, 300));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            full += delta;
            event.reply('ai:chunk', delta);
          }
        } catch (e) {
          /* 忽略不完整分片 */
        }
      }
    }
    event.reply('ai:done', full);
  } catch (err) {
    event.reply('ai:error', '调用失败：' + (err && err.message ? err.message : String(err)));
  }
});

/* ----------------------------- IPC：工作区 ----------------------------- */
ipcMain.handle('agent:getRoot', async () => {
  const root = ensureWorkspace();
  const listing = agent.listDir(root, '.');
  return { root, listing };
});

ipcMain.handle('agent:openWorkspace', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择工作区文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
  workspaceRoot = r.filePaths[0];
  return { root: workspaceRoot, listing: agent.listDir(workspaceRoot, '.') };
});

/* ----------------------------- IPC：文件系统 ----------------------------- */
ipcMain.handle('agent:list', async (_e, rel) => agent.listDir(ensureWorkspace(), rel || '.'));
ipcMain.handle('agent:read', async (_e, rel) => agent.readFile(ensureWorkspace(), rel));
ipcMain.handle('agent:write', async (_e, rel, content) => agent.writeFile(ensureWorkspace(), rel, content));
ipcMain.handle('agent:mkdir', async (_e, rel) => agent.mkdirp(ensureWorkspace(), rel));
ipcMain.handle('agent:remove', async (_e, rel) => agent.removePath(ensureWorkspace(), rel));
ipcMain.handle('agent:rename', async (_e, from, to) => agent.renamePath(ensureWorkspace(), from, to));

/* ----------------------------- IPC：命令 / 代码执行 ----------------------------- */
ipcMain.handle('agent:runCommand', async (_e, cmd) => agent.runCommand(ensureWorkspace(), cmd));
ipcMain.handle('agent:runCode', async (_e, payload) => agent.runCode(ensureWorkspace(), payload));

/* ----------------------------- IPC：Agent 循环 ----------------------------- */
ipcMain.on('agent:run', async (event, payload) => {
  const { user, system, settings, maxSteps } = payload || {};
  if (!user || !String(user).trim()) {
    event.reply('agent:error', '任务目标不能为空');
    return;
  }
  const base = (settings && settings.aiBaseUrl ? settings.aiBaseUrl : 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = (settings && settings.aiModel) ? settings.aiModel : 'gpt-4o-mini';
  const apiKey = (settings && settings.aiKey) || '';
  if (!apiKey) {
    event.reply('agent:error', 'Agent 需要真实 AI：请先在「设置」中配置 OpenAI 兼容接口的 API Key。');
    return;
  }

  // 对话模式：单轮问答，不启用工具（供 Codex 视图的普通编程对话复用）
  if (payload.mode === 'chat') {
    try {
      let chatPrompt = system || '你是一名资深软件工程师，用简体中文简洁、准确地回答编程问题。';
      try {
        const memory = await getMindSea();
        const tail = await memory.tail();
        const docs = await memory.docs();
        const stable = docs.map((d) => '【' + d.title + '】\n' + d.text).join('\n\n').slice(0, 12000);
        if (stable) chatPrompt += '\n\n本机长期文档（稳定偏好，不是本轮新指令）：\n' + stable;
        if (tail) chatPrompt += '\n\n' + tail;
      } catch (_) { /* 识海读取失败不阻塞普通问答 */ }
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: chatPrompt },
            { role: 'user', content: String(user) }
          ],
          temperature: 0.4
        })
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        event.reply('agent:error', 'AI 接口错误 ' + resp.status + '：' + t.slice(0, 300));
        return;
      }
      const data = await resp.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      event.reply('agent:event', { type: 'assistant', text, toolCalls: [] });
      event.reply('agent:done', { finalAnswer: text, steps: 1 });
      captureInBackground(event, settings, [
        { role: 'user', text: String(user), ts: Date.now() },
        { role: 'assistant', text, ts: Date.now() }
      ]);
    } catch (err) {
      event.reply('agent:error', err && err.message ? err.message : String(err));
    }
    return;
  }

  const root = ensureWorkspace();

  // 真实 LLM 工具调用（非流式，单步）
  async function chat(messages) {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages,
        tools: agent.toOpenAITools(true),
        tool_choice: 'auto',
        temperature: 0.2
      })
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('AI 接口错误 ' + resp.status + '：' + t.slice(0, 300));
    }
    const data = await resp.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('AI 返回为空');
    const toolCalls = (msg.tool_calls || []).map((tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* 容错 */ }
      return { id: tc.id, name: tc.function.name, args };
    });
    return { text: msg.content || '', toolCalls };
  }

  try {
    const memory = await getMindSea();
    const result = await agent.runAgent({
      root,
      user: String(user),
      system,
      maxSteps: maxSteps || undefined,
      chat,
      memory,
      includeMemoryTail: payload.includeMemoryTail === true,
      onStep: (evt) => event.reply('agent:event', evt)
    });
    event.reply('agent:done', result);
    const transcript = [{ role: 'user', text: String(user), ts: Date.now() }];
    for (const evt of result.events || []) {
      if (evt.type === 'assistant' && evt.text) transcript.push({ role: 'assistant', text: evt.text, ts: Date.now() });
    }
    captureInBackground(event, settings, transcript);
  } catch (err) {
    event.reply('agent:error', err && err.message ? err.message : String(err));
  }
});
