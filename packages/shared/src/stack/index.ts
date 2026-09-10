/**
 * The training stack, and the scope gate that reads it.
 *
 * A clinician's stack is the set of modalities they can actually run, each at a
 * stated depth — docs/theory/tools/training-stack.md. The document's claim is
 * that a practice is measured by *floor coverage*, not by modality count, and
 * that is the whole reason this is in code: once a formulation places a client
 * on a floor, the stack says whether the clinician holds a tool that reaches it.
 *
 * The catalogue and the tiers are the document's. The rows — which modality at
 * which tier — are the clinician's own, and live in `clinician_modalities`.
 *
 * The scope gate is the fourth of the brandless gates the document names (risk,
 * diagnostics, ethics, scope). It differs from the three in
 * `packages/shared/src/floors/` in one deliberate way: it does not block. A
 * clinician may work outside their stack under supervision, and often should.
 * What it does is refuse to let that happen silently — an out-of-scope
 * formulation is written only with an acknowledgement recorded on the row.
 *
 * packages/shared/test/stack.test.ts re-reads the document on every run and
 * fails if the catalogue has drifted from it.
 */
import { z } from 'zod';
import { FLOORS } from '../floors/index.js';

/**
 * The four tiers, in the document's order and wording.
 *
 * `literacy` carries both of the document's names for the fourth tier —
 * "Working literacy / Conversant" is one tier described two ways, and the
 * worked example uses each label in different rows.
 */
export const TIERS = [
  {
    id: 'master',
    name: 'Master',
    gloss: 'the identity; the thousand deliberate-practice hours',
    /** Reading rule 1: one modality only. */
    limit: 1,
    rank: 4,
  },
  {
    id: 'deep',
    name: 'Deep',
    gloss: 'a second certification, added post-licensure, one choice',
    /** Reading rule 3: one at a time — parallel certifications are the error. */
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
    name: 'Working literacy / Conversant',
    gloss: 'concepts used, moves borrowed deliberately, referrals made wisely, exams passed',
    limit: null,
    rank: 1,
  },
] as const;

export type TierId = (typeof TIERS)[number]['id'];

export const TIER_IDS: readonly TierId[] = TIERS.map((t) => t.id);
export const tierSchema = z.enum(['master', 'deep', 'fluent', 'literacy']);

const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));
export const tier = (id: string) => TIER_BY_ID.get(id as TierId);
export const tierRank = (id: string): number => TIER_BY_ID.get(id as TierId)?.rank ?? 0;

/** Tiers a clinician may hold only one of, from the reading rules. */
export const CAPPED_TIERS: readonly TierId[] = TIERS.filter((t) => t.limit === 1).map((t) => t.id);

export const modalitySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** The modality, as the document names it. */
  name: z.string().min(1),
  /** Floors this modality's levers reach, per the document's own column. */
  floors: z.array(z.number().int().min(1).max(8)),
  /** What it pulls. Verbatim from the document where it has a phrase for it. */
  lever: z.string().min(1),
  /**
   * A modality that works the conditions rather than a floor: Person-Centered
   * and MI train the dimmer, which is what lets anything else land. They cover
   * no floor and must not be counted as coverage — that is the point of
   * separating this from an empty `floors` array by accident.
   */
  dimmer: z.boolean().default(false),
});

export type Modality = z.infer<typeof modalitySchema>;

/** The catalogue, from the worked example in docs/theory/tools/training-stack.md. */
export const MODALITIES: readonly Modality[] = z.array(modalitySchema).parse([
  {
    slug: 'act',
    name: 'ACT',
    floors: [2, 5, 1],
    lever: 'defusion, acceptance, committed action',
  },
  {
    slug: 'cbt',
    name: 'CBT (incl. behavior therapy)',
    floors: [3, 5],
    lever: 'content + prediction-error experiments, exposure/RP',
  },
  {
    slug: 'person-centered',
    name: 'Person-Centered',
    floors: [],
    lever: 'the dimmer — conditions, presence',
    dimmer: true,
  },
  {
    slug: 'motivational-interviewing',
    name: 'Motivational Interviewing',
    floors: [],
    lever: 'the dimmer + self-generated discrepancy',
    dimmer: true,
  },
  {
    slug: 'psychodynamic',
    name: 'Psychodynamic / IPT / attachment',
    floors: [4, 6],
    lever: 'transference as assessment, relational prediction error',
  },
  {
    slug: 'experiential',
    name: 'EFT / EMDR / somatic (one, chosen later)',
    floors: [6, 7],
    lever: 'activation + mismatch, regulation',
  },
  {
    slug: 'existential',
    name: 'Existential / logotherapy',
    floors: [1],
    lever: 'meaning-frame, stance',
  },
  {
    slug: 'narrative-sfbt',
    name: 'Narrative / SFBT',
    floors: [1, 2],
    lever: 'filter-fight, re-authoring, exceptions',
  },
  {
    slug: 'multicultural',
    name: 'Multicultural / feminist / liberation',
    floors: [8],
    lever: 'name the substrate, check the field',
  },
  {
    slug: 'family-systems',
    name: 'Family systems',
    floors: [4],
    lever: 'floor 4 at system scale — the distributed furnace',
  },
  {
    slug: 'gestalt',
    name: 'Gestalt',
    floors: [6, 2],
    lever: 'enactment, live awareness',
  },
  {
    slug: 'adlerian-rebt',
    name: 'Adlerian / Reality-Choice / REBT',
    floors: [1, 3, 5],
    lever: 'early forms of the same levers',
  },
  {
    slug: 'dbt',
    name: 'DBT (skills layer)',
    floors: [7, 5],
    lever: 'regulation, distress tolerance = deadband training',
  },
]);

const MODALITY_BY_SLUG = new Map(MODALITIES.map((m) => [m.slug, m]));
export const MODALITY_SLUGS: readonly string[] = MODALITIES.map((m) => m.slug);
export const modality = (slug: string): Modality | undefined => MODALITY_BY_SLUG.get(slug);
export const isModalitySlug = (slug: unknown): slug is string =>
  typeof slug === 'string' && MODALITY_BY_SLUG.has(slug);

/** Slugs that name no modality. The API rejects these; the UI cannot produce them. */
export const unknownModalitySlugs = (slugs: readonly unknown[]): string[] =>
  slugs.filter((s) => !isModalitySlug(s)).map((s) => String(s));

/** One row of a clinician's own stack. */
export const stackEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  tier: tierSchema,
});
export type StackEntry = z.infer<typeof stackEntrySchema>;

/**
 * Floor coverage: the best tier the stack reaches each floor at.
 *
 * A dimmer modality contributes to no floor however deeply it is held. That is
 * the document's position, not a simplification — Person-Centered and MI train
 * what lets a lever land, and counting them as coverage would let a stack with
 * no floor tool at all look complete.
 */
export function coverage(stack: readonly StackEntry[]): Record<number, TierId | null> {
  const out: Record<number, TierId | null> = {};
  for (const f of FLOORS) out[f.n] = null;
  for (const e of stack) {
    const m = MODALITY_BY_SLUG.get(e.slug);
    if (!m || m.dimmer) continue;
    for (const f of m.floors) {
      if (tierRank(e.tier) > tierRank(out[f] ?? '')) out[f] = e.tier;
    }
  }
  return out;
}

export const SCOPE_VERDICTS = ['covered', 'stretch', 'uncovered'] as const;
export type ScopeVerdict = (typeof SCOPE_VERDICTS)[number];
export const scopeVerdictSchema = z.enum(SCOPE_VERDICTS);

/**
 * The scope gate, for one floor.
 *
 * `covered`   — a modality reaching this floor, held at fluent or better.
 * `stretch`   — reached only at working literacy: concepts and borrowed moves,
 *               which the document is explicit is not the same as running it.
 * `uncovered` — nothing in the stack reaches this floor.
 *
 * Floor 8 is worth reading carefully. It is covered by the multicultural row,
 * but the substrate warning in the locator still stands: where the environment
 * is the pathogen the honest move is advocacy and handoff, and a covered scope
 * verdict is not a licence to treat it as an upper-floor problem.
 */
export function scopeFor(stack: readonly StackEntry[], floor: number | null): ScopeVerdict {
  if (floor === null) return 'uncovered';
  const at = coverage(stack)[floor] ?? null;
  if (at === null) return 'uncovered';
  return tierRank(at) >= tierRank('fluent') ? 'covered' : 'stretch';
}

/** Whether a formulation on this floor may be written without an acknowledgement. */
export const scopeNeedsAck = (verdict: ScopeVerdict | null): boolean => verdict !== null && verdict !== 'covered';

/**
 * The gate as it actually applies, which is not the same as the arithmetic.
 *
 * An empty stack returns null: the gate does not apply, and the formulation is
 * written with no verdict recorded. You cannot be out of scope relative to a
 * stack you have not written down, and a clinician who has not filled one in
 * should not have to tick "I know" on every formulation to say so. Null on the
 * row means "no stack on file", which is why `formulations.scope` is nullable.
 *
 * Use this at the boundary. Use scopeFor() when you want the arithmetic.
 */
export function scopeGate(stack: readonly StackEntry[], floor: number | null): ScopeVerdict | null {
  if (stack.length === 0) return null;
  return scopeFor(stack, floor);
}

/**
 * Reading-rule violations in a stack. Advisory: the document's rules are about
 * how a career is built, and the app states them rather than enforcing them.
 * Only the one-master and one-deep caps are structural, and those are indexes.
 */
export function stackWarnings(stack: readonly StackEntry[]): string[] {
  const out: string[] = [];
  const count = (t: TierId) => stack.filter((e) => e.tier === t).length;

  if (count('master') === 0) out.push('No Master. The identity modality is the one that carries the degree.');
  if (count('fluent') < 3) {
    out.push('Fewer than three Fluent modalities. The reading rule is one Master and three Fluents.');
  }
  const uncovered = Object.entries(coverage(stack))
    .filter(([, t]) => t === null)
    .map(([f]) => Number(f));
  if (uncovered.length > 0) {
    out.push(`No tool reaches ${uncovered.length === 1 ? 'floor' : 'floors'} ${uncovered.join(', ')}.`);
  }
  if (!stack.some((e) => modality(e.slug)?.dimmer)) {
    out.push('Nothing in the stack trains the dimmer. Nothing writes while it is off.');
  }
  return out;
}
