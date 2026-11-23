FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY index.html vite.config.js ./
COPY client ./client
COPY public ./public
COPY server ./server
COPY sql ./sql
COPY scripts/migrate.js ./scripts/migrate.js
RUN npm run build && npm prune --omit=dev
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
