# Build the SPA, then serve the result as static files. Node does not ship in
# the final image: nothing is rendered at request time, so there is no runtime
# for an attacker to reach.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# No build arguments, on purpose. Nothing environment-specific is baked into
# the bundle: the Clerk publishable key is read at container start (see the
# runtime stage), so the image CI builds is the image every environment runs.

# `npm run build` type-checks first. A build that compiles but fails tsc is a
# build that ships the wrong thing, so the failure belongs here.
RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Runs before nginx starts and writes /config.js from CLERK_PUBLISHABLE_KEY.
COPY docker-entrypoint.d/40-zenoeats-config.sh /docker-entrypoint.d/40-zenoeats-config.sh
RUN chmod +x /docker-entrypoint.d/40-zenoeats-config.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
