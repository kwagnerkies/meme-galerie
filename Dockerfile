# Optional Flow UI (React), built once and copied as static files
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# npm, yarn und corepack werden zur Laufzeit nicht gebraucht -> weniger Angriffsfläche
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn* \
 && mkdir -p /data/uploads && chown -R node:node /data

WORKDIR /app
COPY --chown=root:root package.json server.js image.js oidc.js ./
COPY --chown=root:root public ./public
COPY --from=web --chown=root:root /web/dist ./web/dist

USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
