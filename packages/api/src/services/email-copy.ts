/**
 * Every word this system ever emails, and nothing else.
 *
 * **No PHI in email bodies, ever.** Outbound mail already carries the
 * recipient's address and the fact that an account exists at a mental health
 * product, and that association is the protected element. The body is not
 * allowed to add to it. A message may say an action is waiting and link to the
 * app. It may not name a clinician, a client, a session, a date, a prediction,
 * a floor, a protocol, or anything a client wrote.
 *
 * The enforcement is structural rather than editorial: **the composer takes
 * one argument, a link.** There is no parameter through which a name or a date
 * could arrive, so adding one is a visible change to a signature rather than a
 * quiet interpolation into a template. `test/phi-email.test.ts` asserts the
 * rendered output against a fixed string, so any edit to the copy fails until
 * someone looks at it.
 *
 * Kept apart from the transport for the same reason the crisis rules are kept
 * apart from the screens that show them: what is said should be reviewable
 * without reading how it is sent.
 */

/** Who the mail is from, in the one place it is written down. */
export const MAIL_FROM_NAME = 'CourageLoop';

export interface Composed {
  subject: string;
  text: string;
}

/**
 * The sign-in link email.
 *
 * Deliberately dull. It does not greet by name — there is no name in this
 * system to greet with — and it says what the link does so that someone who
 * did not ask for it knows to ignore it rather than wondering.
 */
export function signInEmail(link: string): Composed {
  return {
    subject: 'Your CourageLoop sign-in link',
    text: [
      'Someone asked to sign in to CourageLoop with this email address.',
      '',
      'Open this link on the device you want to use. It works once and then expires:',
      '',
      link,
      '',
      'If that was not you, nothing has happened and you can ignore this. The link',
      'cannot be used without this email address.',
      '',
      'CourageLoop is a notebook for behavioral experiments. Not a therapist, and',
      'not a treatment. If you are in crisis, call or text 988 (Suicide & Crisis',
      'Lifeline). Veterans: dial 988 and press 1, or text 838255.',
      '',
      'This message was sent by CourageLoop because someone entered this address.',
      'Nobody is told that you received it.',
    ].join('\n'),
  };
}

/**
 * Every composer in this module, for the test that walks them.
 *
 * A new message added here is automatically covered; a new message added
 * somewhere else is the thing the test cannot see, which is why the transport
 * refuses to send anything it was not given by one of these.
 */
export const COMPOSERS = [
  { name: 'signInEmail', render: () => signInEmail('https://app.courageloop.com/auth/callback?oobCode=TESTCODE') },
] as const;
