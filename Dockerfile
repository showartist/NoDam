FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM base AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/backup-meeting-db.mjs ./scripts/backup-meeting-db.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
ENV NODE_ENV=production
EXPOSE 3210
CMD ["node","node_modules/next/dist/bin/next","start","-H","0.0.0.0","-p","3210"]
