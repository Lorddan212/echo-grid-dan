FROM node:24-bookworm-slim
WORKDIR /app
COPY rules.js ./
COPY server/server.cjs ./server/
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/echo-grid.sqlite
EXPOSE 8787
CMD ["node", "server/server.cjs"]
