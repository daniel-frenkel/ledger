# The clinician app, as a Cloud Run service.
#
# Cloud Run and not Firebase Hosting, for the same reason as the client PWA:
# Firebase Hosting is not on Google's HIPAA covered-products list and this app
# reads client records. See docs/deploy.md.
#
# It is also not a static site — it is a Next.js server with prerendered pages,
# so `output: 'standalone'` in next.config.ts emits a server plus only the
# node_modules it actually reaches. The runtime image carries no workspace and
# no dev dependencies.
#
# Build from the repo root:
#   docker build -f apps/clinician/Dockerfile --build-arg NEXT_PUBLIC_API_URL=… .

# ---- build ---------------------------------------------------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/clinician/package.json apps/clinician/
RUN pnpm install --frozen-lockfile --filter @ledger/clinician...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/clinician apps/clinician

# Next.js inlines NEXT_PUBLIC_* at build time, so these are properties of the
# image rather than of the revision. All public by design: the Identity
# Platform key names the project and authorises nothing.
ARG NEXT_PUBLIC_API_URL=https://api.courageloop.com
ARG NEXT_PUBLIC_WEB_URL=https://app.courageloop.com
ARG NEXT_PUBLIC_CLINICIAN_URL=https://courageloop.com
ARG NEXT_PUBLIC_AUTH_PROVIDER=identity-platform
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_CLINICIAN_URL=$NEXT_PUBLIC_CLINICIAN_URL \
    NEXT_PUBLIC_AUTH_PROVIDER=$NEXT_PUBLIC_AUTH_PROVIDER \
    NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY=$NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY

RUN pnpm --filter @ledger/shared build && pnpm --filter @ledger/clinician build

# ---- runtime -------------------------------------------------------------
FROM node:20-bookworm-slim
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# The standalone bundle keeps the workspace shape, so the server lands at
# apps/clinician/server.js with node_modules hoisted to the root beside it.
# `static` and `public` are not traced into it and have to come separately —
# without them the pages render and every stylesheet and font 404s.
COPY --from=build /repo/apps/clinician/.next/standalone ./
COPY --from=build /repo/apps/clinician/.next/static ./apps/clinician/.next/static
COPY --from=build /repo/apps/clinician/public ./apps/clinician/public

USER node
EXPOSE 8080
CMD ["node", "apps/clinician/server.js"]
