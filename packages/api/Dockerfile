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

# ---- runtime -------------------------------------------------------------
# Same image works on Render (web service, Docker) and Cloud Run. Both inject
# PORT. No platform-specific files anywhere in the repo.
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /repo/packages/api/dist /app/dist
COPY --from=build /repo/packages/api/src/db/migrations /app/src/db/migrations
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
