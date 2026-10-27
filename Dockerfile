ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 HUSKY=0
COPY package.json package-lock.json ./
# Existing dependencies include React peer ranges older than the locked version.
RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_APP_ID
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_TYPE_WORKFLOW=true
ARG NEXT_PUBLIC_APP_BASE_URL_PATH=""
ARG NEXT_PUBLIC_API_PREFIX=/api
ENV NEXT_PUBLIC_APP_ID=${NEXT_PUBLIC_APP_ID} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_TYPE_WORKFLOW=${NEXT_PUBLIC_APP_TYPE_WORKFLOW} \
    NEXT_PUBLIC_APP_BASE_URL_PATH=${NEXT_PUBLIC_APP_BASE_URL_PATH} \
    NEXT_PUBLIC_API_PREFIX=${NEXT_PUBLIC_API_PREFIX}
RUN npm run build

FROM ${BASE_IMAGE} AS runner
WORKDIR /app
ARG NEXT_PUBLIC_APP_BASE_URL_PATH=""
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_BASE_URL_PATH=${NEXT_PUBLIC_APP_BASE_URL_PATH}
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:(process.env.NEXT_PUBLIC_APP_BASE_URL_PATH||'')+'/'},r=>{console.log('HTTP '+r.statusCode);r.resume();process.exit(r.statusCode>=200&&r.statusCode<400?0:1)}).on('error',e=>{console.error(e.message);process.exit(1)}).setTimeout(4000,function(){this.destroy(new Error('Health check timeout'))})"
CMD ["node", "server.js"]
