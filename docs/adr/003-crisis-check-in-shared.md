# ADR 003 — Crisis detection lives in @ledger/shared and runs twice

**Status:** accepted · 2026-09-07

## Context
The client is offline-first, so a server-only crisis check would run hours after the entry. The check must be deterministic, auditable, and free of any language model.

## Decision
- Rules and resources live in `packages/shared/src/crisis`. Pure function: `detectRisk(text) → { matched: RuleId[] }`.
- The client runs it before persisting any entry and shows resources immediately, offline.
- The API re-runs the same function on every synced entry (a stale client build might miss a rule) and dedupes on `(source, source_entry_id)`.
- `crisis_events` stores rule ids and resources shown — never text.

## Consequences
- Rule changes are code changes, reviewed and versioned in git.
- False positives are visible to the user as a resource card, not a lockout; the app never blocks entry.
