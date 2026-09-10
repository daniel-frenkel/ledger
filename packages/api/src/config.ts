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

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default('0.0.0.0'),

    DATABASE_URL: z.string().url(),
    DATABASE_MIGRATE_URL: z.string().url().optional(),
    /** PEM of a private CA to pin for the database TLS connection. Optional. */
    DATABASE_CA_CERT: z.string().optional(),

    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),

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
    if (!c.SUPABASE_JWKS_URL && !c.SUPABASE_JWT_SECRET && !c.AUTH_TEST_MODE) {
      ctx.addIssue({ code: 'custom', message: 'Set SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET' });
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

/** Root keys by version, for rotation. Version N reads FIELD_ENCRYPTION_KEY_V<N>, current reads FIELD_ENCRYPTION_KEY. */
export function rootKeyForVersion(version: number, env: NodeJS.ProcessEnv = process.env): Buffer {
  const c = config();
  const raw = version === c.FIELD_ENCRYPTION_KEY_VERSION ? c.FIELD_ENCRYPTION_KEY : env[`FIELD_ENCRYPTION_KEY_V${version}`];
  if (!raw) throw new Error(`No encryption key configured for version ${version}`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`Encryption key v${version} must be 32 bytes`);
  return key;
}
