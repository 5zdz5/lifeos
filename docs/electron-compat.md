# Electron 桌面端 · 兼容验证记录

> 系统化更新 W4 交付。验证范围：**静态语法 + 边界代码审查**，不含图形化启动验证。

## 1. 验证结果（W4 执行）

```bash
cd /workspace/lifeos
node --check main.js              # ✅ 通过
node --check preload.js           # ✅ 通过
node --check agent-core.js        # ✅ 通过
node --check mindsea-service.cjs  # ✅ 通过
```

四个主进程 / 预加载文件语法均通过 Node 22 解析。

## 2. 网页版与桌面端的能力边界

| 能力 | Electron 桌面端 | 网页版 / 鸿蒙 ArkWeb |
|---|---|---|
| 数据持久化 | `window.electronAPI.saveState` / `getState` 落盘 | `localStorage` + IndexedDB 双写灰度 |
| 存储模式 | **强制 `legacy`**（`storage.js` 检测 `window.electronAPI`） | `legacy` / `dual` / `idb` 三态 |
| 文件读写 / 终端命令 | 主进程真实执行（Agent / Codex 工作区） | **隔离演示**：iframe + Worker 沙箱，不碰本机文件 |
| AI 调用 | `electronAPI.initAI` / `aiChat` | 未填 Key 时走演示回复 |
| 识海 | `electronAPI.mindseaCall` | 浏览器适配器 |

`src/js/bridge.js` 用 `bridge.mode === 'electron'` 分流；UI 上明确标注演示模式与「未改动本机」回执，避免用户误以为网页版能操作真实文件。

## 3. W1–W4 对桌面端的影响

- **W1**：新增 `storage.js`，Electron 检测后直接返回 `legacy`，`localStorage` 别名调用在桌面端仍可用；`app.init()` 里的 `await hydrate()` 在 legacy 下立即返回
- **W2**：新增 4 个 JS 模块，`build-standalone.js` 的 `jsFiles` 已同步收录，standalone 与网页同源
- **W3**：动效工具 `motionOK()` 在 Electron 里同样读取 `matchMedia`，reduce 下自动关闭
- **W4**：仅文档与项目级 Skill，不改 `src/`，对桌面端无影响

## 4. 未验证项（如实声明）

- 未执行 `npm install` 安装 Electron，因此**没有启动 GUI、没有窗口截图、没有打包/签名**
- 未验证 `main.js` 的 BrowserWindow 创建、`preload.js` 的 contextBridge 在真实 Electron 版本下的行为
- 未验证桌面端文件/命令执行的真实回执链路

## 5. 撤销条件

若在有图形环境或可安装 Electron 的机器上完成 `npm install && npm start` 启动 smoke，应把本文件改为「已图形验证」并记录 Electron 版本、操作系统与启动截图；在此之前不得声称桌面端已验证。
