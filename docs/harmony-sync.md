# 鸿蒙 ArkWeb 版 · 资源同步与配置说明

> 系统化更新 W4 交付。适用于 `/workspace/lifeos-harmony/`（HarmonyOS / ArkWeb 容器）。

## 1. 同步机制

网页版 `src/` 由 `/workspace/lifeos/build-standalone.js` 在每次 `npm run build` 时**自动同步**到鸿蒙工程：

```
/workspace/lifeos/src/**  →  /workspace/lifeos-harmony/entry/src/main/resources/rawfile/lifeos/**
```

当前同步 **36 个文件**（含 `index.html`、`standalone.html`、`css/app.css`、两份源 CSS、全部 JS、图标、manifest、sw.js）。构建输出会打印「鸿蒙 rawfile 已同步」。

**不要手工编辑 rawfile 内容**：改网页源码请改 `/workspace/lifeos/src` 后重新 `npm run build`。两份 `build-profile.json5` 已加注释固化此约定。

## 2. 配置位置

| 文件 | 作用 | W4 补充 |
|---|---|---|
| `build-profile.json5`（根） | 产品 / SDK 版本 / 模块声明 | 加 rawfile 同步来源与「无需额外资源声明」注释 |
| `entry/build-profile.json5` | stageMode、release 混淆设置 | 加 rawfile 资源随 HAP 打包的说明 |
| `entry/src/main/module.json5` | EntryAbility、设备类型、`ohos.permission.INTERNET` | 未改动；INTERNET 权限是既有配置 |
| `rawfile/lifeos/` | 网页产物 | 由构建脚本同步，非手工维护 |

> HarmonyOS 7.0 目标需把 `compatibleSdkVersion` / `compileSdkVersion` 改为对应 API（如 20），并在 DevEco 安装对应 SDK；当前工程声明为 `5.0.0(12)`。

## 3. 校验方法（W4 实际执行结果）

```bash
# json5 语法检查（6 份配置）
cd /workspace/lifeos-harmony && python3 - <<'PY'
import json5
files = ['build-profile.json5', 'entry/build-profile.json5', 'entry/src/main/module.json5',
         'oh-package.json5', 'entry/oh-package.json5', 'code-lint.json5']
for f in files:
    json5.loads(open(f, encoding='utf-8').read())
    print('ok', f)
PY

# 网页侧：49 项字节一致性（确认本地构建与线上一致，rawfile 同源）
cd /workspace/lifeos && node verify-release.js
```

W4 结果：**6 份 json5 全部通过**；`node verify-release.js` **49/49**。

## 4. 已知限制（如实声明）

- **HAP 未在沙箱内图形化构建或安装验证**：本环境没有 DevEco Studio / HarmonyOS SDK，只做了配置文件语法检查与资源同步链路检查
- ArkWeb 页面空白的常见排查见 `INSTALL.md`（确认 `rawfile/lifeos/index.html` 已打进包、Clean 后重建）
- 网页版的文件读写 / 终端命令 / JS 执行是**隔离演示**（iframe + Worker），鸿蒙容器里同样不会碰设备真实文件
- 应用本身无鉴权；`sharecode` 属于网页网关行为，与 HAP 无关

## 5. 撤销条件

若未来在 DevEco 里完成真机/模拟器构建验证，应把「未图形验证」改为实际设备型号与 API 版本，并补一份启动截图；在此之前不得在交付物里声称 HAP 已验证。
