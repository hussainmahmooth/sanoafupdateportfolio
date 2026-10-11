FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs index.html admin.html LICENSE.txt ./
COPY --chown=node:node server/seed.json ./server/seed.json
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js
COPY --chown=node:node img ./img
COPY --chown=node:node ["NAAZIM SANOAF.pdf", "./"]
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 PORTFOLIO_DATA_DIR=/app/data NODE_ENV=production
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
