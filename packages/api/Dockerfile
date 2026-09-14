# ---- build ---------------------------------------------------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile --filter @ledger/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/api packages/api
RUN pnpm --filter @ledger/shared build && pnpm --filter @ledger/api build
RUN pnpm --filter @ledger/api --prod deploy /out

# ---- verify --------------------------------------------------------------
# The Cloud SQL verification job (docs/deploy.md §6), built with
# `--target=verify`. It is not the runtime image and must never be deployed as
# one: it carries the full workspace, the dev dependencies and a Postgres
# client, none of which belong in a server that handles requests.
#
# It exists because the runtime image cannot do this job. That image has no
# pnpm, no vitest, no test files and no psql — and giving it any of those to
# save a build target would mean shipping a test runner to production.
#
# Placed before the runtime stage deliberately: Docker builds the last stage by
# default, and the default must be the server.
FROM build AS verify
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
CMD ["bash", "packages/api/scripts/verify-cloudsql.sh"]

# ---- runtime -------------------------------------------------------------
# Portable: the same image runs on Cloud Run and on anything else that injects
# PORT. Nothing platform-specific is baked in — the Cloud Run specifics are
# environment variables and a Secret Manager binding, set at deploy time.
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /repo/packages/api/dist /app/dist
COPY --from=build /repo/packages/api/src/db/migrations /app/src/db/migrations

# Two directories the API reads from disk at runtime, and the reason this image
# needs them rather than merely benefiting from them:
#
#   docs/theory/ — the locating assistant's system prompt is read from the
#     corpus, not copied into src/, so that it cannot drift from the document
#     a clinician could be shown. With ASSISTANT_ENABLED the server calls
#     assertCorpusAvailable() at boot, so an image without this fails to start
#     rather than building a truncated prompt on the first real note.
#
#   docs/legal/ — the clinician BAA's frontmatter is the only source of the
#     version anyone accepts. Without it the two BAA routes answer 503 and the
#     rest of the API carries on, which is the right failure: recording consent
#     to a version nobody can produce would be worse.
#
# DOCS_ROOT is what makes them findable. Both readers used to walk up for
# pnpm-workspace.yaml, which works in a checkout and silently fails here — the
# walk reaches / and gives up. Stating the location beats inferring it from a
# file that happens to be lying around.
# Straight from the build context, not from the build stage: the build stage
# copies only the two packages, and these are data rather than anything
# compiled. A test asserts both lines are still here.
COPY docs/theory /app/docs/theory
COPY docs/legal /app/docs/legal
ENV DOCS_ROOT=/app

USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
