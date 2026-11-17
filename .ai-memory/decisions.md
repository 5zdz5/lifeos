# 判断回溯录

> 记录「当时为什么这么判断、依据是什么、结果如何、什么条件下应该反转」。
> 目的不是证明都对，而是让后续维护者能看懂取舍、在条件变化时知道该改哪里。

## D1 · 存储适配层保持同步接口（W1）

- **判断**：不改 20+ 同步调用点，适配层内部用「内存缓存 + localStorage 同步权威 + IDB 异步镜像」
- **依据**：业务 `render()` 是同步纯函数；Node 单测用 `vm` 同步断言；改异步会同时炸业务与测试
- **结果**：业务零改动接入，一键回滚零丢数据；52 断言 + 14 条真实浏览器断言通过
- **反转条件**：引入构建/类型系统后能安全全量异步化，且 91 浏览器 + 49 一致性零回归
- 详见 `docs/ADR-001-storage-adapter.md`

## D2 · CSS 构建走零依赖降级路径（W1）

- **判断**：不装 esbuild，自研 `tools/build-css.js`
- **依据**：环境 `node_modules` 为空、esbuild 需联网拉未审查二进制，触发方案里的供应链门禁降级条款
- **结果**：100% 可复现、幂等、视觉零风险；代价是 `app.css` 未压缩、SW 仍缓存两份源 CSS
- **反转条件**：带 AST 层叠分析的构建器通过依赖审查 + 逐像素比对证据
- 详见 `docs/ADR-002-css-single-source.md`

## D3 · W2 不新增导航项、不新增顶层实体

- **判断**：Daily Notes 做 notes 第三视图，全局检索做顶栏弹窗
- **依据**：`verify-release.js` 与 `browser.test.js` 硬断言 12 导航；新增实体会同时打断 `ENTITY_KEYS`、备份链、导入链、统计链
- **结果**：日记自动复用导出/快照/双链/检索；版本 `vcda69ced`，49 一致性 + 74 浏览器全过
- **反转条件**：若确需新实体，必须**同步**改 `ENTITY_KEYS` + `parseImport` + `counts` + 12 导航断言 + 全套回归

## D4 · 权威统计数字不做数值缓动（W3，重要修正）

- **初版判断**：给 `.hs-num` / `.gs b` 加 `countUp` + 交错延迟，觉得"数字滚动更有生命力"
- **推翻依据**：逐张视觉比对 `w3-motion-heatmap-wave.png` 发现中间帧显示 **107/86 而非真值 168/134**，且第 3、4 个数字因 `animation-delay` + `both` **完全空白**；`w3-motion-graph-draw.png` 显示 2/4 而完整帧是 3/5。用户短暂看到的是**错误的权威数据**
- **修正**：移除统计卡的数值缓动与交错隐藏，只保留统一无延迟淡入；`countUp` 留作公共能力但明确不挂载；`stagger` 改为驱动热力图列波浪（唯一来源）
- **结果**：中间帧与完整帧数字一致（168/134/0/5、3/5/0/1），M5/M6 固化为回归断言
- **反转条件**：除非能证明「数字动画不会误导」（例如明确标注为进度/演示且非真实统计），否则不恢复

## D5 · 不做 CSS 规则级收敛（W3 结论）

- **判断**：185 处跨文件重复选择器保留
- **依据**：它们是有意层叠覆盖、运行时单一来源已在 W1 达成、删除需 11 张回归背书而收益仅几 KB；同时把构建脚本里「W3 收敛」的误导文案改掉
- **结果**：`vf94fa32f`，视觉零破损，文案如实
- **反转条件**：AST 级构建器 + 逐像素比对 + 49/91 零回归，三条同时满足

## D6 · 视觉基线截图必须拍稳定态（W3）

- **判断**：`SHOTS_SET=w3` 里 heatmap/graph 基线等待 1200ms，动效静帧仍用 150/190ms
- **依据**：420ms 拍到的热力图右侧仍是暗的（波浪最长约 1s），会被误判成「数据缺失」；基线证据应代表用户看到的最终状态
- **结果**：`w3-heatmap.png` 53 列全亮、`w3-graph.png` 连线完整；中间帧单独留证

## D7 · K 段 URL 拼接缺陷是测试问题，不是产品问题（W3）

- **现象**：`npm run test:browser` 里 `URL ?storage=legacy 强制切回旧存储` 假失败，返回 `mode:"dual", override:null`
- **根因**：测试用 `TEST_URL + '&storage=legacy'` 字符串拼接；当 `TEST_URL` 带 `#dashboard` 时参数落进 fragment，没进 query。产品 `urlOverride()` 逻辑正常（同段「一键回滚」断言仍通过）
- **修正**：改用 `new URL(TEST_URL).searchParams.set('storage','legacy')`，回归恢复 91/91
- **教训**：所有 URL 参数构造一律用 URL 对象；已写进 `references/release-checklist.md`

## D8 · 范围解释不一致（需求锁定阶段，如实留痕）

- **事实**：第二轮选项里用户勾选了 `TypeScript 类型化` 与 `真出介绍短片`，但后续锁定卡与 `docs/PLAN-systematic-update.md` 的「明确不做」里排除了这两项，并把 `全文检索` 并入 B 组
- **处理**：以最终锁定方案为 LOCKED 执行；用户随后说 `开工`，未提出异议
- **回溯**：这属于**助手对多选题结果的再解释**，不是用户改口。若用户后续要求补做 TypeScript 或 MP4，应视为**新需求**而不是「之前漏做的 bug」，需重新走影响面评估
- **改进**：后续锁定卡应把「勾选了但被排除」的项单独列成「待确认」而不是直接写成 Out

## D9 · skill-creator 脚本位置按目录名搜索落空（W4）

- **现象**：`find /root/.codebuddy/skills/skill-creator` 无结果，一度记为「未解决」
- **根因**：实际安装路径是带 ID 的目录 `/root/.codebuddy/skills/skill_2053082698440450048/`，不是 `skill-creator`
- **修正**：改为按**文件名**全局搜索 `init_skill.py` / `package_skill.py` / `quick_validate.py`，定位后真跑成功，产出 `docs/lifeos-maintainer.zip`
- **教训**：Skill 目录名不保证等于 skill 名；找脚本按文件名搜，别按目录名猜

## D10 · 三个「假失败」都源于测试/工具而非产品

| 现象 | 真实原因 |
|---|---|
| `verify-release.js` PNG hash 不一致 | 用 `r.text()` 读二进制，改 `arrayBuffer()` |
| W3 单测 `countUp instanceof Function` 失败 | vm 沙箱与宿主跨 realm 构造器不同，改 `typeof` |
| W3 `heatmap --hm-wi` 静态断言失败 | 断言里写了 `.hm-col`，源码是 `class="hm-col"` |

**通用教训**：先确认是产品行为还是断言/工具写错，再改代码。这三次都只改了测试侧。
