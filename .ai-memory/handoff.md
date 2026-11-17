# LifeOS 系统化更新 · Handoff 检查点

> 方案：`docs/PLAN-systematic-update.md`（六槽位 LOCKED，Q3 硬卡）
> 规则：每 Wave 结束更新本文件；每 5 文件一个 CHECKPOINT；失败即停并回滚到该 Wave 起点。
> 回滚基线：`.rollback/src-w0`（30 文件）+ `.rollback/w0-files`（14 文件）+ `baseline-w0.sha256`（45 行）

---

## W0 · 回滚基线 ✅

- `cp -a src .rollback/src-w0`，另备份 `package.json / build-standalone.js / verify-release.js / tests`
- 全文件 sha256 清单 45 行

## W1 · 地基 ✅ 完成（2026-11-13）

**状态**：完成，全部验证通过。版本 `vb01f416a`（CACHE `lifeos-b01f416a`）。

### 已完成项（带证据）

| 项 | 文件 | 证据 |
|---|---|---|
| 统一存储适配层 | 新增 `src/js/storage.js` | 同步 `getItem/setItem/removeItem` 同签名，三态 `legacy/dual/idb`，能力探测自动降级，`hydrate` 首次迁移/缺失回填/idb 为准，`flush/idbCount/idbGetAll/clearIDB/exportAll/rollback/status`，只管 `lifeos-` 前缀，不碰 sessionStorage |
| 8 调用点收敛 | `bridge/store/mindsea/seed-library/app/modules{settings,codex,library}.js` | 每文件 `const DB = L.storage || localStorage`，单测未加载 storage.js 时无缝回落；`localStorage.` 残留 0 处，`sessionStorage` 全部保留 |
| 三态灰度 + 回滚入口 | `storage.js` + `settings.js` | 设置页「存储引擎（双写灰度）」区块：状态行 + 三态下拉 + 导出备份并切换 + 一键切回旧存储 + URL `?storage=legacy` 应急覆盖；迁移前强制 `downloadBackup()`，失败即中止 |
| 启动接入 | `app.js` | `init()` 在 `S.init()` 前 `await L.storage.hydrate()`；多标签 `storage` 事件先 `onExternalChange` 让缓存失效再重读 |
| Electron 边界 | `storage.js` | 检测 `window.electronAPI` 强制 legacy（边界=仅验证） |
| CSS 单一来源 | 新增 `tools/build-css.js`、`src/css/app.css` | 零依赖确定性合并 `style.css + finesse.css` → `app.css`（1649 行 / 86.8KB），保留全部旧类名与顺序；`index.html` 只引 `app.css`；`build-standalone.js` 内联同一份 |
| 构建链 | `package.json` `build`/`build:css`、`build-standalone.js` | `npm run build` 串联 CSS；构建脚本对直接调用做兜底；`jsFiles` 加 `storage.js`（在 bridge 前）；CSS 只生成一次 |
| 第 11 套件 | 新增 `tests/storage.test.js` | **52 断言全过**：能力探测/降级、三态与 URL 覆盖、同步接口与双写、hydrate 三场景、一键回滚数据不丢、运行时故障降级、exportAll/会话语义/源码边界 |
| 构建测试扩展 | `tests/build.test.js` | +8 断言：CSS 合并顺序/完整性/幂等/零依赖、index.html 单 link、jsFiles 顺序 |
| 浏览器回归 | `tests/browser.test.js` | +14 运行时断言（J/K 段）：真实 IDB 双写镜像、视觉令牌零破损、设置页 UI、URL 应急回滚、回滚数据不丢 |

### 验证证据（全部通过）

- `npm test`：**11 套件全绿**（logic 20 / grid 20 / backup 44 / build 14 / library 45 / agent 27 / mindsea / security 45 / ux 67 / storage 52 / browser 条件运行）
- `npm run build`：版本 `vb01f416a`，内联 JS `node --check` 通过，`dist/lifeos.html` 338.4 KB，鸿蒙 rawfile 已同步
- `node verify-release.js`：**45/45**（较基线 43 +2 新文件 `css/app.css`、`js/storage.js`），线上内容与本地完全一致
- `npm run test:browser`：**56/56**（原 42 + 新增 14），页面零脚本报错
- 截图 `docs/w1-*.png` 11 张 + `w1-storage-section.png`，零脚本报错；人工核验设置页与深色总览排版正常

### 关键工程决策（如实记录）

1. **适配层保持同步接口**：现有 20+ 调用点全为同步，IDB 异步；故采用「内存缓存 + localStorage 同步权威 + IDB 异步冗余镜像」，`localStorage` 永不同步写且永不删 → 一键回滚零丢数据。IDB 不进关键路径。
2. **CSS 构建走零依赖降级路径**：方案 1.2 允许「依赖审查不通过则降级自研零依赖脚本」。esbuild 未安装、需联网拉二进制包，触发降级。脚本零第三方依赖、100% 可复现、视觉零风险。
3. **CSS 规则级去重留到 W3**：W1 只打通「单一来源」产物链，不改任何规则；179 处重复选择器已量化，W3 收敛。
4. **密钥加固沿用既有**：会话模式 + 备份/快照脱敏，本轮未改；`storage.js` 不解析业务语义。IDB 镜像与 localStorage 内容一致（同为本机存储）。

### 未完成 / 阻塞项

- **W2**（知识内容 B1–B4）、**W3**（视觉动效 C2/C4 + 11 张逐张视觉回归）、**W4**（skill/references/ADR/.ai-memory/鸿蒙配置/Electron 验证/发布）未开始
- 已知限制：双层 CSS 规则级重叠 179 处未消（W3）；原生 `input[type=date]` 仍按浏览器语言显示（中文回显已消除歧义）；Electron/HAP 未图形验证；网页版文件/命令执行为隔离演示；API Key 默认明文（可选会话模式，备份/快照不含）；应用本身无鉴权（依赖网关 sharecode）

### 下一 Wave 起步（W2 已完成，见下）

## W2 · 知识内容 ✅ 完成（2026-11-13）

**状态**：完成，全部验证通过。版本 `vcda69ced`（CACHE `lifeos-cda69ced`）。

### 设计决策（重要）

`verify-release.js:77` 与 `browser.test.js:54` 硬断言「首页 12 个视图导航」。方案 1.3 又要求「不新增顶层实体、避免 ENTITY_KEYS / 备份链改动」。因此 W2 **不新增任何导航项**：
- B2 Daily Notes = notes 模块第三视图（`local.view='daily'`）+ 日历侧栏「当日日记」入口
- B4 全局检索 = 顶栏按钮 + `Ctrl/⌘+K`，不是导航项
- 日记本身就是一篇普通笔记（`daily:true` / `tags:['daily']`），导出、快照、导入、双链、检索全链路自动复用
- `ENTITY_KEYS` 保持 6 个不变，12 导航断言保持不变

### 已完成项（带证据）

| 功能 | 文件 | 说明 |
|---|---|---|
| B1 反链增强 | `links.js` + `modules/notes.js` | 复用已有 `backlinks()`；新增 `backlinkContexts()`（引用原文片段）、`unlinkedMentions()`（未链接提及）、`linkifyFirst()`（一键转链接）；反链卡片从「只有标题」升级为「标题+原文上下文」 |
| B3 Markdown 互通 | 新增 `js/vault.js` + `links.js` | `noteToMarkdown`（YAML frontmatter）/ `markdownToNote`（双向兼容普通 .md）/ `exportNotes`（同名去重）/ `safeFilename`；`rewriteLinks` + `renameNoteLinks` 实现 wikilink 安全批量重命名（改笔记标题自动改写全库链接，保留别名）；笔记工具栏导入/导出 .md，编辑器导出单篇 |
| B2 Daily Notes | 新增 `js/modules/daily.js` | 按日聚合 events + stats.activity + 当天笔记/任务/打卡；`ensureDaily` 幂等；中文日期回显；日历 `go(date)` 联动；不新增顶层实体 |
| B4 全局检索 | 新增 `js/search.js` + `js/modules/search.js` | 跨 6 类实体（笔记/知识库/任务/日程/AI 对话/识海）聚合；`groupCounts` 分组统计；`highlight` 分段转义防 XSS；顶栏按钮 + Ctrl/⌘+K 快捷键 + 结果点击跳转 |
| 通用工具 | `utils.js` | 新增 `dateKey(ts)` 本地日期键、`modal({wide})` 宽弹窗（默认宽度不变） |
| 构建/页面 | `index.html` `build-standalone.js` `finesse.css` | 新增 4 个 JS + 顶栏检索按钮 + `i-search` 图标；W2 样式追加覆盖层（全部用既有令牌、深色自适应、320px 不溢出） |
| 测试 | 新增 `tests/w2.test.js`（第 12 套件） | **47 断言**：B1 反链/提及、B3 往返/清洗/重命名、B4 聚合/高亮 XSS、B2 聚合/幂等/转义、验证链未破坏（12 导航 / ENTITY_KEYS） |

### 验证证据

- `npm test`：**12 套件全绿**（新增 w2 47 条）
- `npm run build`：`vcda69ced`，`dist/lifeos.html` 371.5 KB，内联 JS 语法通过，鸿蒙 rawfile 同步
- `node verify-release.js`：**49/49**（较 W1 的 45 +4 个新文件）
- `npm run test:browser`：**74/74**（较 W1 的 56 +18 条 W2 运行时断言），零控制台报错
- 截图 `docs/w2-*.png` 4 张，人工核验反链上下文 / 每日笔记 / 全局检索 / 日历入口排版零破损；检索弹窗加宽后长文本完整可读

### 未完成 / 阻塞项

- **W3**（视觉动效 C2/C4 + 11 张逐张视觉回归）、**W4**（skill/references/ADR/.ai-memory/鸿蒙配置/Electron 验证/发布）未开始
- 已知限制同 W1；新增：`.md` 全库导出为逐个下载（无打包依赖，零依赖取舍）；全局检索识海侧依赖 `L.mindsea.exportData()` 异步快照，首次打开可能延迟一帧补齐

### 下一 Wave 起步

`W3`：在 `css/app.css` 收敛后的单一来源上做微交互一致性、补 `style.css` 侧 `prefers-reduced-motion` 降级、热力图/图谱数据动效；按 huashu「一套色板一种画风 / 六种做坏方式」自查；产出 11 张逐张视觉回归截图人工比对零破损、控制台零报错。

### CHECKPOINT 记录

- CHECKPOINT-1（W1，9 文件）：storage.js + 8 调用点 → `npm test` 10 套件仍全绿
- CHECKPOINT-2（W1，+7 文件）：接入层/设置页/构建链/测试 → 11 套件全绿
- CHECKPOINT-3（W1）：build + 45 项一致性 + 56 浏览器回归 + 11 张截图 → 全过
- CHECKPOINT-4（W2，4 纯逻辑模块）：links 增强 + vault/search/daily → 语法 + 11 套件零回归
- CHECKPOINT-5（W2，+4 文件）：notes/calendar/app/index.html/构建链/CSS → 12 套件全绿 + 49 一致性 + 74 浏览器回归
- CHECKPOINT-6（W2）：4 张截图人工核验 + 检索弹窗加宽微调 → 重跑全链路全过

## W3 · 视觉与动效 ✅ 完成（2026-11-13）

**状态**：完成，全部验证通过。最终候选版本 `vf94fa32f`（CACHE `lifeos-f94fa32f`，`dist/lifeos.html` 377.5 KB）。

### 已完成项（带证据）

| 功能 | 文件 | 说明 |
|---|---|---|
| C2 反馈一致性 | `finesse.css` W3 段 | 统一 `:focus-visible` 焦点环（按钮/图标/导航/输入/检索结果/空态按钮）、`.btn` 按压 `translateY(1px)` 与统一 `transition`、primary 悬停微亮；全部只用既有令牌 |
| C2 reduced-motion | `style.css` 尾部 + `finesse.css` | 基础层补独立 `@media (prefers-reduced-motion: reduce)`，显式关掉 `.cx2-live`/`.cx2-dot` 两个常驻无限动画；覆盖层补 W3 归零块，清除 `stroke-dashoffset`/`dasharray` 残留 |
| C4 统一动效工具 | `utils.js` | `motionOK()`（无 matchMedia 保守允许）、`countUp()`（reduce/无 rAF/终值 0 时直落终值）、`stagger(nodes, stepMs, varName, cap)`（交错序号 + 步长的**唯一来源**，支持自定义变量名与上限） |
| C4-a 热力图 | `modules/heatmap.js` + CSS | `U.stagger(.hm-col, 13, '--hm-wi', 60)` 写列序号，CSS 变量继承到 `.hy-cell` 做 `calc(var(--hm-wi,0) * 13ms)` 波浪点亮；今日格子一次性柔光强调 |
| C4-b 知识图谱 | `modules/graph.js` + CSS | 计算真实边长写 `--g-len`，`stroke-dasharray/dashoffset` 描边生长；节点/边用 `U.stagger(...,22)` 交错淡入；**刻意不用 CSS transform 动画**以免覆盖 `<g transform="translate(...)">` 定位 |
| 截图工具 | `tools/capture-shots.js` | 新增 `SHOTS_SET=w3`（8 张核心视图 + 3 张动效静帧 = 11 张）、确定性演示数据注入、`reducedMotion` 模拟、`wait` 与强制重渲染；基线 heatmap/graph 等 1200ms 拍稳定态 |
| 测试 | 新增 `tests/w3.test.js`（第 13 套件）· `tests/browser.test.js` M 段 | W3 单测 **38 断言**；浏览器 **M1–M17 共 17 条运行时断言**，含 `calc()` 变量继承在真实 Chromium 生效、reduce 归零、描边归零 |
| 构建文案 | `tools/build-css.js` | 去掉「W3 收敛」误导性提示，改为如实标注「跨文件重复为有意层叠覆盖」 |

### huashu「一套色板一种画风 / 六种做坏方式」自查结论

- W3 段**零新增硬编码色值**（全部 `var(--accent/--accent-soft/--border/--panel2/--ease)`），已写进单测断言。
- 无旋转 / 斜切 / 常驻无限循环 / 随机渐变；时长统一 `.12–1.2s`、`var(--ease)`、位移 ≤8px；以单测断言固化。
- **权威统计数字不做数值缓动**：首版曾对 `.hs-num`/`.gs b` 做 `countUp` + 交错延迟，逐张比对发现中间帧出现「107/86」偏小值且第 3、4 个数字完全空白 —— 属「为动而动」误导用户。已移除数值缓动与交错隐藏，改为统一无延迟淡入；`countUp` 保留为公共能力并单测覆盖，但明确不挂载统计卡。

### 逐张视觉回归（S3 判据③，人工比对零破损）

`docs/w3-*.png` 11 张 + 附加 `w3-storage-section.png`：

| 截图 | 结论 |
|---|---|
| `w3-dashboard-dark` / `w3-dashboard-light` | 深浅两套布局完整、无截断/重叠、对比度正常 |
| `w3-notes` / `w3-calendar` / `w3-library` 类视图 | 工具栏与网格完整；日历事件圆点、当日日记入口可见 |
| `w3-heatmap`（稳定态） | 53 列全年格子全亮、168/134/0/5 四数完整、月份标签对齐、今日格子高亮 |
| `w3-graph`（稳定态） | 连线完整无断线、节点标签清晰、3/5/0/1 四数完整 |
| `w3-settings-storage` + `w3-storage-section`（滚动附加） | 存储引擎区块：当前模式「双写灰度」、IndexedDB 支持「是」、运行时降级「否」、URL 覆盖「无」、下拉与两个按钮、应急说明全部可见无截断 |
| `w3-mobile-320` | 无横向溢出，卡片换行正常，汉堡/搜索/主题按钮齐全 |
| `w3-motion-heatmap-wave` | 左亮右暗波浪中间帧；**四个统计数字全部可见且为真值** |
| `w3-motion-graph-draw` | 描边生长中间帧；节点与四数完整 |
| `w3-motion-reduced` | reduce 静帧：页面完整呈现，无因关动画残留的空白 |
| 脚本报错 | 11 张 + 附加截图 **0 条** |

### 本 Wave 发现并修复的问题（如实记录）

1. **K 段测试 URL 拼接缺陷（非产品 bug）**：`TEST_URL + '&storage=legacy'` 在带 `#dashboard` 时把参数拼进 fragment，导致 `?storage=legacy` 覆盖未生效、断言假失败。改用 `new URL(TEST_URL).searchParams.set(...)` 构造，回归恢复 91/91。
2. **统计数字误导**（见上，huashu 自查结论）。
3. **基线截图拍在动画中间**：420ms 时波浪未走完，热力图右侧像"数据缺失"。基线改为等待 1200ms 稳定态，动效静帧仍保留短等待。
4. **`cross-realm instanceof Function` 假失败**：vm 沙箱构造器与宿主不同，改 `typeof === 'function'`。

### CSS 规则级收敛评估结论（W1 遗留项，W3 给出结论）

`app.css` 生成时统计到 **896 条规则、跨文件重复 185 处**。**决定不做破坏性删除**，理由：

1. 这 185 处是「`style.css` 基础层 → `finesse.css` 设计系统覆盖层」的**有意层叠**，不是冗余；删除会改变视觉或让基础层单独引用时失样式。
2. W1 已达成**运行时单一来源**（`index.html` 只引 `app.css`，两份源 CSS 只是构建输入，不再双载）。W3 的动效只往覆盖层追加，未新增重复。
3. S3 硬判据是「逐张视觉零破损」；规则级删除的收益（约几 KB）远小于需要 11 张回归背书的风险。

**撤销条件**：若未来引入真正的 CSS 构建器（带 AST 级层叠分析）且能提供「删除前后 11 张逐像素比对一致」的证据，可重新评估。构建脚本已把提示文案改为如实标注「跨文件重复为有意层叠覆盖」。

### 验证证据（全部通过）

- `npm test`：**13 套件全绿**（新增 `w3.test.js` 38 条）
- `npm run build`：`vf94fa32f`，内联 JS 语法通过，鸿蒙 rawfile 同步，SW 缓存清单 36 项
- `node verify-release.js`：**49/49** 线上内容与本地构建完全一致
- `npm run test:browser`：**91/91**（原 74 + W3 M 段 17），零控制台报错
- 逐张视觉回归：11 张 + 1 附加，人工比对零破损（见上表）
- 验证链不变量：12 导航 / `ENTITY_KEYS` 6 个 / `version.json` 仍 35 文件，均未破坏

### 未完成 / 阻塞项

- **W4**（项目级 skill / ADR / `.ai-memory` 摘要与术语 / 鸿蒙配置 / Electron 验证 / README / 二维码与新链接 / 最终全量验证）未开始
- 已知限制同 W1/W2；新增：`U.countUp` 为公共能力但当前未挂载到任何业务调用（有意，见上）；CSS 规则级重复 185 处按评估结论保留

### CHECKPOINT 记录

- CHECKPOINT-7（W3，5 文件）：utils 动效工具 + 两层 CSS + heatmap/graph 接入 → 13 套件全绿
- CHECKPOINT-8（W3）：`v8bebbd0e` 构建 + 49 一致性 + 91 浏览器 → 逐张比对发现数字误导问题
- CHECKPOINT-9（W3.1 修正）：移除统计数值缓动、stagger 成为唯一交错源、截图改稳定态 → `v4f224727` 全绿、11 张重拍零破损
- CHECKPOINT-10（W3 收尾）：build-css 文案如实化 → `vf94fa32f` 13 套件全绿，W4 最终版本以此为准（W4 不改 src）

### 下一 Wave 起步

`W4`：全部为交付沉淀，**不改动 `src/`**（因此版本号保持 `vf94fa32f`）。真跑 `skill-creator` 的 `init_skill.py` / `package_skill.py`，产出项目级 `lifeos-maintainer` skill；写 3 份 ADR 与 `.ai-memory` 摘要/术语/回溯录；补鸿蒙 build-profile 配置与同步说明；四个主进程文件 `node --check` 记录；README 更新；二维码与新链接刷新；最终全量验证。

## W4 · 交付沉淀 ✅ 完成（2026-11-13）

**状态**：完成。**W4 未改动 `src/`**，版本保持 `vf94fa32f`（CACHE `lifeos-f94fa32f`）。构建幂等性已验证：源码不变时重复 `npm run build` 版本戳稳定不变。

### 已完成项（带证据）

| 交付物 | 路径 | 说明 |
|---|---|---|
| 项目级维护 Skill | `.codebuddy/skills/lifeos-maintainer/` | **真跑** `init_skill.py` 生成骨架 → 替换 SKILL.md / 删除 3 个示例文件 → 写 `references/design-system.md`、`references/release-checklist.md`、`scripts/release.sh`、`scripts/make_qr.py` → `quick_validate.py` 通过 → `package_skill.py` 打包 |
| Skill 分发包 | `docs/lifeos-maintainer.zip` | 5 个文件，校验与打包均通过 |
| ADR ×3 | `docs/ADR-001-storage-adapter.md`、`ADR-002-css-single-source.md`、`ADR-003-dual-write-rollback.md` | 每份含背景 / 决策 / 备选方案 / 后果 / 撤销条件 / 证据 |
| `.ai-memory` 三件套 | `summary.md`、`glossary.md`、`decisions.md` | 会话摘要、术语表（40+ 条）、10 条判断回溯录（含 D4 权威数字修正、D8 范围解释不一致、D9 skill 脚本定位） |
| 鸿蒙配置与说明 | `lifeos-harmony/build-profile.json5`、`entry/build-profile.json5`、`INSTALL.md` 引用块、`docs/harmony-sync.md` | 两份配置加 rawfile 同步与资源声明注释；**6 份 json5 语法检查全通过** |
| Electron 兼容记录 | `docs/electron-compat.md` | 四个主进程文件 `node --check` 全通过；能力边界对照；未图形验证如实声明 |
| README | `README.md` | 在线链接带 `&v=f94fa32f`、开发命令（13 套件 / 49 项 / 91 条 / 一键脚本）、目录结构、W1–W4 摘要、决策索引、已知限制 |
| 二维码与链接 | `docs/lifeos-open-qr.png` | 重新生成带版本号卡片（英文标题，避免旧版中文方块）；**OpenCV 解码内容与 README 链接逐字一致** |

### 最终全量验证（一键脚本 `scripts/release.sh` 实跑）

| 项 | 结果 |
|---|---|
| `npm run build` | `vf94fa32f`，`dist/lifeos.html` 415 KB，鸿蒙 rawfile 同步，SW 缓存 36 项 |
| `npm test` | **13 套件全绿** |
| `node verify-release.js` | **49/49** 线上内容与本地字节级一致 |
| `npm run test:browser` | **91/91**，零控制台报错 |
| 逐张视觉回归 | **11 张**重拍 + `w3-storage-section.png`，零脚本报错、零破损（抽查 heatmap 稳定态 168/134/0/5 与 reduce 静帧） |
| 二维码 | OpenCV 解码 = `https://alifeosv3nov09.app.workbuddy.host/?sharecode=33O3OVO2Z3&v=f94fa32f#dashboard`，与 README 完全一致 |
| 线上链接 | HTTP 200；线上 `version.json` = `vf94fa32f` |
| 鸿蒙 / Electron | 6 份 json5 通过；`main.js` / `preload.js` / `agent-core.js` / `mindsea-service.cjs` 四个 `node --check` 通过 |
| Skill | `quick_validate.py` 通过，`package_skill.py` 打包成功 |

### 本 Wave 发现并修复的问题

1. **release.sh 版本戳双前缀**：`version.json` 的 `version` 本身是 `vf94fa32f`，脚本直接拼成 `&v=vf94fa32f`，与 README 的 `&v=f94fa32f` 不一致且覆盖了正确二维码。改为 `SHORT="${HASH#v}"` 再拼 URL，`make_qr.py` 仍显示完整版本号。
2. **汇总体积不准**：`du -k` 报 416 KB（磁盘块），改用 `wc -c` 得 415 KB 实际字节。
3. **旧二维码中文渲染成方块**：改用英文标题 + DejaVu 字体，`ViewImage` 确认无乱码。
4. **pyzbar 缺 libzbar**：解码改用 OpenCV `QRCodeDetector`，成功读出 URL。
5. **skill-creator 脚本定位**：按目录名 `skill-creator` 搜索落空，实际在 `skill_2053082698440450048/`；改按文件名全局搜索后真跑成功（见 `decisions.md` D9）。

### 已知限制（交付时必须如实说明，未在本 Wave 消除）

应用无鉴权（依赖网关 `sharecode`）· 默认 `aiKey` 仍可能明文存 localStorage（可选会话模式；备份/快照/导入不含）· 网页版文件/命令/JS 执行为隔离演示 · **Electron GUI 与鸿蒙 HAP 未图形化构建/验证**（仅语法与配置检查）· 原生日期控件按浏览器语言显示（中文回显消除歧义）· CSS 跨文件重复 185 处按 ADR-002 保留 · `countUp` 为公共能力当前未挂载业务调用 · `.md` 全库导出为逐个下载 · 识海检索依赖异步快照可能延迟一帧。

### 交付物索引

- **在线应用**：`https://alifeosv3nov09.app.workbuddy.host/?sharecode=33O3OVO2Z3&v=f94fa32f#dashboard`
- **二维码**：`docs/lifeos-open-qr.png`
- **Skill 包**：`docs/lifeos-maintainer.zip`（源码 `.codebuddy/skills/lifeos-maintainer/`）
- **方案 / 决策**：`docs/PLAN-systematic-update.md`、`docs/ADR-00{1,2,3}-*.md`
- **记忆 / 交接**：`.ai-memory/{handoff,summary,glossary,decisions}.md`
- **兼容记录**：`docs/harmony-sync.md`、`docs/electron-compat.md`
- **视觉证据**：`docs/w3-*.png` 11 张 + `w3-storage-section.png`
- **回滚基线**：`.rollback/src-w0`、`.rollback/w0-files`、`.rollback/baseline-w0.sha256`

### CHECKPOINT 记录

- CHECKPOINT-11（W4）：Skill 骨架 + 3 份 ADR + `.ai-memory` 三件套 → `quick_validate` / `package_skill` 通过
- CHECKPOINT-12（W4）：鸿蒙两份配置注释 + 6 份 json5 检查 + Electron 四文件语法 → 全通过
- CHECKPOINT-13（W4）：README / 二维码 / 一键脚本 → 实跑 `release.sh` 全链路全绿，二维码解码一致
- CHECKPOINT-14（W4 收尾）：修正版本戳双前缀与 KB 统计 → 重跑一键脚本，链接与二维码最终一致

### 状态

W0–W4 全部完成，方案 `docs/PLAN-systematic-update.md` 的六槽位均已交付。后续若要继续，属于**新需求**（例如 TypeScript 类型化、真出介绍短片、Electron/HAP 图形验证），需重新走影响面评估，不视为本次遗漏（见 `decisions.md` D8）。
