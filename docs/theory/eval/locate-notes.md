---
title: "Locating Assistant — Evaluation Notes"
subtitle: "Fixture notes with the author's own placement, for measuring the assistant against a person"
type: eval-fixture
status: DRAFT — placeholder rows only; not written by the author yet
tags:
  - eval
  - locating-assistant
---

# Locating Assistant — Evaluation Notes

Short clinical notes, each with the floor the author would place it on and the
signs he would tick. `pnpm --filter @ledger/api eval:locate` runs the assistant
over them and prints agreement on signs and on floor.

This file is **DRAFT**, which means two things mechanically: it gets no Library
route, and it is not part of the assistant's corpus — the thing being measured
must not be able to read the answer key. Both are enforced in
`apps/clinician/lib/markdown/sources.ts` and tested.

**Every row below is a placeholder written to exercise the harness.** They are
not clinical material, they are not the author's judgements, and the agreement
number they produce means nothing. Replace them, drop the `PLACEHOLDER` marker
from each heading, and change `status:` above before quoting any figure.

Proposal 02 §3 sets the bar: below 80% floor agreement on the author's own
notes is a prompt problem, and the number goes in the report.

## Format

One `###` heading per case, `id · PLACEHOLDER` while the row is scaffolding.
Then a `floor:` line, an `observations:` line of ids from
`packages/shared/src/floors/`, and the note as a blockquote. The parser in
`packages/api/scripts/eval-locate.ts` reads exactly those four things.

---

### case-01 · PLACEHOLDER

- **floor:** 3
- **observations:** insight-does-not-move, one-coherent-account

> PLACEHOLDER. He can state the belief precisely and argue against it better
> than I can, and it has not moved in four months. Every account he gives of
> himself fits together without a seam.

---

### case-02 · PLACEHOLDER

- **floor:** 6
- **observations:** reaction-before-thought, runs-without-decision

> PLACEHOLDER. She was already apologising before I had finished the question.
> Afterwards she said she had not decided to, and could not say when it started.

---

### case-03 · PLACEHOLDER

- **floor:** 8
- **observations:** environment-now, never-tested

> PLACEHOLDER. The prediction that disclosure would be used against him is a
> correct read of the workplace he is describing, and it has never been safe
> enough to put to a test.
