FROM node:24-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY package.json ./
COPY public/ public/

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/node

# Install GitHub Copilot CLI standalone (interactive agent mode)
# See: https://github.com/github/copilot-cli
RUN npm install -g @github/copilot

RUN mkdir -p /home/node && chown node:node /home/node

COPY --chmod=755 entrypoint.sh /entrypoint.sh

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
