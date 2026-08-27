# DSH 插件工作区

本目录存放为 DeepSeek Harness（DSH）编写的插件。每个子目录是一个独立、零构建的插件包，
可挂载进任意 DSH profile（包括正在运行的 Web GUI，无需重启）。

## 插件一览

| 包 | 功能 | Web 入口 |
|---|---|---|
| `dsh-plugin-token-usage` | 汇总本机全部持久会话的 token 用量（输入/输出/缓存读/缓存写，按模型、按会话） | 侧边栏底部「Token 用量」按钮 → 统计面板 |
| `dsh-plugin-session-import` | 把其他 agent 的原始会话记录导入为 DSH 会话：**自动识别**当前工作区下其他 agent 的会话列表（手动点击才导入），也保留**手动文件导入** | 侧边栏底部「导入会话」按钮 → 导入对话框 |

## 结构约定

每个插件包都是「双半侧」结构，与 DSH 官方 client 插件一致：

```
dsh-plugin-xxx/
├── package.json       # 声明 dsh.client（浏览器半侧）与 dsh.bundle（组合包层）
├── index.js           # Host 半侧：纯 ESM，零依赖，经 ctx 服务注册能力
├── client.js          # 浏览器半侧：手写的 lazy-CJS factory bundle
└── cordis.patch.yml   # 组合包层（供 dsh plugin add 安装时使用）
```

`dsh-plugin-session-import` 的 host 半侧额外拆成 `index.js`（装载 shim）+ `impl.js`（实现），
shim 用 `?rev=` 查询串动态 import 实现——见下文「热更新」。

- **Host 半侧**通过 `inject = ['webServer', 'sessionPersistence']` 等服务介入，
  自行注册 HTTP 路由（`ctx.webServer.register`）或读写会话。
- **浏览器半侧**以 `window.__ModuleLoader__.load({ id, factory })` 注册，
  通过注入的 `require` 使用平台模块（`react`、`@deepseek-ai/cordis`、
  `@deepseek-ai/dsh-client-ui-slots` 等），并向 slot 系统注册 UI
  （`sidebar.footer.action` 按钮 + `shell.overlay` 浮层面板）。

## 会话导入

### 自动识别（推荐流程）

打开导入面板时，host 半侧扫描本机其他 agent 的会话目录：

- Claude Code：`~/.claude/projects/*/*.jsonl`（从记录里的 `cwd` 判断所属工作区）
- Codex：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（`session_meta.cwd`）

面板顶部有**工作区下拉列表**：

- 「自动（跟随当前会话）」——按当前打开 session 的 `cwd` 解析，切换会话时面板自动重扫；
- DSH 已注册的工作区——直接列出；
- 只在其他 agent 会话里出现过的目录——带「未注册」标记一并列出。

选中某个工作区后列表只显示该工作区下的会话；**每一条都需要手动点击「导入」**才会写入
DSH。导入时 host 侧会通过 `workspaceRegistry` 就地完成工作区归属：解析（必要时注册）
transcript 的 `cwd` 对应的工作区并 `attachSession`，会话立即落在该工作区下而不是未分组
桶；目录已删除等失败会降级为行内警告（会话仍导入）。导入后还会跑一次
`sessionPersistence.inspect` 冷加载校验（`verified` 字段），即 resume 走的同一条读路径。

「已导入」徽标会跟随 DSH 内的状态变化：**归档或删除**（含手动删文件）后，下次扫描自动
回到可导入状态（归档的会话保留台账，取消归档后徽标恢复；已删除的记录从台账清理）。

### 手动导入（保留）

拖入或点选 `.jsonl`/`.json` 文件 → 自动预检（格式、轮次、消息数、跳过的工具记录）→
点击「导入」。

### 支持的格式

| 格式 | 判定 | 说明 |
|---|---|---|
| Claude Code | JSONL，`type: user/assistant` + `message` | 文本、thinking→reasoning、usage 四桶；tool_use/tool_result 与 isMeta 行跳过 |
| Codex | rollout JSONL（`response_item`/`session_meta`/`turn_context`） | input_text/output_text；reasoning 摘要并入下一条助手消息；模型取自 turn_context |
| OpenAI 风格 | JSON 消息数组（`[{role, content}]` 或 `{messages: [...]}`） | 文本内容；system 消息跳过 |

导入生成规范事件日志（seq 从 0 连续、turn/step 从 1 编号、`surfaceOp: append`），经过
`Session.fromRestore` 同一套校验。**会话命名取对话第一句话**：导入会在日志末尾追加一条
`session/title` 事件（`user` 来源，钉住标题——后续续写不会触发自动重命名），标题服务按
最新事件折叠显示。工具类内容以「跳过 N 条工具记录」计数呈现；usage 缺失时消息仍导入，
只是不计入统计。

## 安装到正在运行的 Web GUI（免重启）

DSH 的 profile 用户 patch 层（`<profile>/cordis.patch.yml`）是被热监听的：
编辑后新插入的插件行会直接挂载进运行中的进程。步骤：

```sh
PLUGIN_SRC=/Users/gin/my/code/dsh-workspace/dsh-plugins
PROFILES_NM=~/.dsh/profiles/node_modules     # dsh 启动时自愈的共享解析目录

# 1) 让插件包能被 profile 的 baseUrl 按 bare name 解析（符号链接，改代码即时生效）
ln -sfn "$PLUGIN_SRC/dsh-plugin-token-usage"    "$PROFILES_NM/dsh-plugin-token-usage"
ln -sfn "$PLUGIN_SRC/dsh-plugin-session-import" "$PROFILES_NM/dsh-plugin-session-import"

# 2) 在 web profile 的用户 patch 层插入两行（热生效）
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: plugin-token-usage
      name: dsh-plugin-token-usage
- insert:
    - id: plugin-session-import
      name: dsh-plugin-session-import
EOF

# 3) 刷新浏览器页面（浏览器启动图在页面加载时下发，新插件需要一次刷新）
```

> 注意：`cordis.patch.yml` 的顶层必须是一个 YAML 数组；若文件当前是 `[]`，
> 先删掉 `[]` 再追加上述行（保留文件头的注释）。

## 安装到其他 profile（正式方式）

每个包都声明了 `dsh.bundle`，可以直接用 dsh 的插件管理器：

```sh
dsh plugin --profile <name> add /Users/gin/my/code/dsh-workspace/dsh-plugins/dsh-plugin-token-usage
dsh plugin --profile <name> add /Users/gin/my/code/dsh-workspace/dsh-plugins/dsh-plugin-session-import
dsh --profile <name> --dump-config   # 应能看到 "# == dsh-plugin-token-usage" 等层
dsh --profile <name> web
```

源码运行时等价于 `pnpm dsh --profile <name> …`。

## 热更新速查

| 改了什么 | 如何生效 |
|---|---|
| `client.js`（浏览器半侧） | 刷新浏览器页面即可 |
| `impl.js`（session-import 的 host 实现） | 把 profile patch 里该行加上/调高 `config: { implRev: N }`（shim 用 `?rev=N` 绕过模块缓存，patch 是热监听的） |
| `index.js`（host shim/装载层） | 需要重启 dsh web（该文件每个进程只装载一次） |
| token-usage 的 `index.js` | 需要重启 dsh web |

```yaml
# implRev 示例（改完 impl.js 后把 2 改成 3，再保存 patch 文件）
- insert:
    - id: plugin-session-import
      name: dsh-plugin-session-import
      config: { implRev: 2 }
```

## 卸载

- 临时/热卸载：从 profile 的 `cordis.patch.yml` 删除对应 `- insert:` 块（同样热生效）。
- 彻底移除：再删除 `$PROFILES_NM` 下的符号链接；`dsh plugin --profile <name> remove <pkg>`。
- 导入记录台账：`~/.dsh/plugins/dsh-plugin-session-import/imports.json` 可随手删。

## 测试

```sh
# token 统计 host 半侧（mock ctx + 路由，纯 node）
node tools/test-token-usage.mjs

# 会话导入转换器（经真实 Session.fromRestore 生产校验，需要 dsh 检出里的 tsx）
/Users/gin/my/code/deepseek-harness/node_modules/.bin/tsx tools/validate-import.mjs

# 自动识别扫描（假 $HOME + Claude/Codex 样本，纯 node）
node tools/test-discover.mjs
```

## 常见坑

- patch 文件里 `[]` 和 `- insert:` 块不能共存（YAML 顶层只能是一个数组）。
- 新加的插件行没反应：检查行里的 `name` 与 `node_modules` 里的包名是否完全一致。
- host 半侧大改（shim 本身）后热重载不生效：那是 ESM 模块缓存，重启一次 dsh web。
- `dsh plugin add` 报 build script 被拒：本插件零构建不会遇到；git 安装的第三方插件见
  `allowBuilds` 说明。
