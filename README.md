# LifeOS · 本地优先的个人知识与生活系统

一个**轻量、本地化**的个人工作台：任务待办、习惯打卡、笔记日记、双向链接、日历、全年热力图、**知识库**、AI 助手，以及 **Codex 式编程 Agent**。像平板自带的备忘录 / 日历一样打开即用，数据 100% 存在本机，断网照常使用；**只在联网采集与 AI 调用时才联网**。

**在线体验**：https://alifeosv3nov09.app.workbuddy.host/?sharecode=33O3OVO2Z3&v=c04360fc#dashboard
> 整条使用：`?sharecode=...` 是访问凭据，删掉会打不开；`v=` 是版本戳，源码改动后自动变化，用于刷新浏览器/SW 缓存。扫码可用 `docs/lifeos-open-qr.png`。

## 装到设备（两条路径，都无需签名 / DevEco / 证书）

| 方式 | 适用场景 | 做法 |
| --- | --- | --- |
| **A. 在线链接（推荐）** | 长期可用、可分享、自动更新 | 平板 / 电脑浏览器打开上方链接 → 菜单「添加到主屏幕」→ 全屏独立运行，支持离线 |
| **B. 单文件离线版** | 完全离线、无需服务器、最像本地 App | 把 `dist/lifeos.html`（约 154 KB，自带全部 CSS/JS）传到设备 → 浏览器打开 → 「添加到主屏幕」 |

> 关键一步都是浏览器里的「**添加到主屏幕**」，执行后才会以全屏 App 形态出现在桌面，否则只是书签。
> 单文件版已用 `file://` 双击打开验证：10 个导航、知识库、本地标识均正常渲染，零 JS 错误。
> 早期还做过局域网扫码、PWA 托管脚本、鸿蒙原生工程等方案，已归档在 `legacy/` 与 `../lifeos-harmony/`，日常使用不必关注。

## 本地化：数据在哪、什么时候联网

- **数据 100% 在本机**：浏览器存 `localStorage`（Electron 模式为应用用户目录 `lifeos-data.json`）。没有账号、没有云端数据库、没有任何上报。侧栏常驻「💾 数据仅存本机」。
- **断网可用**：任务、习惯、笔记、日历、热力图、知识库全部离线运行；单文件版可完全不联网。
- **联网只在你主动触发时**，仅两处：① 知识库的「联网采集 / 刷新源」抓取外部内容；② 你填了 Key 之后的 AI 接口调用。其余时间零请求。
- **随时带走**：一键导出 JSON（含知识库），或下载单文件离线版。

> 清缓存、换设备、卸载 PWA 都会丢失本机数据，**请定期导出备份**。在线版与单文件版不同源，数据互不相通；跨设备迁移用「导出 → 导入」。

## 知识库：AI 采集外部内容，沉淀到本地

打开「📚 知识库」即是一片卡片流，可搜索、按标签筛选、转笔记、删除。**首次启动会注入 17 条有内容的条目**（14 条具体方法学知识 + 3 条构建前真实 HTTP 抓取的公开内容，带来源 URL 与抓取时间），不是空壳页面；清空后不会自动灌回，也可用「载入内置内容」恢复。

三条采集通道（点「＋ 联网采集」）：

| 通道 | 怎么做 | 需要什么 |
| --- | --- | --- |
| 🤖 AI 主题 | 输入主题 → 调用已配置的 OpenAI 兼容接口 → 模型输出严格 JSON → 前端解析入库 | 设置里填了 API Key |
| 🌐 网址 | 真实 `fetch` 允许跨域的公开接口（如 `v1.hitokoto.cn`）；HTML 自动剥标签、可选交给 AI 整理 | 目标站点允许 CORS |
| ✍️ 粘贴正文 | 从任意 App 复制内容 → 本地确定性抽取标题/摘要/要点/`#标签` | **无需 Key、无需联网** |

「🔄 刷新源」会批量拉取已登记的公开源并按来源去重。已在真实浏览器中验证：一次刷新抓回 3 条、错误 0、条目 17→20。

**诚实的技术边界**：浏览器受 CORS 限制，抓不了不开放跨域的普通网页——被拒绝时会明确告诉你原因，并引导改用「粘贴正文」或换成允许跨域的接口，不会假装「什么都能爬」。想抓任意网页，把 `js/capture.js` 里的 `PUBLIC_SOURCES` 换成你自己的服务端/代理端点即可。

采集来的条目可「📝 转为笔记」（写入 Markdown 正文，保留来源与原文摘录，并与原条目关联），且**随备份一起导出**。

## 数据与备份

在「⚙️ 设置 → 数据与备份」里：

- **⬇ 导出备份**：JSON 文件，含任务 / 习惯 / 笔记 / **知识库** / AI 对话 / 设置
- **⬆ 导入备份**：可选「合并」（按 ID 追加）或「覆盖」；两者都先自动存快照
- **本地快照**：数据变更自动留存（3 分钟节流、最多 8 份），可手动创建、按时间点恢复、一键清空
- 顶部显示各实体数量与占用，底部显示**当前构建版本**，可据此判断线上是不是最新版

## 功能

| 模块 | 说明 |
| --- | --- |
| 🏠 总览 | 今日问候、**桌宠伙伴**（具身/换宠/装备/点头授权/数字分身）、5 张指标卡、今日任务与打卡速览 |
| ✅ 任务待办 | 增删改、优先级、截止日期、标签、状态流转、搜索 |
| 🔥 习惯打卡 | 自定义习惯、今日打卡、连续天数、完成率 |
| 📝 笔记日记 | Markdown 编辑 + 实时预览、标签、搜索、Obsidian 风格 `[[双向链接]]` |
| 📚 **知识库** | 本地卡片流、17 条内置内容、三通道联网采集、刷新去重、搜索筛选、转笔记、**吞入内化（→带双向链接的卡片）** |
| 📅 日历 | 月视图按日聚合任务、打卡、笔记、AI 对话 |
| 🔥 活动热力图 | 全年 53 周贡献图，点击格子跳日历 |
| 🕸 知识图谱 | 双向链接力导向图 + **「知识小屋」布局**（卡片连成屋子），节点可跳转 |
| 👨‍💻 **Codex** | 编程 Agent：Codex 式对话界面（任务栏 + 任务流 + 输入框），可折叠工作区面板（详见下节） |
| 🤖 AI 助手 | 流式对话，**装备专家（戴上即改写人格）**、数字分身偏好注入、「规划今天 / 总结笔记 / 习惯建议」 |
| ⚙️ 设置 | **本地与隐私说明**、AI 接入、称呼、主题、备份与快照、**多平台·社交 A2A 演示** |

## Codex 式编程 Agent（👨‍💻 Codex）

**界面形态与 Codex 一致**：进入后占满整窗（隐去 LifeOS 侧栏），左侧是任务列表（新建 / 切换 / 删除），中间是任务流，底部是输入框，工作区文件收进右侧可折叠面板。

- 任务流里每次工具调用都渲染成一行可展开的操作（`$ 命令`、`✎ 写入 path`），写入文件直接展示 **+ 行 diff**
- 输入框内切换 **Agent / 问答** 两种模式，Enter 发送、Shift+Enter 换行
- 任务历史存在本机（`localStorage`，保留最近 20 个任务），刷新/重开都还在

核心是「给目标 → Agent 自主完成」：它先列目录、读文件了解现状，再写代码、运行验证，多步迭代直到结果正确。

**Agent 能力**（对应 OpenAI Codex 的核心循环）：

| 能力 | 说明 |
| --- | --- |
| 工作区文件系统 | 列目录 / 读 / 写 / 建目录 / 删 / 重命名，路径被强制限制在工作区内（防越界） |
| 执行命令 | 在工作区目录执行 shell 命令（安装依赖、跑测试、git 等），带 30s 超时与输出截断 |
| 运行代码 | JS 用 `node`、Python 用 `python3`，写到临时文件执行后清理 |
| Agent 循环 | 大模型用工具调用（list_files / read_file / write_file / run_command / run_code）自主多步推进，最多 15 步，每步基于上一步真实输出决策 |
| 对话模式 | 输入框切到「问答」即可直接提问，自动带上右侧正在查看的文件作为上下文 |

**形态差异（务必看清）**：

| 环境 | 文件读写 | 命令/代码执行 | 说明 |
| --- | --- | --- | --- |
| **Electron 桌面版**（`npm install && npm start`） | ✅ 真实本机文件 | ✅ 真实 shell / node / python3 | 完整 Codex 能力，默认工作区 `~/Documents/LifeOS-Workspace`，可点「打开项目」换目录 |
| 浏览器版（在线链接 / 单文件） | ⚠️ 虚拟工作区 | ⚠️ 仅 JS 沙箱（Python/命令受限） | 用于体验交互；真实读写本机文件、执行命令、Python 需桌面版 |

> **安全提示**：Electron 桌面版把 shell 命令执行权交给 AI，相当于「AI 在你电脑上跑代码」。请只在可信目标上使用、勿以管理员身份运行、并留意 Agent 每步做了什么（对话面板会逐条展示工具调用与结果）。文件操作被限定在工作区目录内，但 `run_command` 会以当前用户权限执行，请自行评估风险。

Agent 需要真实 AI：在「设置」配好 API Key 后即可用（未配 Key 时浏览器版为演示流程、桌面版会提示配置）。

## 配置 AI

「设置」填写 **API Base URL**（默认 `https://api.openai.com/v1`，可换 DeepSeek / 通义 / 智谱等兼容地址）、**API Key**、**模型名称**。填写后侧栏显示「AI：已连接 ✓」。密钥仅存本机。**不填 Key 也能完整使用**：AI 助手走演示模式、知识库走本地整理与粘贴通道，全程零联网。

## 开发命令

```bash
npm run build        # CSS 单源合并 → 算版本戳 → SW 清单/版本文件 → standalone → 鸿蒙 rawfile 同步
npm run build:css    # 只重建 src/css/app.css（style.css + finesse.css，零依赖确定性合并）
npm test             # 13 个 Node 套件（浏览器套件需 LIFEOS_TEST_URL，未设置时自动跳过）
npm run verify       # 49 项全文件字节一致性校验（线上内容 == 本地构建）
npm run test:browser # 91 条真实浏览器回归（需 LIFEOS_TEST_URL、Playwright、Chrome）
bash .codebuddy/skills/lifeos-maintainer/scripts/release.sh   # 一键构建 + 全量验证 + 截图 + 二维码
```

```bash
# 逐张视觉回归：11 张 = 8 张核心视图 + 3 张动效静帧
SHOTS_SET=w3 PREFIX=w3 LIFEOS_TEST_URL="...&v=<hash>#dashboard" node tools/capture-shots.js
```

`npm run build` 依据**源码内容 hash**自动生成版本号（`v` + 8 位），任何源码改动都会改变版本 → SW 缓存名随之变化 → 客户端自动更新，**不会再出现「发布了但界面没变」**。SW 策略：页面导航 network-first，静态资源 cache-first；启动时主动检查更新并在新 SW 接管后自动刷新一次。`src/` 同时是线上服务目录（本机 3000 端口静态服务），因此**改动 `src/` 即改动线上内容**，每次变更都要跑完整验证链。

## 运行方式

```bash
# 浏览器预览
cd src && python3 -m http.server 8080   # 打开 http://localhost:8080

# 桌面应用（Electron，需先 npm install）
npm install && npm start
```

## 目录结构

```
lifeos/
├── README.md  package.json
├── build-standalone.js      # 统一构建（版本戳 / SW / standalone / 鸿蒙 rawfile）
├── verify-release.js        # 发布后 49 项字节一致性校验
├── main.js / preload.js     # Electron 主进程与桥接（含 Agent IPC）
├── agent-core.js            # Codex Agent 后端引擎（纯 Node 可测）
├── mindsea-service.cjs      # 识海长期记忆服务
├── tools/
│   ├── build-css.js         # 零依赖 CSS 单源合并
│   └── capture-shots.js     # 视觉回归截图（11 张逐张清单）
├── tests/                   # 13 个 Node 套件 + 浏览器回归
├── docs/                    # ADR / 方案 / 视觉证据 / 兼容记录 / 二维码 / Skill 包
├── .ai-memory/              # handoff / 摘要 / 术语表 / 判断回溯录
├── .rollback/               # W0 一键回滚基线
├── .codebuddy/skills/lifeos-maintainer/   # 项目级维护 Skill
├── legacy/                  # 早期部署方案（已归档）
├── dist/lifeos.html         # 单文件离线安装包
└── src/                     # 线上服务目录（3000 端口静态服务）
    ├── index.html  manifest.webmanifest  sw.js  version.json  standalone.html
    ├── css/style.css  css/finesse.css  css/app.css（生成物，勿手改）  assets/icon-*.png
    └── js/
        ├── storage.js       # 统一存储适配层（三态双写灰度）
        ├── vault.js  search.js  links.js  utils.js  bridge.js  store.js  stats.js
        ├── mindsea.js  capture.js  seed-library.js  app.js  version.js
        └── modules/         # tasks / habits / notes / library / calendar / heatmap /
                             # graph / codex / ai / mindsea / settings / daily / search
```

## 技术说明

- 前端：原生 HTML/CSS/JS，零构建依赖、零第三方库、无后端、无账号
- `bridge.js` 自动识别环境：Electron 走 IPC（数据落盘 + AI 流式代理 + Agent），浏览器走 `localStorage` + `fetch` + 虚拟工作区
- `agent-core.js` 为纯 Node 模块（不依赖 electron），文件系统 / 命令 / 代码 / Agent 循环均可独立单测；`main.js` 通过 IPC 暴露给渲染层
- `capture.js` 的 AI 调用走独立非流式通道，不与 AI 助手的流式回调串扰
- Service Worker 仅在浏览器安全上下文注册（Electron / 鸿蒙 ArkWeb 内不启用）

## 系统化更新（W1–W4，2026-11-13）

在四个 finesse 系列 Skill 重构界面、完成安全加固与真实用户审计之后，参考 `obsidian` / `dev-expert` / `huashu-art-motion` / `skill-creator` 做了四个 Wave 的系统化更新：

| Wave | 内容 |
|---|---|
| W1 地基 | `storage.js` 同步接口 + `legacy/dual/idb` 三态双写灰度 + URL 应急回滚；零依赖 `tools/build-css.js` 把两份 CSS 合成单一运行时来源 `css/app.css` |
| W2 知识内容 | 反链上下文 / 未链接提及、Daily Notes（notes 子视图，**不新增导航项或实体**）、Markdown Vault 往返与 wikilink 安全重命名、跨 6 类实体的全局检索（`Ctrl/⌘+K`） |
| W3 视觉动效 | 统一动效工具（`motionOK` / `stagger` / `countUp`）、热力图波浪点亮、图谱描边生长、全面 `prefers-reduced-motion` 降级；11 张逐张视觉回归零破损 |
| W4 交付沉淀 | 项目级维护 Skill、三份 ADR、`.ai-memory` 摘要/术语/回溯录、鸿蒙与 Electron 兼容记录、README 与二维码刷新 |
| W5 桌宠伙伴（Agent Pet 概念落地） | 白皮书 9 大概念**注入现有能力、不改骨架**：`L.pet` 内核（独立 key 故障隔离）+ 具身桌宠 / 多宠物 / 装备专家 / 点头授权双阶段 / 数字分身 / 知识小屋布局 / 吞入内化（→双向链接）/ 老板视角团队看板 / A2A 社交演示。**不新增导航、源文件与实体键**，第 14 套件守护不变量 |
| W5.1 视觉强化 | 桌宠升级为总览「英雄区」：放大形象 + 呼吸光环 + 伙伴在线胶囊 + 4 格真实互动统计；新增 **9 概念能力带**（每格可点击直达落点，一眼可见全部能力）；全程走 CSS 变量与 `prefers-reduced-motion` 降级，不改骨架、不加文件 |
| W5.2 缓存击穿 | 修复「发布后界面仍是旧的」：构建期给 index.html 的资源引用注入 `?v=<hash>`（cache-busting），SW 静态资源改网络优先；`contentForHash` 剥离版本串保证版本幂等无循环。模拟残留旧缓存后打开新版，能力带/英雄区全部正常加载 |

> W5 的 9 大概念落地说明见 [`docs/PETOS-CONCEPTS.md`](docs/PETOS-CONCEPTS.md)：逐条写清「概念 → 界面落点 → 工程锚点 → 诚实边界」。

**验证链**：`npm test` 14 套件 · `npm run verify` 49/49 · `npm run test:browser` 91/91 且零控制台报错 · W5 实机 4 场景零异常。硬不变量：12 导航 / `ENTITY_KEYS` 6 个 / `version.json` 35 文件。

**决策与维护文档**：`docs/PLAN-systematic-update.md`、`docs/ADR-001-storage-adapter.md`、`ADR-002-css-single-source.md`、`ADR-003-dual-write-rollback.md`、`.ai-memory/handoff.md`、`docs/harmony-sync.md`、`docs/electron-compat.md`。项目级 Skill 在 `.codebuddy/skills/lifeos-maintainer/`（打包件 `docs/lifeos-maintainer.zip`），内含设计系统规范与发布清单。

**已知限制（如实说明）**：应用无鉴权，依赖网关 `sharecode` · 默认 API Key 仍可能明文存本机（可选「仅本次会话保存」；备份/快照/导入不含密钥）· 网页版文件/命令/JS 执行为隔离演示，不碰本机 · Electron GUI 与鸿蒙 HAP 未图形验证 · 原生日期控件按浏览器语言显示（中文回显消除歧义）· CSS 跨文件重复选择器按 ADR-002 结论保留 · `.md` 全库导出为逐个下载。
