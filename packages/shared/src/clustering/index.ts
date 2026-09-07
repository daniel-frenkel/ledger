/**
 * Clustering — deterministic grouping of predictions into priors.
 *
 * No language model. The client tags each prediction with a prior at creation
 * (from their own list, or a new label). This module does three things around
 * that: ranks existing priors as *suggestions* for a new prediction, finds
 * untagged predictions that look like they belong together, and merges two
 * priors the client says are "the same thing". It never assigns a prior on
 * its own. "Nobody is a type" (WtD Ch4).
 *
 * Similarity is token-set Jaccard over normalized words. Crude on purpose:
 * it is explainable to a client and a reviewer in one sentence, and the
 * client confirms every suggestion.
 */

import type { Prediction, Prior } from '../schemas/index.js';

const STOPWORDS = new Set(
  (
    'a an the and or but if then so to of in on at for with by from as is are was were be been being ' +
    'i me my mine we us our you your he him his she her they them their it its this that these those ' +
    'will would can could should may might do does did done have has had not no yes very really just ' +
    'about into over under again there here when where why how all any both each few more most other ' +
    'some such than too also because while after before during until up down out off'
  ).split(/\s+/),
);

/** Lowercase, strip punctuation, drop stopwords and 1-char tokens, dedupe. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const normalized = text.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  for (const raw of normalized.split(/[^a-z0-9']+/)) {
    const t = raw.replace(/^'+|'+$/g, '').replace(/'(ll|re|ve|d|m|s|t)$/, '');
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.add(stem(t));
  }
  return out;
}

/** Tiny suffix stemmer: enough to match "reject/rejected/rejection". */
function stem(t: string): string {
  const rules: Array<[string, string]> = [
    ['ation', 'at'],
    ['tion', 't'],
    ['ing', ''],
    ['ed', ''],
    ['es', ''],
    ['ly', ''],
    ['s', ''],
  ];
  for (const [suf, rep] of rules) {
    if (t.length > suf.length + 3 && t.endsWith(suf)) {
      if (suf === 's' && t.endsWith('ss')) return t;
      return t.slice(0, -suf.length) + rep;
    }
  }
  return t;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Suggest existing priors for a new prediction
// ---------------------------------------------------------------------------

export interface PriorSuggestion {
  priorId: string;
  score: number;
  /** Tokens shared with the prediction; shown so the client can see *why*. */
  shared: string[];
}

export function suggestPriors(
  input: { situation: string; expectedOutcome: string },
  priors: Prior[],
  opts: { minScore?: number; limit?: number } = {},
): PriorSuggestion[] {
  const minScore = opts.minScore ?? 0.15;
  const limit = opts.limit ?? 3;
  const tokens = tokenize(`${input.expectedOutcome} ${input.situation}`);
  const out: PriorSuggestion[] = [];
  for (const prior of priors) {
    if (prior.deletedAt || prior.retiredAt) continue;
    const lt = tokenize(prior.label);
    const score = jaccard(tokens, lt);
    if (score >= minScore) {
      out.push({ priorId: prior.id, score, shared: [...lt].filter((t) => tokens.has(t)).sort() });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.priorId.localeCompare(b.priorId)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Find untagged predictions that look like one prior
// ---------------------------------------------------------------------------

export interface SuggestedGroup {
  predictionIds: string[];
  /** Tokens common to every member — a hint, not a label. */
  commonTokens: string[];
}

/**
 * Single-linkage grouping over expected outcomes. Returns groups of size ≥
 * `minSize`, largest first, member ids sorted. Deterministic for a given
 * input order-independent set.
 */
export function suggestGroups(
  predictions: Prediction[],
  opts: { threshold?: number; minSize?: number } = {},
): SuggestedGroup[] {
  const threshold = opts.threshold ?? 0.3;
  const minSize = opts.minSize ?? 2;
  const items = predictions
    .filter((p) => !p.deletedAt && p.priorIds.length === 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, tokens: tokenize(p.expectedOutcome) }));

  // union–find
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (jaccard(items[i]!.tokens, items[j]!.tokens) >= threshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  const out: SuggestedGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < minSize) continue;
    let common: Set<string> = new Set(items[members[0]!]!.tokens);
    for (const i of members.slice(1)) {
      const t = items[i]!.tokens;
      common = new Set([...common].filter((x) => t.has(x)));
    }
    out.push({
      predictionIds: members.map((i) => items[i]!.id).sort(),
      commonTokens: [...common].sort(),
    });
  }
  return out.sort((a, b) => b.predictionIds.length - a.predictionIds.length || a.predictionIds[0]!.localeCompare(b.predictionIds[0]!));
}

// ---------------------------------------------------------------------------
// Merge two priors the client says are the same thing
// ---------------------------------------------------------------------------

export interface MergeResult {
  priors: Prior[];
  predictions: Prediction[];
}

/**
 * Retires `mergeId` into `keepId`, retagging predictions. Pure: returns new
 * arrays; the caller writes them (with a fresh clientUpdatedAt) to storage.
 */
export function mergePriors(
  priors: Prior[],
  predictions: Prediction[],
  keepId: string,
  mergeId: string,
  now: string,
): MergeResult {
  if (keepId === mergeId) return { priors, predictions };
  const keep = priors.find((p) => p.id === keepId);
  const merge = priors.find((p) => p.id === mergeId);
  if (!keep || !merge) throw new Error('mergePriors: unknown prior id');

  const newPriors = priors.map((p) =>
    p.id === mergeId ? { ...p, retiredAt: now, clientUpdatedAt: now } : p,
  );
  const newPredictions = predictions.map((p) => {
    if (!p.priorIds.includes(mergeId)) return p;
    const ids = Array.from(new Set(p.priorIds.map((id) => (id === mergeId ? keepId : id))));
    return { ...p, priorIds: ids, clientUpdatedAt: now };
  });
  return { priors: newPriors, predictions: newPredictions };
}
