/**
 * Exactly what may leave, and nothing else — proposal 03 §6.
 *
 * This file is the boundary of the de-identified export. A column that is not
 * named here cannot appear in the output: the writer selects the allowlist,
 * not the table, and a test asserts that nothing outside it reaches a CSV.
 *
 * The rule is structural fields only. **No `_enc` column, no label, no free
 * text of any kind.** Not "encrypted so it's fine" — the export is a file that
 * leaves the system, and a decrypted note in a research directory is a note in
 * a research directory. A test asserts no name here ends in `_enc` and that
 * every known prose column is absent.
 *
 * Crisis events are the sharpest case and get the narrowest treatment: that
 * one occurred, and which rules fired, and nothing else. The matched text was
 * never stored; the rule ids are the level.
 */
import crypto from 'node:crypto';

export interface Column {
  /** Column name in the database, and the header in the CSV. */
  name: string;
  type: 'id' | 'pseudonym' | 'timestamp' | 'number' | 'enum' | 'boolean' | 'enum[]';
  /** What it means, for the generated codebook. */
  meaning: string;
}

export interface TableSpec {
  table: string;
  /** The column holding the participant, for pseudonymisation and scoping. */
  participant: string;
  columns: Column[];
}

const provenance: Column[] = [
  { name: 'app_version', type: 'enum', meaning: 'Build that wrote the row; results are reproducible against it.' },
  { name: 'received_at', type: 'timestamp', meaning: "Server clock on first insert. With created_at, the evidence a row existed before its outcome." },
];

export const ALLOWLIST: TableSpec[] = [
  {
    table: 'predictions',
    participant: 'user_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id, stable within an export.' },
      { name: 'confidence', type: 'number', meaning: 'How sure, 0–100, recorded before the outcome.' },
      { name: 'revise_after_n', type: 'number', meaning: 'Client-set reminder threshold.' },
      { name: 'scheduled_for', type: 'timestamp', meaning: 'When the situation was expected.' },
      { name: 'resolved_at', type: 'timestamp', meaning: 'When the outcome was recorded.' },
      { name: 'outcome_verdict', type: 'enum', meaning: 'hit | partial | miss | unclear.' },
      { name: 'outcome_source', type: 'enum', meaning: 'observed | inferred — what the verdict rests on.' },
      { name: 'surprise_rating', type: 'number', meaning: 'How surprising, 0–10.' },
      { name: 'present_for_it', type: 'boolean', meaning: 'Could the client say what happened, moment to moment.' },
      { name: 'own_part', type: 'enum', meaning: "Self-report of the client's own contribution." },
      { name: 'counts_for', type: 'number', meaning: 'How much this one counts, 0–100. Asked only on a miss or partial; null when skipped.' },
      { name: 'exit_forecast', type: 'enum', meaning: 'The exit move named in advance.' },
      { name: 'exit_actual', type: 'enum', meaning: 'The exit move taken.' },
      { name: 'abandoned_at', type: 'timestamp', meaning: 'When the experiment was abandoned, if it was.' },
      { name: 'abandon_reason', type: 'enum', meaning: 'Why it was never run.' },
      { name: 'created_at', type: 'timestamp', meaning: "Client clock at creation." },
      ...provenance,
    ],
  },
  {
    table: 'prediction_priors',
    participant: 'user_id',
    columns: [
      { name: 'prediction_id', type: 'id', meaning: 'The prediction.' },
      { name: 'prior_id', type: 'id', meaning: 'The rule it was tagged against.' },
      { name: 'assigned_by', type: 'enum', meaning: 'client | clinician.' },
    ],
  },
  {
    table: 'priors',
    participant: 'user_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      // label is deliberately absent: it is the client's own words.
      { name: 'category', type: 'enum', meaning: 'The rule’s category. Not its text.' },
      { name: 'origin', type: 'enum', meaning: 'Where the rule came from.' },
      { name: 'created_by', type: 'enum', meaning: 'client | clinician.' },
      { name: 'safe_to_test', type: 'boolean', meaning: 'Clinician’s judgement, when reviewed.' },
      { name: 'retired_at', type: 'timestamp', meaning: 'When it stopped being tested.' },
      { name: 'created_at', type: 'timestamp', meaning: 'Client clock at creation.' },
      ...provenance,
    ],
  },
  {
    table: 'body_states',
    participant: 'user_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'prediction_id', type: 'id', meaning: 'The experiment it belongs to.' },
      { name: 'phase', type: 'enum', meaning: 'before | after.' },
      { name: 'intensity', type: 'number', meaning: 'Intensity before, 0–10.' },
      { name: 'channels', type: 'enum[]', meaning: 'Which body channels, from a fixed list.' },
      { name: 'kit_present', type: 'enum[]', meaning: 'What was available, from a fixed list.' },
      { name: 'peak_intensity', type: 'number', meaning: 'Peak after, 0–10.' },
      { name: 'ran_past_peak', type: 'boolean', meaning: 'Did they stay past the peak.' },
      { name: 'time_to_crest_min', type: 'number', meaning: 'Minutes to the crest.' },
      { name: 'verdict_arrived', type: 'enum', meaning: 'Did the feared verdict arrive.' },
      { name: 'credited_to', type: 'enum', meaning: 'What they credited surviving it to.' },
      { name: 'kit_used', type: 'enum[]', meaning: 'What was used, from a fixed list.' },
      { name: 'created_at', type: 'timestamp', meaning: 'Client clock at creation.' },
      ...provenance,
    ],
  },
  {
    table: 'reinterpretations',
    participant: 'user_id',
    columns: [
      // text_enc is deliberately absent. The count and the timing are the data;
      // the words are the client's.
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'prediction_id', type: 'id', meaning: 'The experiment re-described.' },
      { name: 'created_at', type: 'timestamp', meaning: 'When it was written.' },
      ...provenance,
    ],
  },
  {
    table: 'journal_entries',
    participant: 'user_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'shared_at', type: 'timestamp', meaning: 'When it was shared with a clinician, if it was.' },
      { name: 'created_at', type: 'timestamp', meaning: 'When it was written.' },
      ...provenance,
    ],
  },
  {
    table: 'crisis_events',
    participant: 'user_id',
    columns: [
      // The narrowest table here on purpose: that one occurred, and which
      // deterministic rules fired. The matched text was never stored.
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'source', type: 'enum', meaning: 'Which surface it was detected on.' },
      { name: 'rule_ids', type: 'enum[]', meaning: 'Which hard-coded rules matched. Never the text.' },
      { name: 'detected_on_device', type: 'boolean', meaning: 'Detected locally or server-side.' },
      { name: 'acknowledged_at', type: 'timestamp', meaning: 'When the card was acknowledged.' },
      { name: 'created_at', type: 'timestamp', meaning: 'When it occurred.' },
      ...provenance,
    ],
  },
  {
    table: 'measures',
    participant: 'client_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'instrument', type: 'enum', meaning: 'Which published instrument.' },
      { name: 'score', type: 'number', meaning: 'Total. No item-level responses exist anywhere.' },
      { name: 'subscales', type: 'enum', meaning: 'Published subscale names to numbers, as JSON.' },
      { name: 'administered_at', type: 'timestamp', meaning: 'When it was taken.' },
      { name: 'administered_by', type: 'enum', meaning: 'client | clinician.' },
      ...provenance,
    ],
  },
  {
    table: 'phase_events',
    participant: 'client_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'protocol_slug', type: 'enum', meaning: 'Which protocol.' },
      { name: 'phase', type: 'number', meaning: "The protocol's own phase number; 0 is the gates." },
      { name: 'kind', type: 'enum', meaning: 'started | completed | paused | abandoned.' },
      { name: 'at', type: 'timestamp', meaning: "The clinician's date for the phase change." },
      { name: 'created_at', type: 'timestamp', meaning: 'When it was recorded.' },
      ...provenance,
    ],
  },
  {
    table: 'usage_events',
    participant: 'user_id',
    columns: [
      { name: 'id', type: 'id', meaning: 'Row id.' },
      { name: 'kind', type: 'enum', meaning: 'One of seven; no payload exists.' },
      { name: 'app_version', type: 'enum', meaning: 'Build.' },
      { name: 'created_at', type: 'timestamp', meaning: 'When.' },
    ],
  },
];

/** Column names that must never appear, whatever anyone adds to the list above. */
export const FORBIDDEN_SUFFIXES = ['_enc'] as const;
export const FORBIDDEN_NAMES = ['label', 'text', 'body', 'situation', 'expected_outcome', 'actual_outcome', 'note', 'falsify', 'words', 'verdict', 'room', 'word_now', 'felt_vs_observed'] as const;

/** Every table's allowlisted columns, plus the pseudonym that replaces the id. */
export const columnsFor = (t: TableSpec): string[] => ['participant', ...t.columns.map((c) => c.name)];

/**
 * A hash of the allowlist itself, recorded on the exports row.
 *
 * Two runs with the same hash exported the same shape; a run whose hash nobody
 * recognises exported something else, and the methods section can say which.
 */
export function allowlistHash(): Buffer {
  const canonical = JSON.stringify(
    ALLOWLIST.map((t) => [t.table, t.participant, t.columns.map((c) => [c.name, c.type])]),
  );
  return crypto.createHash('sha256').update(canonical, 'utf8').digest();
}
