# NOTE: not built/tested in the authoring environment - verify with `docker build` on your side.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data ATTACHMENT_ROOT=/app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/attachments ./attachments
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
