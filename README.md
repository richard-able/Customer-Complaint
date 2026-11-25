# 客户投诉分析

基于 Next.js 和 Dify 的客户投诉分析应用。部署使用两个主要脚本：

| 执行位置 | 脚本 | 作用 |
| --- | --- | --- |
| 本地电脑或构建节点 | `scripts/build.sh` | 构建 Docker 镜像，可选推送到京东云镜像仓库 |
| 远程服务器 | `scripts/deploy-server.sh` | 拉取镜像、创建容器、等待健康检查 |

两端都需要 Docker 和 Docker Compose v2，构建节点需使用支持 `build.provenance` 和 `build.sbom` 的 Compose 版本（v2.39.0 或更新版本），服务器的 Compose 需支持 `up --wait`。服务器无需 Node.js、npm 或项目源码。

应用配置统一维护在项目根目录的 `.env`。构建时将这份文件用于 Next.js 编译并打包到镜像，应用启动时读取镜像内的同一份配置；服务器无需另外创建环境文件。

## 1. 本地构建镜像

### 配置

首次创建本地配置：

```bash
test -f .env || cp .env.example .env
chmod 600 .env
```

在 `.env` 中填写应用配置和目标镜像地址：

```dotenv
NEXT_PUBLIC_APP_ID=your-app-id
DIFY_API_KEY=your-dify-api-key
NEXT_PUBLIC_API_URL=https://your-dify-server.example.com/v1
NEXT_PUBLIC_APP_TYPE_WORKFLOW=true
NEXT_PUBLIC_APP_BASE_URL_PATH=
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_MAX_CONCURRENT=5
BATCH_RUN_PASSWORD=your-batch-password

IMAGE=mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v4
BASE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim
BUILD_PLATFORM=linux/amd64
```

仓库域名、命名空间和用户名以京东云镜像仓库 控制台提供的信息为准。默认目标平台是 `linux/amd64`，ARM 服务器改为 `linux/arm64`。构建机器需要支持目标平台，跨架构构建通常需要 Docker Desktop 的模拟支持或在 Linux 构建机上配置 QEMU。

`NEXT_PUBLIC_MAX_CONCURRENT` 是批量任务的并发上限，默认 5；`BATCH_RUN_PASSWORD` 是批量分析功能的验证密码，留空使用应用默认值。Dify API 地址通常包含 `/v1`，需要能从服务器容器内访问。`BASE_IMAGE` 是下载的 Node 基础镜像，`IMAGE` 是应用镜像的标签及发布地址。

镜像包含 `.env` 中的应用配置，包括服务端使用的 `DIFY_API_KEY` 和 `BATCH_RUN_PASSWORD`。修改应用 ID、密钥、API 地址、批量密码等配置后，重新构建、推送并部署镜像即可。构建脚本计算 `.env` 内容摘要，内容变化会刷新对应的构建缓存。应用参数直接从文件读取，不再逐项通过构建参数或服务器环境变量配置。

### 只构建

在项目根目录执行：

```bash
bash scripts/build.sh
```

默认从本地 `.env` 读取 `IMAGE`，也可以指定本次构建的镜像地址：

```bash
bash scripts/build.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v5
```

脚本完成后，镜像保存在本地 Docker 中，尚未启动容器。

### 构建并推送到京东云镜像仓库

先登录镜像仓库，按提示输入 镜像仓库访问凭证密码：

```bash
docker login --username=your-jdcloud-username mate-docker-register-cn-north-1.jcr.service.jdcloud.com

# 使用 .env 中的 IMAGE
bash scripts/build.sh --push

# 或指定本次镜像地址
bash scripts/build.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v5 --push
```

`--push` 要求完整的镜像仓库地址。每次发布建议使用不同版本标签。`PUSH_IMAGE=true bash scripts/build.sh` 也可用于流水线。

构建默认关闭 provenance 和 SBOM 证明附件，兼容当前京东云镜像仓库 仓库。若旧镜像推送出现 `unknown manifest class for application/vnd.oci.empty.v1+json`，使用更新后的脚本重新构建并推送即可；只重试推送旧镜像仍会携带原有附件。重新构建可复用已有层缓存。

本地快捷命令为 `npm run docker:build`，兼容原有的 `npm run build:ci`。例如 `npm run docker:build -- --push`。

## 2. 服务器部署镜像

### 准备部署文件

服务器只需要以下文件：

```text
/opt/customer-complaint/
  compose.yaml
  scripts/
    deploy-server.sh
```

`compose.yaml` 只包含运行配置。`.env` 已随镜像发布，无需单独上传或编辑。`compose.override.yaml` 仅供本地构建使用；两个脚本都会明确选择所需配置文件。

首次可在本地执行以下上传命令，替换服务器地址和登录用户。远程目录需要由该用户写入：

```bash
ssh deploy@your-server 'mkdir -p /opt/customer-complaint/scripts'
scp compose.yaml deploy@your-server:/opt/customer-complaint/
scp scripts/deploy-server.sh deploy@your-server:/opt/customer-complaint/scripts/
```

默认对外端口为 `3000`，云服务器安全组需要放行该端口。需要调整宿主机端口时可在部署命令前设置 `APP_PORT=其他端口`，容器内部仍监听 `3000`。本地 `.env` 中的 `APP_PORT` 用于本地 Compose 的端口映射。

### 登录并部署

在服务器上执行：

```bash
docker login --username=your-jdcloud-username mate-docker-register-cn-north-1.jcr.service.jdcloud.com

cd /opt/customer-complaint
bash scripts/deploy-server.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v4
```

脚本接收完整镜像地址并执行：

1. 检查 Docker、Compose 和部署文件。
2. 拉取指定镜像。
3. 强制重新创建应用容器，应用读取镜像内的 `.env`。
4. 等待健康检查通过，默认超时 120 秒。
5. 输出容器状态；失败时打印应用日志和健康检查结果并返回非零状态。

拉取失败时不会替换现有容器；启动或健康检查失败不会自动回滚。部署不会在服务器构建镜像。

### 升级和回滚

修改项目 `.env` 中的应用配置，构建并推送新版本，然后在服务器传入新镜像地址。回滚时传入旧镜像地址，同时恢复该镜像内的应用配置：

```bash
bash scripts/deploy-server.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v5

# 回滚到 v4
bash scripts/deploy-server.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v4

# 调整健康检查等待时间
DEPLOY_TIMEOUT=180 bash scripts/deploy-server.sh mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v5
```

本地构建的镜像地址优先级为：脚本参数 > 环境变量 `IMAGE` > 项目 `.env`。服务器的镜像地址由脚本参数或环境变量 `IMAGE` 指定；脚本不会读取服务器已有的 `.env`，也不会用服务器环境变量覆盖镜像内的应用配置。

`APP_DIR` 可指定其他服务器部署目录。容器启用了自动重启、日志轮转和 HTTP 健康检查。

### 日常维护

在服务器目录执行，或通过 `IMAGE=完整镜像地址` 指定与当前容器一致的镜像：

```bash
cd /opt/customer-complaint
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs -f --tail=100 app
docker compose -f compose.yaml down
```

从旧 systemd 部署迁移时，先停用占用相同端口的旧服务：`sudo systemctl disable --now customer-complaint`。通过网关提供 HTTPS 时，工作流 SSE 流式响应需要关闭代理缓冲并配置足够的读取超时。

## 可选：通过 SSH 触发服务器部署

原有 `scripts/deploy-remote.sh` 是可选的上传和 SSH 调用工具，服务器的实际部署逻辑统一调用 `scripts/deploy-server.sh`。它会上传 Compose 文件和部署脚本，无需准备服务器 `.env`：

```bash
IMAGE=mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v4 \
SSH_HOST=your-server \
SSH_USER=deploy \
SSH_KEY=/path/to/ssh-key \
REMOTE_APP_DIR=/opt/customer-complaint \
bash scripts/deploy-remote.sh
```

可选 `SSH_PORT` 默认为 `22`，SSH 私钥通过流水线凭据管理。`npm run deploy:remote` 调用同一工具。

## 构建和健康检查排查

- `127.0.0.1:10887 connection refused`：Docker 使用了不可连接的代理，修改 Docker Desktop 的代理设置并重启。
- `hub-mirror.c.163.com` 请求失败：在 Docker Engine 设置中移除不可用的镜像加速器。
- `auth.docker.io/token` 超时：配置 Docker 可用的网络代理，或将 `BASE_IMAGE` 设置为可访问的官方镜像来源或自有仓库。ECR Public 来源示例为 `public.ecr.aws/docker/library/node:22-bookworm-slim`。
- `unhealthy`：查看部署脚本输出的应用日志和健康检查结果。首页语言解析已处理无语言头时的通配符；需要重新构建、推送并部署新镜像，修复才会生效。

镜像采用 Node.js 22 和 Next.js standalone 产物，以普通用户运行。现有 React 依赖存在 peer 版本约束冲突，构建通过 `npm ci --legacy-peer-deps` 按锁文件安装。

## 本地开发

使用 Node.js 22，直接使用项目 `.env` 中的应用参数，然后运行：

```bash
npm ci --legacy-peer-deps
npm run dev
```

应用标题、默认语言等信息在 `config/index.ts` 中配置。本地测试 Docker 容器时，先执行 `bash scripts/build.sh`，再运行 `docker compose up -d --no-build --wait --wait-timeout 120`。构建使用脚本参数指定镜像时，也需通过 `IMAGE` 向 Compose 指定相同镜像。
