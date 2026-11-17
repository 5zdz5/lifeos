# LifeOS 系统化更新方案

> 基线：`v4338f7b4`（2026-11-11 09:28 UTC） · src 30 文件 / 14,439 行 / 21 个 JS 模块 / 10 个测试套件（326 条断言）
> 状态：**需求已锁定（LOCKED）** · 本轮用户选择「先出完整方案，暂不改码」 · 判档 **Q3 硬卡**（数据迁移 + 凭证）
> 依据：`dev-expert` 六步闭环 / Step 1.5 需求锁定门控 / Wave 拆解 + handoff；`obsidian` 纯文本与 wikilink 方法论；`huashu-art-motion` 一致性自查；`skill-creator` init/package 流程

---

## 0. 需求锁定卡（六槽位，全部非空）

| 槽位 | 锁定内容 |
|---|---|
| **S1 目标** | 系统化更新：B 知识（反链面板、Daily Notes、Markdown 互通、全文检索）+ C 视觉（微交互与一致性、数据可视化动效），底层配套引入构建工具、迁 IndexedDB |
| **S2 边界** | **In**：`src` 基线、Electron 桌面端兼容验证、鸿蒙配置主动更新、新建项目级 skill 与设计系统 references、ADR 与 `.ai-memory`。**Out**：真出 MP4 介绍短片、TypeScript 类型化、Electron 数据层重写、鸿蒙 API 版本升级、引入未审查第三方依赖 |
| **S3 验收** | ① 10 套件 + 42 浏览器回归 + 43 发布一致性全绿 ② 零控制台报错 ③ 逐张视觉回归人工比对零破损 ④ 每个新功能各有对应断言 |
| **S4 约束** | Q3 硬卡；单文件离线版 `dist/lifeos.html` 仍可生成；`sharecode` 网关行为不变；遵守 `prefers-reduced-motion`；不引入未过审查门禁的依赖；旧 CSS 类名保留兼容层 |
| **S5 数据** | localStorage → IndexedDB **双写灰度**（`legacy`/`dual`/`idb` 三态），新旧并行、`lifeos-data` 可回退；快照/备份格式与导入导出兼容；API Key 随迁移加固（会话模式升级） |
| **S6 回滚** | 双写灰度 + 一键回滚开关；迁移前强制导出备份兜底；每 Wave 落 `handoff.md` 检查点；构建或回归失败即停 |

**方案内默认决策（已定，不作为待确认项）**：反链放笔记编辑器侧栏；Markdown 重命名走 `links.js` 索引批量改写；统一检索为顶部全局面板；skill 放 `.codebuddy/skills/lifeos-maintainer`（项目级）；CSS 合并保留全部旧类名；鸿蒙只改配置注释与资源声明、不升 SDK 版本。

---

## 1. 影响面分析（只读探查结论）

### 1.1 数据层：IndexedDB 迁移不是改两行

`localStorage` 实际分布在 **8 类键、约 20 处调用**，必须做统一适配层，不能只改 `bridge.js` 的 `load/save`：

| 键 / 用途 | 位置 | 迁移策略 |
|---|---|---|
| `lifeos-data` 主状态 | `bridge.js:398,421` | 双写核心；`load` 优先 IDB、回落旧键 |
| `lifeos-snapshots` 快照（3.5MB 上限） | `store.js:385-460` | 迁 IDB 后解除字符串容量上限，需保留 8 份节流与脱敏逻辑 |
| `lifeos-mindsea` 识海库 | `mindsea.js:24,31` | 独立 object store，桌面端仍走 SQLite 不受影响 |
| `lifeos-vfs` 虚拟工作区 | `bridge.js:147-155` | 演示数据，随主状态一起双写 |
| Codex 偏好 / 任务 | `codex.js:45-77` | 低风险，一并纳入适配层 |
| `lifeos-seeded` 示例标记 | `seed-library.js:218,236` | 布尔标记，保持双写 |
| 备份提醒标记 | `app.js:189,256`、`settings.js:238` | 保持双写 |
| `lifeos-sw-reload` | `app.js:288-289` | **sessionStorage，不迁**（会话级语义） |

**关键约束**：Node 测试环境无 `indexedDB`。适配层必须有能力探测 + 自动降级，否则 10 个套件全挂。浏览器回归需新增三态切换断言。

### 1.2 构建链：最大冲突点

现有 `build-standalone.js` 把五件事强耦合：① 硬编码 `jsFiles`（21 个）拼接内联 ② `style.css + finesse.css` 直接字符串拼接 ③ 自动生成 `sw.js` 的 CACHE 名与 ASSETS 清单 ④ 按 src 全文件内容算 8 位版本 hash ⑤ `version.json` 记录全文件 hash 供 `verify-release.js` 做 43 项线上一致性校验，并 `cpSync` 同步鸿蒙 rawfile。

**方案决策（避免破坏校验链）**：引入 `esbuild` 但**只让它参与 CSS 产物**——把 1639 行双层 CSS 按「finesse 覆盖优先、style 基础保留」的确定性顺序合并为单一 `app.css`，旧类名全部保留（兼容层），只消除重复与冲突定义。JS 仍由 `build-standalone.js` 按清单内联，版本 hash / SW 清单 / 43 项校验 / 单文件离线版机制完全不动。

- `esbuild` 引入前须过 `dev-expert` 威胁建模的**依赖审查门禁**（作者、维护度、MIT 许可、已知漏洞、lockfile 锁定）；审查不通过则降级为自研零依赖 Node 合并脚本，方案不变。
- 产物链：`npm run build` → `tools/build-css.mjs` 产出 `src/css/app.css` → `node build-standalone.js` 内联并更新 SW/版本 → `node verify-release.js` 43 项校验。
- `index.html` 的 `<link>` 改为只引 `app.css`；`standalone.html` 由构建脚本注入同一份内容。

### 1.3 知识功能：已有地基，不要重复造轮子

`src/js/links.js` **已实现** `extract / resolve / outbound / backlinks / edges / graph / orphans`；`notes.js:81,156` 已渲染链接列表。因此：

- **B1 反链面板**＝审计 `backlinks()` 是否已在 UI 使用，补齐缺失展示与跳转，不是重写索引。
- **B3 Markdown 互通**＝新增序列化 + 基于 `links.js` 的 wikilink 批量重命名（对齐 `obsidian-cli move` 的安全重构语义），导入仍走现有 `cleanEntity/cleanUrl/parseImport` 清洗链。
- **B2 Daily Notes**＝复用 `calendar.js` 的 `dayDetail`/`events` 与笔记 `createdAt`，新增按日视图，不新增顶层实体（避免 `ENTITY_KEYS` 与备份链改动）。
- **B4 全文检索**＝跨 notes / library / mindsea 的统一面板；识海已有 `ms-search`，做聚合而非替换。

### 1.4 视觉动效基线

| 文件 | transition | animation | @keyframes | prefers-reduced-motion |
|---|---|---|---|---|
| `style.css` | 8 | 2 | 2 | 0 |
| `finesse.css` | 7 | 3 | 2 | 2 |

C2/C4 在既有基线上收敛与扩展，不新建第二套动效体系；`style.css` 侧补齐 `prefers-reduced-motion` 降级。按 `huashu-art-motion`「一套色板一种画风」与「六种做坏方式」自查：不引入蓝紫渐变、不每镜换风格、不做翻页式反馈。

### 1.5 桌面端与鸿蒙

- **Electron**：`main.js:38-52` 用 `fs.readFileSync/writeFileSync` 落 `userData/lifeos-data.json`。用户选「仅验证」→ 本轮**不改逻辑**，网页版迁 IDB 后两端数据层分叉是既有事实的延续，作为已知限制记入 ADR；只做 `node --check` 四个主进程文件 + 启动冒烟。
- **鸿蒙**：`build-profile.json5`（`compatibleSdkVersion: 5.0.0(12)`）与 `entry/build-profile.json5`。用户选「主动改」→ 更新 SDK 版本注释、补齐 rawfile 资源声明与同步说明文档；**不擅自升 API 版本**（需 DevEco 图形验证，本轮不具备）。

---

## 2. Wave 拆解

> 规则：每 Wave 结束落 `.ai-memory/handoff.md`（已完成项带证据 / 相关文件 / 未完成项 / 阻塞项）；每 5 文件一个 CHECKPOINT；单 Wave 失败回滚后其余继续；已验证 Wave 产出物不回退清零。
> **开工第 0 步**：`cp -a src .rollback/src-w0` 并记录全文件 hash，作为一键回滚基线。

### W1 · 地基（最高风险，先做）

| 项 | 文件 | 说明 |
|---|---|---|
| 回滚基线 | `.rollback/src-w0` | 开工前建立 |
| 存储适配层 | 新增 `src/js/storage.js` + 改 `bridge.js` / `store.js` / `mindsea.js` / `codex.js` / `seed-library.js` / `app.js` / `settings.js` / `library.js` | 统一 `get/set/remove`，三态灰度开关 `lifeos-storage-mode`，能力探测自动降级；双写期间 `localStorage` 始终保留 |
| 迁移与回滚 | `storage.js` + `settings.js` | 迁移前强制导出备份；设置页「切回旧存储」+ URL `?storage=legacy` 双入口；密钥随 IDB 加固 |
| 构建工具 | 新增 `tools/build-css.mjs`、`package.json`、改 `index.html` / `build-standalone.js` | esbuild（或零依赖降级脚本）合并 1639 行 CSS 为 `app.css`，保留全部旧类名 |
| 测试 | `tests/storage.test.js`（新）+ 既有套件 | 三态切换、降级、双写一致性、回滚后数据不丢、导入导出兼容 |

**验证**：`npm test` 全绿（新增第 11 套件）· `npm run build && node build-standalone.js && node verify-release.js` 43 项 · 浏览器回归加 6 条存储断言 · 深/浅色截图各 1 张。
**回滚点**：任一失败 → 恢复 `.rollback/src-w0` + 重建 + 43 项校验。

### W2 · 知识内容（B1–B4）

`modules/notes.js`（反链侧栏）· `links.js`（新增 wikilink 批量重命名）· 新增 `modules/daily.js`（按日视图，注册到导航与 `ENTITY_KEYS` 评估）· 新增 `modules/search.js`（全局检索面板）· `utils.js`（Markdown 序列化）· `app.js`（导航与快捷键）。

**验证**：每功能 ≥3 条断言 + 浏览器回归（反链跳转、Daily Notes 与日历联动、.md 导入导出往返、重命名改写链接、检索命中）· 10 套件 + 43 一致性全绿 · 截图 4 张。

### W3 · 视觉与动效（C2 + C4）

`css/app.css`（收敛后的单一来源）· `finesse.css`（兼容层别名）· `style.css`（补 reduced-motion）· `modules/heatmap.js` / `graph.js`（数据动效）· `utils.js`（统一动效工具）。

**验证**：**逐张视觉回归清单**（总览深色/浅色、笔记、图谱、日历、热力图、设置、320px 窄屏、动效静帧 3 张 = 11 张）人工比对零破损 · `prefers-reduced-motion` 模拟下无动效 · 控制台零报错。

### W4 · 交付沉淀

`.codebuddy/skills/lifeos-maintainer/`（`init_skill.py` 生成 → SKILL.md + `references/design-system.md` + `scripts/release.sh` → `package_skill.py` 校验打包）· `docs/ADR-*.md`（存储迁移、CSS 合并、双写灰度三项决策 + 撤销条件）· `.ai-memory/`（会话摘要、术语表、判断回溯录）· 鸿蒙两份 build-profile 配置与同步说明 · Electron 兼容验证记录 · README 更新。

**验证**：skill 打包校验通过 · 四个主进程文件 `node --check` · 鸿蒙 json5 语法检查 · 43 项一致性 · 全量浏览器回归 42+ 条 · 二维码与新版本链接刷新。

---

## 3. 风险与回滚（Q3 硬卡）

| 风险 | 缓解 | 回滚动作 |
|---|---|---|
| IndexedDB 迁移丢数据 | 双写灰度三态 + 迁移前强制导出 JSON + 新旧并行读 | 设置页 / URL 一键切 `legacy`，旧 `lifeos-data` 始终未删 |
| 构建链破坏 43 项校验 | esbuild 只参与 CSS；JS 内联与 hash 机制不动 | 恢复 `.rollback/src-w0` 重建 |
| CSS 合并视觉破损 | 保留全部旧类名、确定性覆盖顺序、W3 逐张比对 | 回退单文件 `link` 引回两份原 CSS |
| 新增实体破坏备份链 | Daily Notes 不新增顶层实体；如需新增则同步 `ENTITY_KEYS` + `parseImport` + `counts` | W2 检查点回退 |
| 依赖供应链 | esbuild 过审查门禁；不通过则零依赖脚本降级 | 不引入即可 |
| 桌面端/鸿蒙不可图形验证 | 只做语法与兼容检查，如实列为已知限制 | 不发布未验证声明 |

**失败即停条件**：任一 Wave 出现 ① 43 项一致性失败 ② 浏览器回归任一失败 ③ 控制台报错 ④ 视觉比对破损 → 立即停止后续 Wave，回滚到该 Wave 起点。

---

## 4. 验收矩阵（S3 四条可执行判据）

| 判据 | 证据 | 命令 |
|---|---|---|
| ① 全绿 | 11 个 Node 套件 + 浏览器回归 + 43 项一致性 | `npm test` / `npm run test:browser` / `node verify-release.js` |
| ② 零控制台报错 | 浏览器回归 `errs.length === 0` | 同上（浏览器套件 E 段） |
| ③ 逐张视觉回归 | 11 张截图 + 比对结论 | Playwright 截图脚本 + 人工比对记录 |
| ④ 新功能各有断言 | 每功能 ≥3 条，测试文件清晰可查 | `grep -c "ok(" tests/*.test.js` |

---

## 5. 发布路径（渐进，非一把梭）

1. 本地 3000 服务自检 → 43 项一致性通过
2. 生成新版本戳 `v<hash>`，先给**新链接**小范围观察（旧 `v4338f7b4` 链接保留作为对照）
3. 观察项：SW 更新是否正常、双写灰度状态、控制台零报错、视觉截图
4. 全量切换：更新二维码与文档链接
5. **回滚条件预写**：出现第 3 节任一失败即停 → 恢复 `.rollback/src-w0` → 重建 → 43 项校验 → 确认旧链接可用
6. 发布后写 `handoff.md` 与 ADR，沉淀到 `.ai-memory`

---

## 6. 明确不做（Out）

真出 MP4 介绍短片（huashu 重流程未选）· TypeScript 类型化 · Electron 数据层重写 · 鸿蒙 API 版本升级 · 引入未审查第三方依赖 · 主动改动 `sharecode` 网关 · 删除旧 CSS 类名 · 新增顶层数据实体（除非 W2 评估后同步全链路）。

---

## 7. 四个 Skill 的落地位置

| Skill | 本方案落地 |
|---|---|
| `dev-expert` | Step 1.5 需求锁定卡、Step 2 影响面/规划门禁、Wave + handoff、Step 4 证据矩阵、Step 5 PRR 式发布门禁、Step 6 ADR 与 `.ai-memory` |
| `obsidian` | 纯文本 `.md` 互通、`links.js` wikilink 安全批量重命名、Daily Notes；**不引入 `obsidian-cli`**（macOS 桌面工具，沙箱不适用） |
| `huashu-art-motion` | 「一套色板一种画风」一致性治理、「六种做坏方式」自查、微动效节奏；**不启用** uv/ffmpeg/MP4/独立审片 |
| `skill-creator` | W4 真跑 `init_skill.py` 与 `package_skill.py`，SKILL.md 保持精简、细节进 `references/` |

---

## 8. 执行前置

本方案确认后，第一步是**建立 `.rollback/src-w0` 回滚基线**，然后进入 W1。W1 未完成前不启动 W2；每个 Wave 结束附验证证据与 handoff 检查点。
