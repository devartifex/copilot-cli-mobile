FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

FROM node:20-slim

# Install Copilot CLI (required by @github/copilot-sdk)
RUN npm install -g @github/copilot

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules node_modules/

COPY --from=builder /app/dist dist/
COPY public/ public/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/auth/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
