# ADR-003 · 双写灰度三态、一键回滚与密钥边界

- **状态**：已实施（W0 基线 / W1 灰度 / 前期密钥加固，2026-11-13）
- **相关**：`src/js/storage.js`、`src/js/modules/settings.js`、`src/js/store.js`、`src/js/bridge.js`、`.rollback/`

## 背景

数据迁移是 Q3 硬卡点：一旦把用户数据搬到 IndexedDB 并删除旧存储，出问题就无法恢复。同时前期审查发现一条真实的密钥泄漏链：导出备份、自动快照、导入/恢复都会带上 `aiKey` / `aiBaseUrl`，外部导入还能覆盖本机密钥。

## 决策

### 1. 三态灰度 + 新旧并行

| 状态 | 行为 |
|---|---|
| `legacy` | 只用 localStorage |
| `dual`（默认） | localStorage 同步权威 + IDB 异步冗余镜像 |
| `idb` | 仍保留 localStorage 写入，读取优先 IDB |

`localStorage` 的 `lifeos-*` 键**永不删除**，因此任意时刻切回 `legacy` 都零丢数据。

### 2. 回滚入口（三层）

1. 设置页「一键切回旧存储」→ `L.storage.rollback()` → `setMode('legacy')`
2. URL `?storage=legacy` 应急覆盖，`mode()` 里优先级最高（在 Electron 检测之后）
3. `.rollback/src-w0` + `.rollback/w0-files` + `baseline-w0.sha256`（45 行）全量文件级回滚基线

**迁移前强制导出备份**：设置页切换模式前先 `S.downloadBackup()`，失败即中止。

### 3. 密钥边界

- `SECRET_SETTING_KEYS = ['aiKey', 'aiBaseUrl']`；`portableSettings()` 在 `exportPayload` / `makeSnapshot` 中一律脱敏
- `parseImport` / `importPayload` / `restoreSnapshot` **不能覆盖**本机密钥
- `sanitizeStoredSnapshots` 清洗历史旧快照
- `bridge.js` 支持 `aiKeySessionOnly`：密钥只进 `sessionStorage`（`lifeos-session-key`），长存储里清空
- 设置页明确写出风险与「仅本次会话保存」开关

### 4. 多标签一致性

`app.js` 的 `storage` 事件先调 `L.storage.onExternalChange(e.key)` 让内存缓存失效，再重读，避免 A 标签切模式后 B 标签仍读旧缓存。

## 备选方案

| 方案 | 未采用原因 |
|---|---|
| 一次性全量迁移并删除 localStorage | 无回滚能力，违反 Q3 硬卡 |
| 迁移前只提示、不强制导出 | 用户可能跳过，出事无兜底 |
| 把密钥一起写进 IDB 镜像 | 只是换个地方明文存，不解决泄漏；备份链才是真风险点 |

## 后果

**正面**：任何失败都能在设置页/URL 一键回退；备份、快照、导入三个通道都不含密钥；会话模式给了注重安全的用户可选项。

**负面 / 代价**：默认 `aiKey` 仍可能明文存 localStorage（会话模式是**可选项**，不是默认）；IDB 镜像与 localStorage 内容一致，同属本机明文；应用本身无鉴权，依赖网关 `sharecode`。这些必须在交付物里如实说明，不得声称「密钥已安全存储」。

## 撤销条件

- 若引入真正的加密存储（如 WebCrypto + 用户口令派生密钥）并能提供完整迁移与回归证据，可替换会话模式方案
- 若 `dual` 状态经过长周期观察无任何 IDB 相关故障，可考虑把默认切到 `idb`，但**仍不得删除 localStorage 写入**

## 证据

`tests/backup.test.js`（备份/快照/导入脱敏与不覆盖）、`tests/security.test.js`（密钥与 URL/sandbox 模式）、`tests/storage.test.js` 52 断言（三态、URL 覆盖、回滚数据不丢、运行时故障降级）、`tests/browser.test.js` K 段（真实标签页应急回滚）。

> K 段曾因测试脚本用字符串拼接 `?storage=legacy`（带 `#dashboard` 时参数落进 fragment）假失败；已改为 `new URL(...).searchParams.set(...)`。产品逻辑本身正常。
