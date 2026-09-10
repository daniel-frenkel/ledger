/**
 * The training stack, and the scope gate that reads it.
 *
 * A clinician's stack is the set of modalities they can actually run, each at a
 * stated depth — docs/theory/tools/training-stack.md. The document's claim is
 * that a practice is measured by *floor coverage*, not by modality count, and
 * that is why this is in code: once a formulation places a client on a floor,
 * the stack says whether the clinician holds a tool that reaches it.
 *
 * **There is no catalogue here, on purpose.** Modality names and home floors
 * live in one place, `apps/clinician/content/modalities.ts`, ported from
 * `docs/theory/modalities.md`. A second copy in this package would be a fork
 * that typechecks — the exact failure the floor-weights test exists to prevent.
 * So everything below is a pure function that takes that module's data as an
 * argument, and this package never imports from an app.
 *
 * The one exception is `MODALITY_SLUGS`, and it is a mirror rather than a
 * source: the API has to reject a slug that names no modality, and the API
 * cannot import from an app either. `apps/clinician/test/content.test.ts`
 * asserts this list is exactly the module's slug set, so a modality added
 * there and not here fails the build rather than becoming unstorable.
 */
import { z } from 'zod';
import { FLOORS } from '../floors/index.js';

/**
 * The four tiers, in the document's order and wording.
 *
 * The fourth is one tier, not two. The worked table writes it two ways —
 * "Working literacy" for concepts used daily, "Conversant" for formulate and
 * refer well — and the document is explicit that those are shades of one tier.
 * One value is stored.
 */
export const TIERS = [
  {
    id: 'master',
    name: 'Master',
    gloss: 'the identity; the thousand deliberate-practice hours',
    /** Reading rule 1: one modality only. Advisory — the app warns, it does not block. */
    limit: 1,
    rank: 4,
  },
  {
    id: 'deep',
    name: 'Deep',
    gloss: 'a second certification, added post-licensure, one choice',
    /** Reading rule 3: one at a time — parallel certifications are the error. Advisory. */
    limit: 1,
    rank: 3,
  },
  {
    id: 'fluent',
    name: 'Fluent',
    gloss: 'working command; the daily drivers used in every case',
    limit: null,
    rank: 2,
  },
  {
    id: 'literacy',
    name: 'Literacy',
    gloss: 'concepts used, moves borrowed deliberately, referrals made wisely, exams passed',
    limit: null,
    rank: 1,
  },
] as const;

export type TierId = (typeof TIERS)[number]['id'];

export const TIER_IDS: readonly TierId[] = TIERS.map((t) => t.id);
export const tierSchema = z.enum(['literacy', 'fluent', 'deep', 'master']);

const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));
export const tier = (id: string) => TIER_BY_ID.get(id as TierId);
export const tierRank = (id: string): number => TIER_BY_ID.get(id as TierId)?.rank ?? 0;

/** Tiers the reading rules allow only one of. Warned about, never refused. */
export const CAPPED_TIERS: readonly TierId[] = TIERS.filter((t) => t.limit === 1).map((t) => t.id);

/**
 * The shape the modalities module hands in — a structural type, not data.
 *
 * `floors` is the numeric part of the source's home-floors column, with ranges
 * expanded ("6–7" reaches both). `dimmer` marks the qualifiers that reach no
 * floor at all: "conditions" and "change process" are the layer that lets any
 * lever land, and counting them as coverage would let a stack with no floor
 * tool look complete.
 */
export interface StackModality {
  slug: string;
  name: string;
  floors: readonly number[];
  dimmer: boolean;
}

/**
 * Every modality slug the module defines, mirrored so the API can reject one it
 * does not know. Pinned to the module by a test — see the file comment.
 */
export const MODALITY_SLUGS: readonly string[] = [
  'act',
  'adlerian',
  'cbt',
  'dbt',
  'emdr',
  'existential',
  'family-systems',
  'feminist',
  'gestalt',
  'motivational-interviewing',
  'person-centered',
  'postmodern',
  'psychodynamic-eft',
  'reality-therapy',
];

const SLUGS = new Set(MODALITY_SLUGS);
export const isModalitySlug = (slug: unknown): slug is string => typeof slug === 'string' && SLUGS.has(slug);

/** Slugs that name no modality. The API rejects these; the UI cannot produce them. */
export const unknownModalitySlugs = (slugs: readonly unknown[]): string[] =>
  slugs.filter((s) => !isModalitySlug(s)).map((s) => String(s));

/** One row of a clinician's own stack. */
export const stackEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  tier: tierSchema,
});
export type StackEntry = z.infer<typeof stackEntrySchema>;

/** A goal on the roadmap: a modality, the tier aimed at, and when. No note field. */
export const stackGoalSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  targetTier: tierSchema,
  targetBy: z.string().nullish(),
  doneAt: z.string().nullish(),
});
export type StackGoal = z.infer<typeof stackGoalSchema>;

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * How well a floor is reached.
 *
 * `specialist` — deep or master: the certification, the stuck cases.
 * `in-stack`   — fluent: working command, a daily driver.
 * `literacy`   — concepts used and moves borrowed, which the document is
 *                explicit is not the same as running the modality.
 * `gap`        — nothing in the stack reaches it.
 */
export const COVERAGE_LEVELS = ['specialist', 'in-stack', 'literacy', 'gap'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const levelFor = (t: TierId | null): CoverageLevel => {
  if (t === null) return 'gap';
  if (t === 'master' || t === 'deep') return 'specialist';
  return t === 'fluent' ? 'in-stack' : 'literacy';
};

export interface FloorCoverage {
  floor: number;
  /** Deepest tier reaching this floor, or null. */
  tier: TierId | null;
  level: CoverageLevel;
  /** Slugs reaching it, deepest first. */
  modalities: string[];
}

export interface Coverage {
  /** All eight floors, ascending. A floor nothing reaches is present with level 'gap'. */
  floors: FloorCoverage[];
  /** Slugs in the stack whose modality works the conditions rather than a floor. */
  dimmer: string[];
}

/**
 * Floor coverage for a stack, given the modality data.
 *
 * Pure: the caller supplies the modalities, so this function has no opinion
 * about where they came from and no way to disagree with the source.
 */
export function coverage(stack: readonly StackEntry[], modalities: readonly StackModality[]): Coverage {
  const bySlug = new Map(modalities.map((m) => [m.slug, m]));
  const held = stack.filter((e) => bySlug.has(e.slug));

  const floors: FloorCoverage[] = FLOORS.map((f) => {
    const reaching = held
      .filter((e) => bySlug.get(e.slug)!.floors.includes(f.n))
      .sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
    const top = reaching[0]?.tier ?? null;
    return { floor: f.n, tier: top, level: levelFor(top), modalities: reaching.map((e) => e.slug) };
  });

  return { floors, dimmer: held.filter((e) => bySlug.get(e.slug)!.dimmer).map((e) => e.slug) };
}

export const coverageOf = (c: Coverage, floor: number | null): FloorCoverage | undefined =>
  floor === null ? undefined : c.floors.find((f) => f.floor === floor);

// ---------------------------------------------------------------------------
// The scope gate
// ---------------------------------------------------------------------------

/**
 * The scope gate annotates; it never blocks.
 *
 * A floor reached only at working literacy, or not reached at all, is outside
 * the stack at this tier. That is worth saying out loud and worth recording —
 * a clinician may work outside their stack under supervision and often should,
 * and a gate that stopped them would be a gate that got clicked through.
 */
export const isOutsideStack = (level: CoverageLevel): boolean => level === 'literacy' || level === 'gap';

/**
 * Whether the formulation being written is outside the clinician's stack.
 *
 * An empty stack returns false: you cannot be outside a stack you have not
 * written down, and a clinician who has not filled one in should not be told
 * they are out of their depth on every formulation.
 */
export function outsideStack(
  stack: readonly StackEntry[],
  modalities: readonly StackModality[],
  floor: number | null,
): boolean {
  if (stack.length === 0 || floor === null) return false;
  const f = coverageOf(coverage(stack, modalities), floor);
  return f ? isOutsideStack(f.level) : false;
}

/** The line the result panel shows. Verbatim from the prompt. */
export const outsideStackLine = (floor: number): string =>
  `Floor ${floor} is outside your stack at this tier — refer, co-treat, or supervise.`;

// ---------------------------------------------------------------------------
// The reading rules, as guidance
// ---------------------------------------------------------------------------

/**
 * Reading-rule violations. Advisory in every case: the rules are about how a
 * career is built, and the app states them rather than enforcing them. Nothing
 * here is a constraint in the database, deliberately — a second Master is a
 * conversation with a supervisor, not a write error.
 */
export function stackWarnings(stack: readonly StackEntry[], modalities: readonly StackModality[]): string[] {
  const out: string[] = [];
  const count = (t: TierId) => stack.filter((e) => e.tier === t).length;

  if (count('master') === 0) out.push('No Master. The identity modality is the one that carries the degree.');
  if (count('master') > 1) {
    out.push('More than one Master. The reading rule is one — it is the identity and the thousand hours.');
  }
  if (count('deep') > 1) {
    out.push(
      'More than one Deep. One certification at a time — acquiring them in parallel is the jack-of-all-trades error wearing a to-do list.',
    );
  }
  if (count('fluent') < 3) {
    out.push('Fewer than three Fluent modalities. The reading rule is one Master and three Fluents.');
  }

  const c = coverage(stack, modalities);
  const gaps = c.floors.filter((f) => f.level === 'gap').map((f) => f.floor);
  if (gaps.length > 0) {
    out.push(`No tool reaches ${gaps.length === 1 ? 'floor' : 'floors'} ${gaps.join(', ')}.`);
  }
  if (c.dimmer.length === 0) {
    out.push('Nothing in the stack trains the dimmer. Nothing writes while it is off.');
  }
  return out;
}

/** Shown under the building on /stack. Verbatim. */
export const STACK_DISCLAIMER = 'Self-declared. Not a credential. Never shown to clients.';
