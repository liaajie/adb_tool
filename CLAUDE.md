# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # 启动 Electron 开发环境
npm run dist     # 打包 NSIS 安装包（electron-builder，需联网下载 Electron）
npm run portable # 手工打便携版到 dist/ADB Tool/（绕过 electron-builder 网络下载，见 build-portable.js）
node --check main.js preload.js renderer.js   # 语法检查（无测试框架）
```

## Architecture

Electron 应用，**无前端框架**，配置驱动 UI。

```
main.js          # 主进程：窗口、adb 调用（exec/spawn）、config 文件 I/O
preload.js       # contextBridge：暴露白名单 API 给渲染层（9个 invoke + 2个 stream）
index.html       # UI 结构 + 全部 CSS（内联，dark theme）
renderer.js      # 渲染层：解析 config → 生成 DOM → 执行指令
default-commands.json  # 预设配置，首次启动从此拷贝到 %APPDATA%/adb-tool/commands.json
```

**数据流**：`config.json` → `renderer.js` 解析 → 按 `widget` 类型渲染控件 → 用户操作 → `adb.run()`/`adb.stream()` → `main.js` 执行 adb → 输出区显示。

**IPC 约定**：
- `adb:run` — 单次执行，返回 `{ok, stdout, stderr, cmd}`（30s 超时）
- `adb:stream` / `adb:stream:kill` — 流式执行（spawn），适合 `top`/`tail -f` 类持续输出命令，用 `"stream": true` 字段在 config 中标记
- `net:probe` — TCP 端口探测（自动连接的心跳判定），并发探测多 host
- `config:load|save|export|import|reset` + `adb:setPath`、`adb:devices`

**Config schema 关键字段**：
- `groups[].commands[].widget` — `button|slider|switch|input|select`
- `cmd` 中用 `{占位符}` 注入参数值，`switch` 用 `cmdOn`/`cmdOff`
- `"stream": true` — 启用流式输出模式
- `"confirm": true` — 执行前弹确认框
- `chains[].steps[]` — 顺序执行，`waitMs` 控制步骤间延时

**CSP**：`script-src 'self' 'unsafe-inline'`，允许 HTML 内联 onclick。

**安全**：`sanitize()` 过滤 serial 中的 shell 注入字符；渲染层不能直接 spawn 进程。
