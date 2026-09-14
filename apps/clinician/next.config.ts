import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * `standalone` output exists for the container: it emits a server plus only the
 * node_modules that server actually reaches, so the runtime image does not
 * carry the workspace or the dev dependencies. Cloud Run is the host because
 * Firebase Hosting is not on Google's HIPAA covered-products list and this app
 * reads client records — see docs/deploy.md.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  transpilePackages: ['@ledger/shared'],
  reactStrictMode: true,
  output: 'standalone',
  // The monorepo root, so tracing follows @ledger/shared out of this package
  // rather than stopping at it. `fileURLToPath` and not `URL.pathname`: the
  // latter yields "/C:/..." on Windows, which is not a path anything can use.
  outputFileTracingRoot: path.join(here, '..', '..'),
};
export default config;
