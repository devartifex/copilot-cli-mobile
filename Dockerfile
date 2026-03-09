FROM node:24-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci
COPY tsconfig.json tsconfig.client.json ./
COPY src/ src/
COPY public/ public/
RUN npm run build && npm prune --omit=dev

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
# Copy public/ from builder so the generated bundle.js (esbuild output) is included
COPY --from=builder /app/public public/
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/node

# Install Copilot CLI standalone (interactive agent mode)
# See: https://github.com/github/copilot-cli
RUN npm install -g @github/copilot

RUN mkdir -p /home/node && chown node:node /home/node

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
