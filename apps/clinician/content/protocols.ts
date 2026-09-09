/**
 * The thirteen protocols — scaffolds only.
 *
 * Titles match the protocol names in the locator's FLOORS.proto lists exactly,
 * which is what lets a lit floor's chips resolve to a page. `floors` is derived
 * from those lists, not asserted independently.
 *
 * Every section body is empty on purpose. Protocol bodies are clinical content
 * that only the author writes; the pages render "Awaiting author." until they
 * arrive. Nothing here should be filled in by inference from the other sources.
 */
import { z } from 'zod';
import { FLOOR_CONTENT } from './floors';

export const PROTOCOL_SECTIONS = [
  'Gates',
  'Floor',
  'Experiments in order',
  'What counts as disconfirmation',
  'Measure to track',
  'Sources',
] as const;

export type ProtocolSection = (typeof PROTOCOL_SECTIONS)[number];

export const protocolSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** Floors whose locator entry routes here. Derived, never hand-written. */
  floors: z.array(z.number().int().min(1).max(8)),
  /** Section name → body. Empty string means "Awaiting author." */
  sections: z.record(z.enum(PROTOCOL_SECTIONS), z.string()),
});

export type Protocol = z.infer<typeof protocolSchema>;

/** The thirteen, in the order the task names them. */
const TITLES: readonly string[] = [
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

const emptySections = (): Record<ProtocolSection, string> =>
  Object.fromEntries(PROTOCOL_SECTIONS.map((s) => [s, ''])) as Record<ProtocolSection, string>;

/** Which floors route to a given protocol title, read off the locator. */
const floorsFor = (title: string): number[] =>
  FLOOR_CONTENT.filter((f) => f.proto.includes(title)).map((f) => f.n);

export const PROTOCOLS: readonly Protocol[] = z.array(protocolSchema).parse(
  TITLES.map((title) => ({
    slug: slugify(title),
    title,
    floors: floorsFor(title),
    sections: emptySections(),
  })),
);

export const protocol = (slug: string): Protocol | undefined => PROTOCOLS.find((p) => p.slug === slug);

export const protocolByTitle = (title: string): Protocol | undefined => PROTOCOLS.find((p) => p.title === title);

/** Protocols the locator routes to from at least one floor. */
export const routedProtocols = (): Protocol[] => PROTOCOLS.filter((p) => p.floors.length > 0);
