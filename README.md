# 客户投诉分析

基于 Next.js 和 Dify 的客户投诉分析应用，支持单次分析和批量处理。生产环境使用 Docker Compose 部署，服务器只需安装 Docker Engine 和 Docker Compose v2（支持 `up --wait`），无需安装 Node.js、npm 或 systemd 服务。

## Docker 部署

### 1. 配置环境变量

在项目根目录执行：

```bash
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，填写实际配置：

```dotenv
NEXT_PUBLIC_APP_ID=your-app-id
NEXT_PUBLIC_API_URL=https://your-dify-server.example.com/v1
NEXT_PUBLIC_APP_TYPE_WORKFLOW=true
NEXT_PUBLIC_APP_BASE_URL_PATH=
NEXT_PUBLIC_API_PREFIX=/api
DIFY_API_KEY=your-dify-api-key
BATCH_RUN_PASSWORD=your-batch-password
IMAGE=customer-complaint:latest
APP_PORT=3000
```

`NEXT_PUBLIC_API_URL` 需要包含 Dify API 前缀（通常是 `/v1`），并且能从容器内访问。如果 Dify 运行在宿主机或其他容器中，请使用容器可访问的地址；容器中的 `localhost` 指向容器自身。

| 配置 | 生效时机 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_ID` | 构建时 | Dify 应用 ID |
| `NEXT_PUBLIC_API_URL` | 构建时 | Dify API 地址 |
| `NEXT_PUBLIC_APP_TYPE_WORKFLOW` | 构建时 | 工作流应用设为 `true` |
| `NEXT_PUBLIC_APP_BASE_URL_PATH` | 构建时 | 根路径部署留空；子路径例如 `/complaints`，不要以 `/` 结尾 |
| `NEXT_PUBLIC_API_PREFIX` | 构建时 | 默认为 `/api`；子路径部署时设为 `/complaints/api` |
| `DIFY_API_KEY` | 运行时 | 仅服务端使用，不传入镜像构建 |
| `BATCH_RUN_PASSWORD` | 运行时 | 批量分析密码，留空使用应用默认值 |
| `IMAGE` | 部署时 | 本地镜像名称或完整仓库地址和版本标签 |
| `BASE_IMAGE` | 构建时 | Node.js 基础镜像，默认 `node:22-bookworm-slim` |
| `APP_PORT` | 部署时 | 宿主机端口，默认 `3000` |

`NEXT_PUBLIC_*` 参数会写入构建产物，修改后必须重新构建镜像；只在 `docker run -e` 或服务器 `.env` 中修改它们不会改变应用配置。密钥修改后重新创建容器即可。`.env` 已从 Git 和 Docker 构建上下文中排除。

### 2. 构建并启动

```bash
docker compose up -d --build --wait --wait-timeout 120
```

默认访问 [http://localhost:3000](http://localhost:3000)。使用子路径时访问对应路径，例如 `http://localhost:3000/complaints`。

镜像使用 Node.js 22、多阶段构建和 Next.js standalone 产物，以普通用户运行，内置 HTTP 健康检查。Compose 配置自动重启和日志轮转。现有依赖存在 React peer 版本约束冲突，镜像构建通过 `npm ci --legacy-peer-deps` 按锁文件安装，不升级依赖。

### 3. 日常维护

```bash
# 状态和日志
docker compose ps
docker compose logs -f --tail=100 app

# 更新代码或构建参数后重建
docker compose up -d --build --wait --wait-timeout 120

# 更新密钥或批量密码后重新创建容器
docker compose up -d --force-recreate --wait --wait-timeout 120

# 停止并删除容器
docker compose down
```

## 阿里云流水线与远程发布

流水线构建镜像并推送到容器镜像仓库，服务器拉取镜像并通过 Compose 启动。构建节点与服务器的 CPU 架构需要一致；跨架构发布请使用 Docker Buildx 构建目标平台镜像。

### 1. 构建并推送镜像

构建节点需要项目源码、Docker 和 Compose。通过流水线环境变量注入 `NEXT_PUBLIC_*` 构建配置，或使用构建节点的 `.env`；构建不需要 `DIFY_API_KEY`。提前通过流水线凭据完成镜像仓库登录，再执行：

```bash
export IMAGE="registry.cn-hangzhou.aliyuncs.com/your-namespace/customer-complaint:${BUILD_NUMBER}"
PUSH_IMAGE=true bash scripts/build.sh
```

`npm run build:ci` 同样调用此脚本，默认只构建；设置 `PUSH_IMAGE=true` 时会推送 `IMAGE` 指定的镜像。使用版本标签便于回滚。

### 2. 初始化服务器

服务器安装 Docker 和 Compose，部署账号需要有 Docker 操作权限，并提前登录镜像仓库。创建应用目录和运行配置：

```bash
mkdir -p /opt/customer-complaint/scripts
chmod 700 /opt/customer-complaint
```

在服务器的 `/opt/customer-complaint/.env` 中配置 `DIFY_API_KEY`、`BATCH_RUN_PASSWORD` 和可选的 `APP_PORT`，并执行 `chmod 600 /opt/customer-complaint/.env`。服务器不需要构建参数或源码。

从旧 systemd 部署迁移时，先停用旧服务，释放相同的端口：

```bash
sudo systemctl disable --now customer-complaint
```

### 3. 通过 SSH 发布

在流水线中执行（SSH 私钥由流水线凭据提供）：

```bash
IMAGE="registry.cn-hangzhou.aliyuncs.com/your-namespace/customer-complaint:${BUILD_NUMBER}" \
SSH_HOST=your-server \
SSH_USER=deploy \
SSH_KEY=/path/to/ssh-key \
REMOTE_APP_DIR=/opt/customer-complaint \
bash scripts/deploy-remote.sh
```

脚本支持可选的 `SSH_PORT`（默认 `22`），会检查服务器 `.env`、上传 `compose.yaml` 和 `scripts/deploy-server.sh`，再调用服务器部署脚本。`npm run deploy:remote` 调用同一 SSH 发布脚本。

### 4. 在服务器上执行部署脚本

服务器目录只需以下文件；通过上面的 SSH 脚本发布时会自动上传 Compose 文件和部署脚本，`.env` 由服务器维护：

```text
/opt/customer-complaint/
  compose.yaml
  .env
  scripts/
    deploy-server.sh
```

服务器 `.env` 示例（使用实际密钥和密码）：

```dotenv
DIFY_API_KEY=your-dify-api-key
BATCH_RUN_PASSWORD=your-batch-password
APP_PORT=3000
```

服务器先登录 ACR；镜像仓库域名和用户名以阿里云控制台提供的信息为准，密码按提示输入：

```bash
docker login --username=your-acr-username registry.cn-hangzhou.aliyuncs.com
```

直接执行部署脚本，传入要发布的完整镜像地址：

```bash
cd /opt/customer-complaint
bash scripts/deploy-server.sh registry.cn-hangzhou.aliyuncs.com/your-namespace/customer-complaint:v1
```

脚本检查 Docker 和部署文件、将 `.env` 权限设为 `600`、拉取镜像、强制重新创建容器，并等待健康检查通过，默认超时 120 秒。设置 `DEPLOY_TIMEOUT=180` 可调整等待时间；`APP_DIR` 可指定其他部署目录。拉取镜像失败时不会替换现有容器；启动或健康检查失败时会输出应用日志和健康检查结果并返回非零状态，不会自动回滚。回滚时再次执行脚本，传入旧版本镜像地址即可。

服务器重启后容器按重启策略自动启动；后续手动运行 Compose 时继续指定该版本 `IMAGE`，或将其保存到服务器 `.env`。对外提供域名和 HTTPS 时，可由现有网关或负载均衡转发到 `APP_PORT`；工作流使用 SSE 流式响应，代理需关闭响应缓冲并配置足够的读取超时。云服务器安全组需要允许访问相应端口。

## Docker 构建网络排查

如果构建提示 `connecting to 127.0.0.1:10887` 和 `connection refused`，说明 Docker 使用的代理不可连接。请在 Docker Desktop 的 Settings → Resources → Proxies 中关闭手动代理，或将 HTTP/HTTPS 代理改为实际可用的地址，然后应用设置并重启 Docker Desktop。使用系统代理时，也需要确认系统代理服务正常运行。

在 Settings → Docker Engine 中检查 `registry-mirrors`，移除无法访问的加速器（例如报错中的 `https://hub-mirror.c.163.com`），保留实际可用的 Docker Hub 镜像加速器；网络允许直连时可设为空数组。此处是 Docker Hub 的拉取加速配置，与 `.env` 的应用镜像发布地址 `IMAGE` 分别配置。

修复后先验证基础镜像拉取，再重新构建：

```bash
docker pull node:22-bookworm-slim
docker compose up -d --build --wait --wait-timeout 120
```

Dockerfile 使用 Docker 自带的 BuildKit 构建前端，避免额外拉取 `docker/dockerfile:1`；基础镜像和 npm 依赖仍需要可用网络。

如果报错为 `auth.docker.io/token` 连接超时，说明 Docker Hub 的认证服务无法访问。可在 `.env` 中将基础镜像切换到 Docker 官方镜像在 Amazon ECR Public 的来源，再重新构建：

```dotenv
BASE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim
```

```bash
docker compose up -d --build --wait --wait-timeout 120
```

`BASE_IMAGE` 控制构建时下载的 Node 镜像，`IMAGE` 控制应用镜像发布到哪个仓库。ECR Public 也需要可用的网络；若该来源同样无法访问，应配置 Docker 可用的代理，或在可联网的机器将 Node 镜像同步到自己的仓库，再把 `BASE_IMAGE` 设置为该仓库地址。

## 本地开发

使用 Node.js 22，在 `.env.local` 中配置 `.env.example` 中的应用参数，然后运行：

```bash
npm ci --legacy-peer-deps
npm run dev
```

应用信息（标题、语言等）在 `config/index.ts` 中配置。
