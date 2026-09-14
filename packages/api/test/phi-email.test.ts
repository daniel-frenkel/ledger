/**
 * No PHI in email bodies, ever. The sibling of `phi-logs.test.ts`.
 *
 * Outbound mail already carries the recipient's address and the fact that an
 * account exists at a mental health product. That association is the protected
 * element, and it is unavoidable — you cannot email someone without their
 * address. What *is* avoidable is the body adding to it, so the body is held
 * to a rule: it may say an action is waiting and link to the app; it may not
 * name a clinician, a client, a session, a date, a prediction, a floor, a
 * protocol, or anything a client wrote.
 *
 * The enforcement is structural before it is editorial. **A composer takes a
 * link and nothing else**, so there is no parameter through which a name or a
 * date could arrive — adding one is a change to a signature, which is visible,
 * rather than an interpolation into a template, which is not. These tests
 * check that the structure holds and that the words that exist stay within it.
 *
 * `phi-logs.test.ts` seeds distinctive strings and greps what the logger
 * wrote. The same trick does not work here: there is no user input reaching a
 * body to seed. So this asserts the opposite direction — the exact rendered
 * output, so that any edit to the copy fails until somebody reads it.
 */
import { describe, expect, it } from 'vitest';
import { COMPOSERS, signInEmail } from '../src/services/email-copy.js';

const LINK = 'https://app.courageloop.com/auth/callback?oobCode=TESTCODE';

/**
 * Words that would mean a body had started describing someone's care.
 *
 * Both vocabularies: what a client would recognise, and the theory terms that
 * never belong in client-facing copy either.
 */
const FORBIDDEN = [
  'clinician',
  'therapist’s',
  'client',
  'session',
  'appointment',
  'prediction',
  'predicted',
  'prior',
  'floor',
  'protocol',
  'formulation',
  'journal',
  'diagnosis',
  'furnace',
  'precision',
  'ledger entry',
];

describe('every email this system can send', () => {
  it('has a composer whose only input is a link', () => {
    // If a composer ever takes a second argument, this is the line that fails,
    // and the review that follows is the point of the rule.
    expect(signInEmail.length).toBe(1);
    for (const c of COMPOSERS) expect(typeof c.render).toBe('function');
  });

  it('names nobody and describes nothing', () => {
    for (const c of COMPOSERS) {
      const { subject, text } = c.render();
      const haystack = `${subject}\n${text}`.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(haystack, `${c.name} contains "${word}"`).not.toContain(word);
      }
    }
  });

  it('carries no date, and no id that is not the link', () => {
    for (const c of COMPOSERS) {
      const { subject, text } = c.render();
      const withoutLink = `${subject}\n${text}`.split(LINK).join('');
      // A date in any of the shapes this codebase produces.
      expect(withoutLink).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(withoutLink).not.toMatch(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
      // A UUID, which is how every person and row in this system is named.
      expect(withoutLink).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });

  it('contains the link, and exactly one URL', () => {
    const { text } = signInEmail(LINK);
    expect(text).toContain(LINK);
    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    expect(urls).toEqual([LINK]);
  });

  /**
   * The exact copy. Not a style check — a tripwire.
   *
   * Every other assertion here is a rule about a category, and a category can
   * be satisfied by text that is still wrong. This one fails on any edit at
   * all, which means the copy cannot drift without someone deciding it should.
   */
  it('reads exactly as written, or somebody looks at it', () => {
    const { subject, text } = signInEmail(LINK);
    expect(subject).toBe('Your CourageLoop sign-in link');
    expect(text).toBe(
      [
        'Someone asked to sign in to CourageLoop with this email address.',
        '',
        'Open this link on the device you want to use. It works once and then expires:',
        '',
        LINK,
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
    );
  });

  /**
   * The crisis line is in here for the same reason it is on every client
   * screen: this may be the only thing a person opens today.
   */
  it('carries the crisis numbers', () => {
    const { text } = signInEmail(LINK);
    expect(text).toContain('988');
    expect(text).toContain('838255');
  });
});
