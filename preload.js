/**
 * LifeOS - 预加载脚本
 * 通过 contextBridge 向渲染层安全地暴露有限 API（不开启 nodeIntegration）。
 */
const { contextBridge, ipcRenderer } = require('electron');

let aiHandler = null;      // AI 助手流式回调
let agentHandler = null;   // Codex Agent 循环回调

ipcRenderer.on('ai:chunk', (_e, data) => { if (aiHandler) aiHandler({ type: 'chunk', data }); });
ipcRenderer.on('ai:done', (_e, data) => { if (aiHandler) aiHandler({ type: 'done', data }); });
ipcRenderer.on('ai:error', (_e, data) => { if (aiHandler) aiHandler({ type: 'error', data }); });

ipcRenderer.on('agent:event', (_e, data) => { if (agentHandler) agentHandler({ type: 'event', data }); });
ipcRenderer.on('agent:done', (_e, data) => { if (agentHandler) agentHandler({ type: 'done', data }); });
ipcRenderer.on('agent:error', (_e, data) => { if (agentHandler) agentHandler({ type: 'error', data }); });

contextBridge.exposeInMainWorld('electronAPI', {
  // 数据
  getState: () => ipcRenderer.invoke('store:get'),
  saveState: (state) => ipcRenderer.invoke('store:set', state),

  // 识海：白名单动作由主进程校验，SQLite 不暴露给渲染层
  mindseaCall: (action, payload) => ipcRenderer.invoke('mindsea:call', action, payload),

  // AI 助手（流式）
  aiChat: (payload) => ipcRenderer.send('ai:chat', payload),
  initAI: (cb) => { aiHandler = cb; },

  // Codex Agent：工作区 / 文件系统 / 执行
  agentGetRoot: () => ipcRenderer.invoke('agent:getRoot'),
  agentOpenWorkspace: () => ipcRenderer.invoke('agent:openWorkspace'),
  agentList: (rel) => ipcRenderer.invoke('agent:list', rel),
  agentRead: (rel) => ipcRenderer.invoke('agent:read', rel),
  agentWrite: (rel, content) => ipcRenderer.invoke('agent:write', rel, content),
  agentMkdir: (rel) => ipcRenderer.invoke('agent:mkdir', rel),
  agentRemove: (rel) => ipcRenderer.invoke('agent:remove', rel),
  agentRename: (from, to) => ipcRenderer.invoke('agent:rename', from, to),
  agentRunCommand: (cmd) => ipcRenderer.invoke('agent:runCommand', cmd),
  agentRunCode: (payload) => ipcRenderer.invoke('agent:runCode', payload),

  // Codex Agent：任务循环（流式）
  agentRun: (payload) => ipcRenderer.send('agent:run', payload),
  initAgent: (cb) => { agentHandler = cb; }
});
