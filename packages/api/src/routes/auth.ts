/**
 * Starting a sign-in — go-live gate A4.
 *
 * The client used to call Identity Platform directly, which meant Identity
 * Platform composed and sent the email. Now the client calls this, and this
 * mints the link through the auth seam and sends the message from our own
 * copy. `docs/deploy.md` §11 has the reasoning; the short version is that a
 * body we cannot see is a body we cannot hold to the "no PHI in email bodies"
 * rule.
 *
 * **Unauthenticated, necessarily** — it is how you sign in. So it is the most
 * exposed route in the system, and three things follow:
 *
 *   **It never says whether an address is known.** Every outcome is 204,
 *   including a refusal. Anything else is an account-existence oracle on a
 *   mental health product, which is a disclosure question rather than a spam
 *   question.
 *
 *   **It is rate-limited by address as well as by IP.** A per-IP limit alone
 *   lets one address be mailed repeatedly from a botnet, and the person being
 *   mailed is the victim of that, not the attacker.
 *
 *   **It logs no address.** The address is the whole of the PHI here.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { authAdmin, authAdminConfigured } from '../auth-admin.js';
import { emailConfigured, sendSignInLink } from '../services/email.js';

export const SIGN_IN_PATH = '/v1/auth/sign-in-link';

const bodySchema = z.object({
  email: z.string().email().max(320),
  /** Which app is asking, so the link lands back on the right origin. */
  app: z.enum(['client', 'clinician']).default('client'),
});

/**
 * A per-address key that is not the address.
 *
 * The rate limiter keeps its keys in memory and they can reach a log line on
 * an error path, so what it holds is a hash. A fixed salt per process is
 * enough: the limiter only needs two requests for the same address to collide.
 */
const salt = crypto.randomBytes(16);
const addressKey = (email: string): string =>
  crypto.createHmac('sha256', salt).update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 32);

const auth: FastifyPluginAsync = async (app) => {
  app.post(
    SIGN_IN_PATH,
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          /**
           * Keyed by **address** when there is one, falling back to IP.
           *
           * The two keys are not redundant and the address one is not an
           * optimisation — do not collapse them into an IP limit.
           *
           * Ordinary rate limiting protects the service from a caller. Here
           * the service is not the victim: **the recipient is.** A per-IP
           * limit lets a distributed source mail one person all night by
           * varying its address of origin, and every counter looks healthy
           * throughout, because no single IP did anything unusual. The person
           * receiving five hundred sign-in emails from a mental health product
           * is the one harmed, and nothing in a per-IP view would show it.
           *
           * The IP key is the fallback for requests with no parseable address,
           * which is the only case where there is nobody to protect.
           */
          keyGenerator: (req: FastifyRequest) => {
            const body = req.body as { email?: unknown } | undefined;
            return typeof body?.email === 'string' ? `a:${addressKey(body.email)}` : `i:${req.ip}`;
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body);
      // Field names only. A zod message quotes the value it rejected, and the
      // value here is an email address.
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid payload', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      }
      const { email, app: which } = parsed.data;
      const c = config();

      if (!authAdminConfigured() || !emailConfigured()) {
        // A 503 is honest here and leaks nothing: it is a statement about this
        // deployment, not about the address.
        return reply.status(503).send({ error: 'sign-in by email is not available in this deployment' });
      }

      const base = which === 'clinician' ? c.CLINICIAN_URL : c.WEB_URL;
      try {
        const link = await authAdmin().signInLink(email, `${base.replace(/\/+$/, '')}/auth/callback`);
        await sendSignInLink(email, link);
      } catch (err) {
        // Deliberately swallowed. An unknown address, a provider refusal and a
        // relay failure must be indistinguishable from success, or this route
        // answers "does this person have an account here".
        //
        // The type only — never the message, which quotes the envelope.
        request.log.warn({ signIn: { failed: (err as Error).name } }, 'sign-in link not sent');
      }
      return reply.status(204).send();
    },
  );
};

export default auth;
