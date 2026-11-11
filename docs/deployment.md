# 部署说明

## 原生 Node.js

优先在已经能运行并登录 AGY 的用户环境中部署。桥接服务与 AGY 需要访问同一个用户的配置、系统密钥环和 D-Bus 会话。

```sh
npm run init
npm run login
npm start
```

`scripts/start.sh` 读取项目根目录 `.env`，因此路径带空格时请使用引号。脚本会把项目的 `bin/` 加到 PATH，并设置 MCP 启动器使用的 Node.js 绝对路径。

在无桌面的 Linux 上，AGY 登录通常需要一个能持久运行的 Secret Service 实现及 D-Bus 会话。先按 AGY 文档配置系统密钥环，确认同一环境内 `agy models` 能列出账号模型，再启动桥接服务。仓库不自动新建或解锁系统密钥环。

进程管理器应设置项目根目录为工作目录，并传入同一用户的 `HOME`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME` 和 `DBUS_SESSION_BUS_ADDRESS`（按实际环境设置）。停止服务会取消在途请求，更新时先等待任务空闲。

## 高级 Compose：复用既有 Magpie/AGY 环境

`compose.yaml` 复用固定 Magpie 镜像中的 Bun 和既有 AGY 安装，并挂载已有的登录环境。启动桥接服务不需要启动 Magpie 主应用，但共享目录里的密钥环服务需要持续运行。

前提：

- 宿主上有现存 Linux Magpie 配置目录，里面包含可运行的 AGY、Bun 和已登录的密钥环数据。
- 密钥环的 D-Bus socket 位于该目录的 `agy-keyring-runtime/bus`。
- 容器用户 UID/GID **65532:65532** 有权读取并连接这些资源。
- 既有 CPA 所在的 Docker 网络可由 `CPA_NETWORK` 指定。

```sh
npm run init
# 在 .env 设置真实的 MAGPIE_CONFIG_DIR 和 CPA_NETWORK。
# BUN_PATH 默认 /config/cache/magpie/bun/1.4.4/magpie-bun，按环境修改。
sudo chown -R 65532:65532 state
sudo chown 65532:65532 api.key
docker compose config --quiet
docker compose up -d bridge
```

不要递归更改现有 Magpie 配置的属主；按实际现存环境确认访问权限。

默认接口：

- 宿主回环地址：`http://127.0.0.1:19437/v1`
- 同一 Docker 网络中的 CPA：`http://bridge:9437/v1`
- 健康检查：`http://127.0.0.1:19437/healthz`

此模板只启动桥接服务。首次构建独立环境的用户建议先完成原生运行，再按自己的系统密钥环方案容器化。

Compose 内手动登录：

```sh
docker compose exec bridge \
  /config/cache/magpie/bun/1.4.4/magpie-bun /app/login.mjs
```

使用不同 Bun 路径时，相应替换命令中的路径。异步登录可运行 `login-file.mjs`，设置 `AGY_LOGIN_STATE_DIR=/state` 后，它会在该私有目录写入授权链接，并等待 `login-code.txt`；授权码读取后立即删除。请勿把该目录作为静态网站公开。

## CPA 网络与配置

合并 `examples/cliproxyapi.yaml` 时，替换桥接 key、模型列表和可达地址。

同一宿主的两个普通进程可以使用 `127.0.0.1:9437`。CPA 位于 Docker 而桥接服务在宿主时，容器里的 `127.0.0.1` 指向 CPA 容器自身；需设置桥接服务绑定到 CPA 可达的宿主地址，并配置防火墙，或使用共享 Docker 网络的 Compose 模式。

CPA 的模型 `name` 必须与桥接 `/v1/models` 中的 AGY 型号对应；`alias` 可以加 `agy-` 前缀，避免与其他 provider 重名。

## 数据与更新

- `api.key`：本地 HTTP 密钥，初始化权限 0600。
- `state/`：会话续接映射和可选登录交接文件。
- AGY 用户目录与系统密钥环：Google 登录态及 AGY 会话数据，由 AGY 管理。
- AGY 运行时会在系统临时目录中建立工作区和日志。日志可能含输入、工具参数等内容，排障时按私有材料处理。

更新前备份自己的配置、密钥与会话状态；本仓库发布不携带任何实际部署数据。AGY 子进程默认关闭自动更新，避免并发进程互相更新同一二进制。升级 AGY 时先停止工作请求，升级后重新验收模型回复和工具往返。

## 排障

| 现象 | 优先检查 |
|---|---|
| HTTP 401 | CPA 配置与 `api.key` 是否一致 |
| 服务健康，但无法调用模型 | 同一环境中 `agy models` 的登录状态、密钥环和上游容量 |
| `No capacity available` / `MODEL_CAPACITY_EXHAUSTED` | 上游模型服务容量；检查 AGY 内部重试，必要时换模型 |
| `all have unfinished responses` | 进程池被尚未完成的会话占用，先完成／取消旧任务 |
| `client tools are unavailable` | `bin/nc` 可执行权限、PATH、`AGY_BRIDGE_NODE` 以及客户端工具目录 |
| 内存紧张 | 查看容器峰值、OOM 事件和换页；降低并发或增加内存 |
| 客户端显示取消／499 | 核对停止生成、补充指令、退出客户端等时间点 |

确认服务恢复时，先检查 `/healthz`，再运行实际模型请求，最后完成一次真实客户端工具往返。
