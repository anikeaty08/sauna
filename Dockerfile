# Sauna Studio configurator - production image.
#
# The web app is fully self-contained: public/assets/data (catalog + presets),
# public/assets/images/presets and public/assets/models/presets are committed
# to the repo, so this build never touches Blender, blender/, or output/ -
# those live entirely outside the deployable app (see blender/README.md for
# the separate, optional asset-authoring pipeline).
#
# Multi-stage build: compile the Vite frontend, then run the Express server
# (serves dist/ + the /api endpoints) under Node.
#
# Build:  docker build -t sauna-studio .
# Run:    docker compose up -d --build   (see docker-compose.yml)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY app/client ./app/client
COPY public ./public
RUN npx vite build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY app/server ./app/server
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0 SAUNA_DATABASE=/app/data/sauna.sqlite
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app/server/index.js"]
