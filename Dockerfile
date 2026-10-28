FROM node:22-bookworm-slim
ENV NODE_ENV=production BIND=0.0.0.0 PORT=21030 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 21030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:21030/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
