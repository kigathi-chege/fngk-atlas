FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY README.md ./README.md
RUN mkdir -p /app/.atlas
EXPOSE 4317
CMD ["node", "src/server.js"]
