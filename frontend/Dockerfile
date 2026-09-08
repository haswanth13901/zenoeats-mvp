# Multi-stage. The previous single-stage image ran `npm run dev` as its
# production command: an unoptimised dev server with HMR and source maps
# exposed, rebuilding every route on demand.

FROM node:22-alpine AS deps
WORKDIR /srv
COPY package.json package-lock.json* ./
# `ci` installs exactly the lockfile, and fails instead of silently drifting.
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /srv
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /srv/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they must be present here, not only at runtime.
ARG NEXT_PUBLIC_API_BASE=/api/v1
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
# Likewise rewrites(): `next build` evaluates it and bakes the result into
# .next/routes-manifest.json. Supplying this only at runtime left the
# manifest on the build-time default of 127.0.0.1:8000, which inside a
# container is the container itself -- every /api call 500'd.
ARG API_PROXY_ORIGIN
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    API_PROXY_ORIGIN=$API_PROXY_ORIGIN
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /srv
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone carries its own minimal node_modules; static and public are not
# included in it and must be copied alongside.
COPY --from=build --chown=nextjs:nodejs /srv/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /srv/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
