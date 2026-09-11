/**
 * The only place process.env is read. Validated at startup; the server
 * refuses to boot on a bad config rather than failing on the first request.
 */
import { z } from 'zod';
import { loadEnv } from './env.js';

// The root .env, wherever this was launched from. Real env vars still win.
loadEnv();

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const splitOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/**
 * Where the dev clients run. Added outside production only, so that `pnpm dev`
 * works from a copied `.env.example` without anyone editing the allowlist —
 * and so that nothing can add them to it in production by forgetting to.
 */
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'] as const;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default('0.0.0.0'),

    /**
     * The browser origins allowed to call this API, comma-separated. The three
     * hostnames of record, and never a wildcard — `*` is rejected below rather
     * than merely discouraged, because an allowlist that can be widened to
     * everything by one character in an env var is not an allowlist.
     */
    CORS_ORIGINS: z
      .string()
      .default('https://courageloop.com,https://app.courageloop.com,https://api.courageloop.com'),

    DATABASE_URL: z.string().url(),
    DATABASE_MIGRATE_URL: z.string().url().optional(),
    /** PEM of a private CA to pin for the database TLS connection. Optional. */
    DATABASE_CA_CERT: z.string().optional(),

    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),

    /**
     * Which identity provider owns the auth user. Supabase stays for local and
     * CI; production is Identity Platform (go-live gate A2). The code path is
     * the same either way — only these values differ.
     */
    AUTH_PROVIDER: z.enum(['supabase', 'identity-platform']).default('supabase'),

    /**
     * Where the token-signing keys live.
     *
     * Provider-neutral, and the name to use. `SUPABASE_JWKS_URL` is the old
     * name and still works for one release; it is read as a fallback below and
     * logged as deprecated at boot.
     */
    AUTH_JWKS_URL: z.string().url().optional(),
    /**
     * Who must have issued the token, and who it must be for.
     *
     * Both are checked. A token from another Identity Platform project is a
     * validly signed token — Google signs every project's tokens with the same
     * keys — so without an issuer and audience check, anyone with any Google
     * project could mint a token this API would accept. Left unset they are
     * derived from the provider below, which is the only reason they are
     * optional rather than required.
     */
    AUTH_ISSUER: z.string().optional(),
    AUTH_AUDIENCE: z.string().optional(),

    /**
     * The Google Cloud project that owns the Identity Platform tenant, e.g.
     * `courageloop-prod`. The issuer and audience of every token it mints are
     * derived from it, so this is the one value that has to be right.
     */
    GCP_PROJECT_ID: z.string().min(1).optional(),
    /**
     * The only credential in this environment that can act on another user,
     * and the only runtime use of a service-role key. Read in exactly one
     * place, src/auth-admin.ts, for exactly one call: deleting the auth user
     * when an account is deleted. It never touches the application database.
     */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    /** How long a soft-deleted row waits before the purge job removes it. */
    DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    CRON_PURGE_TICK: z.string().default('30 3 * * *'),

    FIELD_ENCRYPTION_KEY: z.string().min(1),
    FIELD_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
    /** Older keys for rotation: FIELD_ENCRYPTION_KEY_V1, _V2 … read dynamically. */

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),

    /**
     * The locating assistant. Ships off, and stays off until a BAA covering
     * the note is signed — it is the first hop where a third party reads
     * client prose. See docs/data-path.md hop 8.
     */
    ASSISTANT_ENABLED: bool.default('false'),

    SENTRY_DSN: z.string().url().optional().or(z.literal('')),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    CRON_NUDGE_TICK: z.string().default('*/15 * * * *'),
    JOBS_ENABLED: bool.default('true'),

    /** Test-only: skip JWT verification and trust an `x-test-user` header. Never on in production. */
    AUTH_TEST_MODE: bool.default('false'),
  })
  .superRefine((c, ctx) => {
    if (c.AUTH_PROVIDER === 'supabase' && !c.AUTH_JWKS_URL && !c.SUPABASE_JWKS_URL && !c.SUPABASE_JWT_SECRET && !c.AUTH_TEST_MODE) {
      ctx.addIssue({ code: 'custom', message: 'Set AUTH_JWKS_URL or SUPABASE_JWT_SECRET' });
    }
    // Identity Platform needs no JWKS URL — Google publishes one well-known
    // key set for every project — but it does need to know which project, or
    // it would accept a token minted by any Google project on earth.
    if (
      c.AUTH_PROVIDER === 'identity-platform' &&
      !c.AUTH_TEST_MODE &&
      !c.GCP_PROJECT_ID &&
      !(c.AUTH_ISSUER && c.AUTH_AUDIENCE)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GCP_PROJECT_ID'],
        message: 'required with identity-platform: the issuer and audience are derived from it',
      });
    }
    if (c.AUTH_TEST_MODE && c.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'AUTH_TEST_MODE cannot be enabled in production' });
    }
    // Fail at boot, not on the first request. A server that answers /v1/
    // assistant/locate with a 500 because a key is missing has already told a
    // clinician the feature exists.
    if (c.ASSISTANT_ENABLED && !c.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'required when ASSISTANT_ENABLED is set',
      });
    }
    // Deleting an account needs the provider credential. In production a
    // deployment without it is a deployment that cannot honour a deletion
    // request, so it does not come up; elsewhere the route refuses instead,
    // which keeps dev and CI runnable without a service-role key on disk.
    if (c.NODE_ENV === 'production' && c.AUTH_PROVIDER === 'supabase' && !c.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
        message: 'required in production: account deletion cannot be honoured without it',
      });
    }
    // Each entry must be a bare scheme-and-host. A trailing slash or a path
    // makes an entry that can never match the Origin header a browser sends,
    // which fails as a silent CORS refusal in production rather than at boot.
    for (const o of splitOrigins(c.CORS_ORIGINS)) {
      if (o === '*') {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'a wildcard is not an allowlist' });
      } else if (!/^https?:\/\/[^/\s]+$/.test(o)) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'each origin must be scheme://host[:port] with no trailing slash or path',
        });
      }
    }
    const key = Buffer.from(c.FIELD_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) {
      ctx.addIssue({ code: 'custom', path: ['FIELD_ENCRYPTION_KEY'], message: 'must be 32 bytes, base64' });
    }
  });

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty value means "not set". `.env.example` ships empty placeholders and
  // step 5 of docs/NEXT-STEPS.md says to copy it, so `SUPABASE_JWT_SECRET=` with
  // nothing after it has to mean the same as leaving the line out — otherwise
  // zod validates "" against .min(16) / .url() and the server refuses to boot.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    // Print field names only — never values.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${fields.join('\n  ')}`);
  }
  return parsed.data;
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/**
 * Google signs the Identity Platform tokens of every project with one shared
 * key set, published here. That is exactly why the issuer and audience checks
 * below are not optional: the signature alone proves the token came from
 * Google, not that it came from *this* project.
 */
export const IDENTITY_PLATFORM_JWKS =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface TokenVerification {
  jwksUrl?: string;
  /** HS256 fallback, Supabase-era projects only. */
  secret?: string;
  issuer?: string;
  audience: string;
}

/**
 * How to verify a bearer token, resolved from the provider.
 *
 * One function so that `auth/jwt.ts` has no provider branch in it: the move
 * from Supabase to Identity Platform changes the values this returns and
 * nothing about the verification itself.
 */
export function tokenVerification(c: Config = config()): TokenVerification {
  if (c.AUTH_PROVIDER === 'identity-platform') {
    const project = c.GCP_PROJECT_ID;
    return {
      jwksUrl: c.AUTH_JWKS_URL ?? IDENTITY_PLATFORM_JWKS,
      ...(c.AUTH_ISSUER ?? project ? { issuer: c.AUTH_ISSUER ?? `https://securetoken.google.com/${project}` } : {}),
      audience: c.AUTH_AUDIENCE ?? project ?? '',
    };
  }
  // Supabase. AUTH_JWKS_URL is the name going forward; SUPABASE_JWKS_URL is
  // read for one release so a deployment can be renamed without a restart.
  const jwks = c.AUTH_JWKS_URL ?? c.SUPABASE_JWKS_URL;
  const issuer = c.AUTH_ISSUER ?? (c.SUPABASE_URL ? `${c.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined);
  return {
    ...(jwks ? { jwksUrl: jwks } : {}),
    ...(c.SUPABASE_JWT_SECRET ? { secret: c.SUPABASE_JWT_SECRET } : {}),
    ...(issuer ? { issuer } : {}),
    audience: c.AUTH_AUDIENCE ?? 'authenticated',
  };
}

/** True while a deployment is still using the pre-Prompt-11 variable name. */
export const usingDeprecatedJwksName = (c: Config = config()): boolean =>
  !c.AUTH_JWKS_URL && !!c.SUPABASE_JWKS_URL;

/**
 * The CORS allowlist, as @fastify/cors wants it. An exact list: an origin not
 * on it gets no `Access-Control-Allow-Origin` header back at all.
 */
export function corsOrigins(c: Config = config()): string[] {
  const listed = splitOrigins(c.CORS_ORIGINS);
  return c.NODE_ENV === 'production' ? listed : [...listed, ...DEV_ORIGINS];
}

/** Root keys by version, for rotation. Version N reads FIELD_ENCRYPTION_KEY_V<N>, current reads FIELD_ENCRYPTION_KEY. */
export function rootKeyForVersion(version: number, env: NodeJS.ProcessEnv = process.env): Buffer {
  const c = config();
  const raw = version === c.FIELD_ENCRYPTION_KEY_VERSION ? c.FIELD_ENCRYPTION_KEY : env[`FIELD_ENCRYPTION_KEY_V${version}`];
  if (!raw) throw new Error(`No encryption key configured for version ${version}`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`Encryption key v${version} must be 32 bytes`);
  return key;
}
