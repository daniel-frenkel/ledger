# The client PWA, as a Cloud Run service.
#
# It is a Cloud Run service and not Firebase Hosting for one reason: Firebase
# Hosting is not on Google's HIPAA covered-products list, and Google's guidance
# is that products not covered by the BAA are not to be used in connection with
# PHI. Cloud Run is covered. See docs/deploy.md for the full reasoning, which is
# written down there precisely so that nobody re-adds Firebase Hosting in six
# months for the same sensible-sounding reasons.
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=… .

# ---- build ---------------------------------------------------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ledger/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite inlines these at build time, so they are properties of the image rather
# than of the revision — a different API origin means a different build. All of
# them are public by design: the Identity Platform key names the project and
# authorises nothing, and what protects data is RLS and the token check.
ARG VITE_API_URL=https://api.courageloop.com
ARG VITE_AUTH_PROVIDER=identity-platform
ARG VITE_IDENTITY_PLATFORM_API_KEY=
ARG VITE_WEB_URL=https://app.courageloop.com
ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER \
    VITE_IDENTITY_PLATFORM_API_KEY=$VITE_IDENTITY_PLATFORM_API_KEY \
    VITE_WEB_URL=$VITE_WEB_URL

RUN pnpm --filter @ledger/shared build && pnpm --filter @ledger/web build

# ---- runtime -------------------------------------------------------------
FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
