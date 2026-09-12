FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json vite.config.ts ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY README.md ./README.md
RUN mkdir -p /app/.atlas
EXPOSE 4317
CMD ["node", "dist/server/index.js"]
