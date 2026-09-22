# Sauna Studio configurator - production image.
# Multi-stage build: compile the Vite frontend, then run the Express server
# (which serves the built dist/ and the /api endpoints) under Node.
#
# Build:  docker build -t sauna-studio .
# Run:    docker run -p 3001:3001 -v sauna-data:/app/data sauna-studio
# (see docker-compose.yml for the full setup incl. a named volume for the
# sqlite database, used for quote requests and saved designs)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prepare-assets copies the Blender-generated catalog/presets/models into
# public/ before the Vite build; these are checked into the repo already
# (blender/catalog.json, blender/presets.json, output/blender/...).
RUN npm run assets && npx vite build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY server ./server
COPY src/state.js ./src/state.js
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0 SAUNA_DATABASE=/app/data/sauna.sqlite
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
