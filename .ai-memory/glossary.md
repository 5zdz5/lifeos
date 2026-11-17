# LifeOS 术语表

> 统一项目内说法，避免同一个东西多种叫法导致改错文件。

| 术语 | 含义 / 位置 |
|---|---|
| **LifeOS / 识海** | 本项目；「识海」原为独立长期记忆模块，已集成进 LifeOS（`src/js/mindsea.js`、`src/js/modules/mindsea.js`） |
| **sharecode** | 网关访问凭据，URL 查询参数 `?sharecode=...`；删掉打不开。应用本身**无鉴权** |
| **版本戳 `v<hash>`** | 由 33 个源码文件（含 `sw.js` 逻辑）算出的 8 位 hash，写进 `version.json` / `js/version.js` / `sw.js` 的 `CACHE`；URL 里的 `v=` 只用于 bust 缓存，不是部署开关 |
| **SW / Service Worker** | `src/sw.js`；`AUTO` 区块的 `CACHE` 名与 `ASSETS` 清单由 `build-standalone.js` 依据源码 hash 生成，不要手改 |
| **49 项一致性** | `verify-release.js` 对 `version.json` 里 35 个文件逐文件 `arrayBuffer()` 字节比对 + 版本/缓存/12 导航等检查，合计 49 项 |
| **存储三态** | `legacy`（仅 localStorage）/ `dual`（默认：localStorage 同步权威 + IDB 异步镜像）/ `idb`；`src/js/storage.js` |
| **双写灰度** | 新旧存储并行写、可随时切回；`localStorage` 的 `lifeos-*` 键**永不删除** |
| **Q3 硬卡** | 需求锁定阶段对「数据迁移 / 凭据」类风险设的强制门禁：迁移前强制导出备份 + 一键回滚 + 失败即停 |
| **S3 四判据** | 全绿 / 零控制台报错 / 逐张视觉回归 / 新功能各有断言 |
| **handoff / CHECKPOINT** | `.ai-memory/handoff.md`；每 Wave 结束落检查点，每 5 文件一个 CHECKPOINT |
| **Wave（W0–W4）** | 系统化更新的五个阶段：回滚基线 / 地基 / 知识内容 / 视觉动效 / 交付沉淀 |
| **六槽位（S1–S6）** | 方案锁定卡的六个需求槽：工程治理 / 知识内容 / 视觉动效 / 交付文档 / 数据 / 回滚 |
| **CSS 双层** | `style.css` 基础层 + `finesse.css` 覆盖层；跨文件重复选择器是**有意层叠覆盖** |
| **CSS 单源** | `tools/build-css.js` 零依赖确定性合并 → `src/css/app.css`（生成物，禁止手改） |
| **wikilink** | `[[目标]]` / `[[目标\|别名]]` 双向链接语法；索引在 `src/js/links.js` |
| **反链 / 未链接提及** | `backlinks()` / `unlinkedMentions()`；W2 增加 `backlinkContexts()` 给出引用原文片段 |
| **Daily Notes** | 每日笔记 = 普通笔记加 `daily:true` 与 `tags:['daily']`，是 notes 模块第三视图，**不是新实体** |
| **Markdown Vault** | `src/js/vault.js`；YAML frontmatter + `.md` 往返，保留 `[[wikilink]]` 文本 |
| **全局检索** | 跨 6 类实体聚合（笔记/知识库/任务/日程/AI 对话/识海），顶栏按钮 + `Ctrl/⌘+K`，`search.js` + `modules/search.js` |
| **ENTITY_KEYS** | `src/js/store.js` 的 6 个顶层实体键；改动会同时打断备份/导入/统计链，硬断言锁定为 6 |
| **12 导航** | `index.html` 的 `data-view` 数量，`verify-release.js` 与 `browser.test.js` 硬断言为 12 |
| **SECRET_SETTING_KEYS** | `['aiKey', 'aiBaseUrl']`；导出/快照/导入一律脱敏，外部数据不能覆盖本机密钥 |
| **会话密钥模式** | `aiKeySessionOnly`，密钥只进 `sessionStorage` 的 `lifeos-session-key` |
| **motionOK / stagger / countUp** | `src/js/utils.js` W3 统一动效工具；`stagger` 是所有交错动效的唯一来源，`countUp` 当前未挂载统计卡 |
| **reduced-motion** | `prefers-reduced-motion`；所有入场动画包在 `no-preference` 内，必须有配对 `reduce` 归零块 |
| **权威统计数字** | `.hs-num` / `.gs b` 等真实统计值；**不做数值缓动、不做交错隐藏** |
| **波浪点亮 / 描边生长** | 热力图按列 `--hm-wi` 交错入场；图谱 `--g-len` + `stroke-dashoffset` 生长 |
| **视觉回归 11 张** | 深/浅总览、笔记、图谱、日历、热力图、设置、320px + 3 张动效静帧；`SHOTS_SET=w3` |
| **PRR 式发布门禁** | 借鉴 `dev-expert`：构建 → 一致性 → 回归 → 视觉 → 留证据，失败即停 |
| **finesse 五轴 / Codex 信任层** | 早期 UI 重构引入的设计系统；`.finesse/log.json` 与 `index.html` meta 构建戳 |
| **huashu 六种做坏方式** | 视觉自查：新硬编码色 / 权威数据动画 / 常驻无限循环 / 忘了 reduced-motion / 各写一套 rAF / 窄屏溢出 |
| **rawfile** | 鸿蒙 `entry/src/main/resources/rawfile/lifeos/`，由 `build-standalone.js` 自动同步 36 个文件 |
| **standalone** | `src/standalone.html` 与 `dist/lifeos.html`，把 CSS/JS 全内联的单文件版本 |
