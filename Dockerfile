FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/build build/
COPY --from=builder /app/dist dist/
COPY --from=builder /app/server.js ./
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/node

RUN npm install -g @github/copilot
RUN mkdir -p /home/node/.copilot/session-state /data/sessions /data/settings && chown -R node:node /home/node /data

# Copy bundled CLI sessions if they were prepared with scripts/bundle-sessions.mjs
COPY --chown=node:node bundled-sessions/ /home/node/.copilot/session-state/
ENV COPILOT_CONFIG_DIR=/home/node/.copilot

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
