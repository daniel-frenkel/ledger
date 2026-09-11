---
title: "Preregistration draft — feasibility and mechanism"
status: DRAFT for faculty review
date: 2026-09-10
---

# Preregistration draft — for faculty review

**Draft.** Nothing here has been reviewed, no data has been collected, and no
study has been submitted to an IRB. It exists so the design is written down
before anyone looks at a number, which is the only thing that makes the rest of
it worth anything.

## Design

Multiple-baseline single-case experimental series across clients. Baseline is
ledger use before `phase_events.kind = 'started'` for phase ≥ 1; intervention is
the protocol phases. Staggered entry across participants is what distinguishes
a treatment effect from time.

Primary outcome: change on the protocol's named instrument (`measures`).
Process measures: calibration slope across experiments (`summarize()` in
`packages/shared`), loud-miss rate, reinterpretation rate, exit named-vs-taken,
kit-present survivals.

## Hypotheses

Each is falsifiable, and the falsifying result is named.

- **H1.** Calibration improves across experiments within participant.
  *Falsified by:* flat or worsening slope in the majority of participants.
- **H2.** Calibration improvement precedes and predicts symptom change.
  *Falsified by:* symptom change leading calibration change, or no relation.
- **H3.** Reinterpretation rate — measured per-miss by `counts_for` and at
  intervals by the IMS — moderates H2 negatively.
  *Falsified by:* no interaction, or a positive one.
- **H4.** Loud misses produce larger subsequent confidence revisions than quiet
  misses. *Falsified by:* no difference in revision size.
- **H5.** Body survivals without the kit predict larger interoceptive-prior
  revision than survivals with it. *Falsified by:* no difference.

**Explicitly not hypothesised.** That accuracy of fear-intensity forecasts (the
interoceptive track's "how strong?") mediates outcome. Hilleke et al. (2025)
found no such relation in exposure for panic; a null here is expected and is
not evidence against the model.

## Analysis sketch

Per-participant visual analysis with the standard single-case criteria (level,
trend, latency, overlap), then randomisation tests across the staggered starts.
Multilevel models only if the series are long enough to support them; the
decision rule is written before the data, not after.

## Stopping rules

Recruitment stops at the planned N or at the end of the beta window, whichever
comes first. No interim analysis of outcome. The feasibility questions —
retention, completion, usability — are answered whatever the outcome shows.

## What would count as the model being wrong

- Calibration improves and symptoms do not (H2 fails): the mechanism is not
  the one claimed, whatever else the app is doing.
- Reinterpretation rate does not moderate anything (H3 fails): the furnace is
  a story rather than a measurable process.
- Loud and quiet misses produce the same revision (H4 fails): the loudness
  rule, which shapes the client's screen, has no basis.

Any of these is publishable and none is a reason to keep the app as it is.
