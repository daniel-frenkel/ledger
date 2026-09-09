/**
 * The thirteen protocols: slugs, titles, and the floors that route to them.
 *
 * The six-section scaffold this file used to hold was a placeholder built when
 * the documents were not on disk. They are now, and they are phase-structured —
 * "The formulation in one line", "The model's distinctive reading", Phase 0
 * through Phase 8, then "Pin targets". Where the document's structure differs
 * from the scaffold, the document wins, so the scaffold is gone: pages render
 * the document.
 *
 * Nothing here touches the filesystem. The locator on /formulate is a client
 * component and imports this module, so the document-derived parts — the
 * rendered body, the one-line summary, the Protocol/Clinical-note label — live
 * in content/protocol-docs.ts, which only server components import.
 */
import { z } from 'zod';
import { FLOOR_CONTENT } from './floors';

/** The section every phase-structured protocol opens with. */
export const ONE_LINE = 'The formulation in one line';

export const protocolSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** The locator's name for it, which is how floors route. */
  title: z.string().min(1),
  floors: z.array(z.number().int().min(1).max(8)),
});

export type Protocol = z.infer<typeof protocolSchema>;

/** The locator's protocol names, in the order the locator lists them. */
export const LOCATOR_TITLES: readonly string[] = [
  'Panic',
  'Social anxiety',
  'PTSD',
  'OCD',
  'Worry (GAD)',
  'Depression',
  'Insomnia',
  'Health anxiety',
  'Chronic pain',
  'Addiction',
  'Prolonged grief',
  'The self-story',
  'Rank-reactive mood instability',
];

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Floor 4 routes to the clinical note, which the locator's FLOORS object does
 * not carry — it predates the note. The note's own placement section calls it
 * the oscillating-presentation companion to the status-injury material, which
 * is floor 4, rank and mattering. Kept separate from FLOOR_CONTENT.proto so
 * that list stays a verbatim port of the locator.
 */
export const FLOOR_ROUTED_BY_DOCUMENT: Readonly<Record<number, readonly string[]>> = {
  4: ['Rank-reactive mood instability'],
};

/** Which floors route to a protocol title — the locator, plus the addition. */
const floorsFor = (title: string): number[] =>
  FLOOR_CONTENT.filter(
    (f) => f.proto.includes(title) || (FLOOR_ROUTED_BY_DOCUMENT[f.n] ?? []).includes(title),
  ).map((f) => f.n);

/** Every protocol title routed to a floor, locator plus document. */
export const protoTitlesForFloor = (n: number): string[] => [
  ...(FLOOR_CONTENT.find((f) => f.n === n)?.proto ?? []),
  ...(FLOOR_ROUTED_BY_DOCUMENT[n] ?? []),
];

export const PROTOCOLS: readonly Protocol[] = z.array(protocolSchema).parse(
  LOCATOR_TITLES.map((title) => ({ slug: slugify(title), title, floors: floorsFor(title) })),
);

export const protocol = (slug: string): Protocol | undefined => PROTOCOLS.find((p) => p.slug === slug);

export const protocolByTitle = (title: string): Protocol | undefined => PROTOCOLS.find((p) => p.title === title);
