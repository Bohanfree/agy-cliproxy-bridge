# AGY → CLIProxyAPI Bridge

把真实 **Antigravity CLI (`agy acp`)** 接入 **CLIProxyAPI**，供支持 OpenAI 或 Anthropic 协议的客户端使用。模型由 AGY 上游提供，文件、终端等客户端工具仍在客户端所在电脑执行。

这是独立运行的 HTTP 适配服务，通过 CLIProxyAPI 的 `openai-compatibility` 配置接入。无需修改 CLIProxyAPI 源码。

```text
Codex / 其他客户端
        ↓ Responses 或 Chat Completions
   CLIProxyAPI
        ↓ Chat Completions
   本项目 HTTP 适配器
        ↓ Anthropic messages → ACP
   Antigravity CLI → 上游模型
        ↕ 工具调用与结果
   客户端所在电脑
```

## 功能

- OpenAI Chat Completions：流式／非流式、工具调用、工具结果回传。
- Anthropic Messages 与 token 估算接口。
- 内联 base64 PNG/JPEG/GIF/WebP 图片输入。
- 多轮会话复用、空闲进程回收、可恢复会话状态持久化。
- 工具结果后追加指令、摘要请求或助手续写片段时，保留已完成结果并继续生成。
- 客户端取消向 AGY 传递；流式连接每 15 秒保活。
- Bearer key 鉴权、16 MiB 请求上限、5 分钟 HTTP 截止时间。
- 内置 MIT 许可的桥接核心，原始文件及来源校验值保留在 `vendor/`。

**Responses API 由 CLIProxyAPI 转换。** 直接访问本适配服务时使用 `/v1/chat/completions` 或 `/v1/messages`。

## 快速开始：直接运行

需要 Node.js **22.22+**、已安装且能运行的 Antigravity CLI。登录辅助程序需要 AGY 支持 `agy acp --login`（1.5+）。推荐 Linux 或 macOS。

AGY 安装方式请参考[官方仓库](https://github.com/google-antigravity/antigravity-cli)与[官方文档](https://antigravity.google/docs/cli/overview)。

```sh
git clone https://github.com/Bohanfree/agy-cliproxy-bridge.git
cd agy-cliproxy-bridge
npm run init
# 编辑 .env；如果 agy 不在 PATH 中，设置 AGY_PATH 的绝对路径。
npm run login
npm start
```

无第三方 npm 运行依赖。`npm run init` 生成私有 `api.key` 与本地配置，保留已有密钥。Google 登录由 AGY 自己处理，凭据保存在 AGY 使用的系统密钥环中。

已在同一用户环境登录过 AGY 时，可以直接启动服务。Linux 无桌面环境的密钥环配置见[部署说明](docs/deployment.md)。

```sh
curl http://127.0.0.1:9437/healthz
curl -H "Authorization: Bearer $(cat api.key)" \
  http://127.0.0.1:9437/v1/models
```

## 接入 CLIProxyAPI

把 [examples/cliproxyapi.yaml](examples/cliproxyapi.yaml) 中的 provider 合并到现有 `openai-compatibility` 列表，修改：

1. `base-url`：CLIProxyAPI 能访问到的桥接服务地址。
2. `api-key`：本地 `api.key` 的内容。
3. `models`：当前 AGY 账号实际提供的模型。示例列出的型号按实际目录调整。

模型经 CPA 可以加独立别名，例如 `agy-gemini-4-carbon`。桥接服务本身接收 AGY 型号名，例如 `gemini-4-carbon`。避免用示例文件覆盖整个生产 CPA 配置。

高级 Docker 模板 `compose.yaml` 适用于**已经有 Linux Magpie/AGY 登录环境和密钥环**的用户，完整要求、目录权限和网络设置见[部署说明](docs/deployment.md)。它复用现有环境，不负责创建 Google 账号或密钥环。

## 配置与容量

`npm start` 默认最多两个工作会话进程；模型目录探测可能短暂产生额外辅助进程。启动脚本会设置持久 MCP 启动器路径，避免 AGY 重新整理 PATH 后丢失客户端工具。

| 配置 | 启动脚本／Compose 默认值 | 说明 |
|---|---|---|
| `AGY_BRIDGE_MAX_PROCS` | `2` | 工作会话进程池上限 |
| `AGY_BRIDGE_IDLE_MS` | `120000` | 空闲回收时间 |
| `AGY_BRIDGE_START_TIMEOUT_MS` | `30000` | AGY 启动超时 |
| `AGY_BRIDGE_TURN_TIMEOUT_MS` | `180000` | AGY 生成阶段无输出进展超时 |
| `AGY_BRIDGE_STATE_FILE` | 原生 `state/sessions.json`；Compose `/state/sessions.json` | 可恢复会话映射 |
| `AGY_API_KEY_FILE` | 原生 `./api.key`；Compose 私有挂载 | HTTP 接口密钥文件 |
| `AGY_BRIDGE_NODE` | 当前 Node.js；Compose 内置 Bun | 持久 MCP 启动器运行时 |

Compose 给整个桥接容器设置 **896 MiB 内存、1 核 CPU、128 PID** 上限；直接运行 Node.js 时由宿主机管理资源。直接执行 `node server.mjs` 会使用桥接核心自己的默认值，推荐通过 `npm start` 启动。

小内存服务器建议从 1～2 个进程开始。实际长会话比简短文本测试更吃内存，图片和历史也会增大每次请求。进程池满且现有会话未完成时，新请求会收到忙碌错误。

## 测试

无需 Google 登录即可运行：

```sh
npm test
```

覆盖工具调用顺序、工具结果回传、流式 UTF-8 边界、流式错误、鉴权、取消传递、用量转换和 vendor 校验值。
续写与摘要回归测试通过真实桥接核心及受控 ACP/MCP 对端运行，检查已完成结果保留、工具不重复发出、普通会话复用和不完整并行结果拒绝。

经过真实 CPA 的确定性协议测试（使用假模型，不消耗上游额度）：

```sh
docker compose -f compose.test.yaml up -d --wait
npm run test:cpa
docker compose -f compose.test.yaml down
```

该测试在客户端临时目录中实际读写文件，覆盖 Chat 流式／非流式、Responses 工具回传和 Responses 流式工具调用。结果写入被 Git 忽略的 `.artifacts/`。测试模板内的固定 key 仅用于本机离线 fixture。

## 运行状态与已知边界

- `/healthz` 检查 HTTP 服务存活；账号登录、上游可用容量需要实际模型请求确认。
- `No capacity available ... UNAVAILABLE (code 503)` 是上游容量错误；AGY 自身可能在同一 HTTP 连接里重试。排障时同时查看 AGY 日志和客户端表现。
- AGY 上游的容量、额度、模型目录可能变动。公开代码不包含模型账号、Google 凭据或服务额度。
- JSON Schema 强制输出、强制选择工具、`n > 1` 会显式报错。采样参数与输出预算以 AGY 实际行为为准。
- 用量中可能含估算值，适合诊断，不作为计费依据。
- 客户端追加指令、停止生成或退出，会取消在途请求。
- 工具结果与新指令／助手预填片段混合时，会结束旧的待续会话并用已有结果重放上下文；普通工具回传继续复用原会话。长历史仍受重放预算约束。
- 绑定地址默认是回环地址。跨机器使用时配置可信反向代理与访问控制，密钥和 AGY 登录目录保持私有。

项目中的持久化状态、授权码文件和 AGY 临时诊断日志可能包含会话或凭据信息，已列入忽略规则；提交 issue 时请先去除这些内容。

## 来源与许可

本项目 HTTP 适配层及新增文件采用 [MIT](LICENSE) 许可。

桥接核心来自 [`magpie-community/plugins` 的 `packages/agy-cli`](https://github.com/magpie-community/plugins/tree/main/packages/agy-cli)（`@magpie-community/opencode-agy-cli-auth` 0.1.3 的修正版），保留全部上游版权声明。具体基线、补丁说明与 SHA-256 清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[vendor/agy-bridge/NOTICE.md](vendor/agy-bridge/NOTICE.md) 和 [vendor/provenance.json](vendor/provenance.json)。

AGY、Magpie、CLIProxyAPI 由各自项目维护，本仓库仅包含适配代码和所列 MIT 桥接源码。
