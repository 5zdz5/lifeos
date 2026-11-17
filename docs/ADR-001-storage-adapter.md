# ADR-001 · 统一存储适配层采用同步接口

- **状态**：已实施（W1，2026-11-13），当前生效
- **相关**：`src/js/storage.js`、`src/js/bridge.js`、`src/js/store.js`、`tests/storage.test.js`

## 背景

W1 目标是把 `localStorage` 迁移到 IndexedDB 双写灰度。但排查发现：全项目 20 多处调用点全部使用**同步**的 `getItem` / `setItem` / `removeItem`，Node 单测也用 `vm` 直接 `eval` 源码并同步断言；而 IndexedDB 是纯异步 API。若把适配层改成 Promise，需要同时改写全部业务模块与测试，风险远超收益。

另外 Electron 桌面端走 `window.electronAPI` 文件持久化，浏览器端才需要 IDB，两者必须能共存。

## 决策

`storage.js` 提供**与 localStorage 完全同签名的同步接口**，内部采用：

1. **内存缓存 `mem`**：`setItem` 先写内存，`getItem` 优先读内存
2. **localStorage 同步权威**：每次 `setItem` 同步写入 `lifeos-*` 键，且**永不删除**
3. **IDB 异步冗余镜像**：`mirror()` 异步 put/delete，不进关键路径、不 `await`
4. **能力探测与运行时降级**：`indexedDB` 缺失或运行时抛错自动 `degraded = true` → `legacy`
5. **三态** `legacy` / `dual` / `idb`，URL `?storage=legacy` 应急覆盖优先级最高
6. **Electron 强制 legacy**：检测到 `window.electronAPI` 时不启用 IDB
7. `hydrate()` 在 `app.init()` 里、`S.init()` 之前 `await`，负责首次迁移/缺失回填

调用点统一 `const DB = L.storage || localStorage;`，单测未加载 `storage.js` 时无缝回落。

## 备选方案

| 方案 | 未采用原因 |
|---|---|
| 全量改异步 `async/await` | 20+ 调用点 + 全部单测要重写，回归面过大；`render()` 目前是同步纯函数 |
| 直接删 localStorage、纯 IDB | 无法一键回滚，且首次加载会有数据空窗 |
| 引入第三方封装（localForage / idb） | 供应链审查门禁要求零未审查依赖；本项目已选择零依赖构建链 |

## 后果

**正面**：业务代码零改动即可接入；一键回滚零丢数据；Node 单测无需 mock 异步；Electron/Web 边界清晰。

**负面 / 代价**：每次写仍会同步写一次 localStorage（性能与配额上限不变）；IDB 只是镜像，不能声称「已迁移到 IndexedDB」；`sessionStorage`（会话密钥）刻意不纳入适配层。

## 撤销条件

若未来引入构建工具与类型系统，能把所有调用点安全改成异步、且提供「异步化前后 91 条浏览器回归 + 49 项一致性零回归」的证据，可重新评估。

## 证据

`tests/storage.test.js` 52 断言（能力探测/降级、三态与 URL 覆盖、同步接口与双写、hydrate 三场景、一键回滚数据不丢、运行时故障降级、exportAll/会话语义/源码边界）；`tests/browser.test.js` J/K 段 14 条真实 IDB 运行时断言。
