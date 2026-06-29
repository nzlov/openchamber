# Codex 迁移计划

## 目标

将 OpenChamber 的旧 agent runtime 实现替换为 Codex 实现，删除旧配置入口、旧 SDK 依赖、旧环境变量和旧数据兼容路径。迁移不考虑旧数据兼容，Codex API 是唯一 agent/runtime 来源。

## 当前已落地状态

- [x] 新建独立 Codex runtime -> verify: `packages/web/server/lib/codex/*` 单测通过
- [x] Web server 注册 Codex API 与 SSE -> verify: `/api/codex/health`、`/api/codex/events`、`/api/codex/models` smoke 通过
- [x] Web UI 入口保留完整 OpenChamber UI 并注入 Codex runtime -> verify: `packages/web/src/main.tsx`、`mobile-main.tsx`、`mini-chat-main.tsx` 注册 `RuntimeAPIs` 后分别渲染完整 Web、Mobile、mini-chat 入口
- [x] Web bundle 不再拉入旧 SDK -> verify: Web build 通过，bundle 搜索无旧 SDK 命中
- [x] Web 配置、PWA 可见面和共享 UI 文案切到 Codex -> verify: `packages/ui/src`、`packages/web/src`、`packages/web/server` 无旧 runtime/config 标记命中
- [x] VS Code bridge/webview 旧配置入口已切断 -> verify: VS Code bridge/webview 改为 Codex 命名入口；`bun run vscode:type-check`、`bun run --cwd packages/vscode lint`、`bun run vscode:build` 通过
- [x] Web server 入口不再构造旧 lifecycle/proxy/watcher -> verify: `packages/web/server/index.js` 只启动 OpenChamber web runtime 与 Codex runtime
- [x] 共享 UI 已迁移到 Codex 命名运行时入口 -> verify: `packages/ui/src/lib/codex/runtime-client.ts` 承载实现，Web type-check 通过
- [x] Web server 通用运行时目录脱离旧模块路径 -> verify: `packages/web/server/lib/openchamber-runtime/*` 承载通用 Web routes/settings/fs/git/terminal/tunnel 等模块
- [x] Web-only 验证通过 -> verify: `bun run type-check:web`、`bun run lint:web`、`bun run build:web`、相关 Web server 单测、Web server `/health` 和首页 smoke 通过；未运行 Electron 测试

## 剩余工作清单

- [x] 删除 Web 启动和构建配置中的旧 runtime 命名与环境入口 -> verify: Web/package/vite/scripts 可达路径无旧 runtime 标记命中
- [x] Web 默认启动不再拉起或代理旧 runtime -> verify: `/health` 暴露 Codex 状态，Web smoke 通过
- [x] 删除 Web/UI 可达的旧设置页和配置字段 -> verify: 共享 UI 与 Web server 活跃代码无旧 runtime/config 标记命中
- [x] 删除旧 SDK 依赖和 Vite alias/optimize 配置 -> verify: package/vite 配置无旧 SDK 标记命中
- [x] 删除剩余旧 config 文件路径与技能安装源 -> verify: Web server 与 UI 活跃代码只使用 Codex/OpenChamber 路径
- [x] 更新 Web README、VS Code README、PWA metadata、server module docs -> verify: 模块文档不再描述旧 proxy/lifecycle/watcher 架构
- [x] 替换 Electron/desktop 文案与 runtime wiring 中的旧 runtime 假设 -> verify: 静态搜索无旧 runtime/config 标记；`node --check packages/electron/main.mjs`、`codex-cwd.mjs`、`preload.mjs` 通过；未运行 Electron 测试/构建
- [x] Web 端收尾验证 -> verify: `bun run lint:web`、`bun run build:web`、相关 Web server 单测、Web server `/health` 和首页 smoke 通过
- [x] 允许范围内跨运行时回归 -> verify: Web/UI/VS Code type-check、lint、build/docs validate 通过；Electron 仅静态语法检查，未测试/构建

## 执行顺序

1. Web 与构建面先收敛：浏览器入口、PWA metadata、CLI help、Web server smoke 全部 Codex-native。
2. Server runtime 再收敛：拆除旧 lifecycle/proxy/startup 活动链路，保留通用 OpenChamber routes、auth、terminal、git、fs、notifications、tunnels。
3. Shared UI 再收敛：删除旧 App、stores、SDK wrapper、settings pages，把可复用 UI 只接 Codex client/store。
4. VS Code 和 desktop 最后收敛：迁移 bridge/manager 和 shell wiring，避免 Web 可用性被跨运行时重构拖垮。
5. 依赖和文档收尾：移除旧 SDK、旧 env/config 文档、Docker/compose/install 中的旧启动方式。

## 成功标准

- 运行时代码中没有旧 SDK、旧 proxy、旧 config、旧 env var 或旧项目写入路径。
- Web、VS Code、desktop 均通过各自当前允许的最窄有效验证；若用户仍禁止 Electron 测试，则 Electron 只做静态检查并在交付中明确说明。
- Codex API 是唯一 agent/runtime 来源，Web UI 可创建线程、发送 turn、接收 SSE 事件、处理审批、读取/更新 Codex 支持的配置字段。
- 删除旧数据兼容逻辑；不保留旧 runtime 到 Codex 的 adapter/shim。
