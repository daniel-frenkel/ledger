/**
 * Sending mail, through the Google Workspace SMTP relay.
 *
 * **Why the API sends rather than Identity Platform.** Three reasons, in
 * order. It is the only way to control the body under the "no PHI in email
 * bodies" rule — Identity Platform's templates are console state and can be
 * edited by anyone with console access, and they interpolate the project name.
 * It makes the provider a configuration change rather than a re-plumb. And it
 * lets the relay authenticate by IP allowlist, which means **no credential
 * exists at all** rather than one being well stored.
 *
 * Identity Platform's own Custom SMTP setting is deliberately left off, and
 * that is a decision rather than an omission: Google's servers would connect
 * to the relay from addresses we cannot enumerate, so it could only ever use
 * SMTP AUTH — a Workspace account password living inside Identity Platform's
 * configuration, outside Secret Manager, with no clean rotation. That is the
 * credential path we rejected, in a worse place. See `docs/deploy.md` §11.
 *
 * **No authentication on this transport, on purpose.** The relay accepts mail
 * from the deployment's static egress IP and from nowhere else. TLS is
 * required, so the absence of a password is not an absence of protection.
 *
 * Ships off. With `EMAIL_ENABLED` unset nothing is sent and the caller is told
 * so, which is the correct behaviour until the relay has an IP to allowlist.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { MAIL_FROM_NAME, signInEmail, type Composed } from './email-copy.js';

export class EmailUnavailableError extends Error {
  constructor(reason: string) {
    super(`email is unavailable (${reason})`);
    this.name = 'EmailUnavailableError';
  }
}

let transport: Transporter | undefined;

function transporter(): Transporter {
  const c = config();
  if (!c.EMAIL_ENABLED) throw new EmailUnavailableError('EMAIL_ENABLED is off');
  if (!c.MAIL_FROM) throw new EmailUnavailableError('MAIL_FROM is not set');
  transport ??= nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    // STARTTLS on 587 rather than implicit TLS on 465, which is what the
    // Workspace relay speaks. `requireTLS` makes the upgrade mandatory: without
    // it a failed STARTTLS would silently continue in plaintext.
    secure: false,
    requireTLS: true,
    // No `auth` key, deliberately. The relay is configured to accept mail only
    // from this deployment's egress IP, so there is no password to hold, to
    // rotate, or to leak. Adding `auth` here would be a regression.
    tls: { minVersion: 'TLSv1.2' },
  });
  return transport;
}

/** Test seam, in the shape of `setAuthAdmin`. */
export function setTransport(t: Transporter | undefined): void {
  transport = t;
}

/** Whether a send would be attempted at all. Callers check before promising anything. */
export const emailConfigured = (): boolean => {
  const c = config();
  return !!c.EMAIL_ENABLED && !!c.MAIL_FROM;
};

/**
 * Send one composed message.
 *
 * Private, because the only things that may be sent are the composers in
 * `email-copy.ts`. A caller cannot hand this arbitrary text: that is what
 * keeps the "no PHI in bodies" rule enforceable by reading one small file.
 */
async function send(to: string, message: Composed): Promise<void> {
  const c = config();
  try {
    await transporter().sendMail({
      from: `${MAIL_FROM_NAME} <${c.MAIL_FROM}>`,
      to,
      subject: message.subject,
      text: message.text,
    });
  } catch (err) {
    // Never the provider's message: an SMTP error quotes the envelope, and the
    // envelope is an address.
    throw new EmailUnavailableError(`send failed (${(err as Error).name})`);
  }
}

/**
 * The sign-in link email. The only message this system sends today.
 *
 * Named for the *transport*, not for the concept. `@ledger/shared` has a
 * `sendSignInLink` that asks Identity Platform to compose and send the mail
 * itself — a different layer, a different credential, and the thing this
 * replaced. Two functions of the same name on either side of that boundary is
 * a trap for exactly the audit that would come looking for it: a grep lands on
 * one, reads like the other, and the wrong conclusion is the plausible one.
 */
export const deliverSignInLinkEmail = (to: string, link: string): Promise<void> =>
  send(to, signInEmail(link));
