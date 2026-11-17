# LifeOS 系统化更新 · 会话摘要

> 方案：`docs/PLAN-systematic-update.md`（六槽位 LOCKED）
> 执行：`开工` 后按 W0 → W1 → W2 → W3 → W4 推进，每 Wave 落 `handoff.md` 检查点。
> 本文件是给后续维护者的「一页速览」，详细证据见 `handoff.md` 与 `docs/ADR-*.md`。

## 交付版本

| Wave | 版本 | 状态 |
|---|---|---|
| 基线（更新前） | `v4338f7b4` | 保留为对照链接 |
| W1 地基 | `vb01f416a` | 完成 |
| W2 知识内容 | `vcda69ced` | 完成 |
| W3 视觉动效（中间迭代） | `v8bebbd0e` → `v4f224727` | 完成 |
| **W3/W4 最终** | **`vf94fa32f`** | **当前生效** |

W4 不改动 `src/`，因此版本号保持 `vf94fa32f`（CACHE `lifeos-f94fa32f`，`dist/lifeos.html` 377.5 KB）。

## 四个 Wave 做了什么

**W0 · 回滚基线**
`.rollback/src-w0`（30 文件）+ `w0-files`（14 文件）+ `baseline-w0.sha256`（45 行）。

**W1 · 地基**
- 新增 `src/js/storage.js`：同步接口 + `legacy/dual/idb` 三态 + 能力探测降级 + `hydrate` + `rollback`
- 8 个调用点收敛到 `const DB = L.storage || localStorage`
- 设置页存储引擎区块（状态行 / 三态下拉 / 导出备份并切换 / 一键回滚 / URL 应急覆盖）
- 零依赖 `tools/build-css.js` → `src/css/app.css` 单一运行时来源
- 第 11 套件 `tests/storage.test.js`（52 断言）

**W2 · 知识内容（B1–B4）**
- B1 反链上下文 / 未链接提及 / 一键转链接（`links.js` + `notes.js`）
- B2 Daily Notes：notes 模块第三视图 + 日历入口，**不新增导航项、不新增顶层实体**
- B3 Markdown Vault（`vault.js`）+ wikilink 安全批量重命名
- B4 全局检索（`search.js` + `modules/search.js`），顶栏按钮 + `Ctrl/⌘+K`
- 第 12 套件 `tests/w2.test.js`（47 断言）

**W3 · 视觉与动效（C2 + C4）**
- `utils.js` 统一动效工具 `motionOK` / `countUp` / `stagger`
- 两层 CSS 补 `prefers-reduced-motion` 归零；统一 `:focus-visible` 与按钮按压反馈
- 热力图按列波浪点亮、图谱描边生长 + 节点交错淡入
- 11 张逐张视觉回归 + 1 张存储区块附加截图，人工比对零破损
- 第 13 套件 `tests/w3.test.js`（38 断言）+ 浏览器 M 段 17 条

**W4 · 交付沉淀（不改 `src/`）**
- 项目级 `.codebuddy/skills/lifeos-maintainer/`（真跑 `init_skill.py` / `quick_validate.py` / `package_skill.py`，产出 `docs/lifeos-maintainer.zip`）
- 三份 ADR：ADR-001 存储适配层 / ADR-002 CSS 单源 / ADR-003 双写灰度与密钥边界
- `.ai-memory/` 摘要 / 术语表 / 判断回溯录 / handoff
- 鸿蒙 build-profile 配置注释与同步说明、Electron 四文件语法验证记录
- README 更新、二维码与新版本链接刷新、最终全量验证

## 当前验证状态

| 项 | 结果 |
|---|---|
| `npm test` | 13 套件全绿 |
| `node verify-release.js` | 49/49 线上内容与本地字节级一致 |
| `npm run test:browser` | 91/91，零控制台报错 |
| 视觉回归 | 11 张 + 1 附加，零破损 |
| 硬不变量 | 12 导航 / `ENTITY_KEYS` 6 个 / `version.json` 35 文件 |

## 必须如实告知用户的限制

应用无鉴权（依赖网关 `sharecode`）· 默认 `aiKey` 仍可能明文存 localStorage（会话模式可选，备份/快照/导入不含）· 原生日期控件按浏览器语言显示（中文回显已消除歧义）· 网页版文件/命令/JS 执行是隔离演示，不碰本机 · Electron GUI 与鸿蒙 HAP 未图形验证 · CSS 跨文件重复 185 处按 ADR-002 保留 · `countUp` 为公共能力当前未挂载业务调用 · `.md` 全库导出为逐个下载 · 识海检索依赖异步快照可能延迟一帧。
