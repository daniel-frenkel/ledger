# Proposal 06 — "How much does this one count?"

**Status:** approved for build (Sept 2026). One new field on `predictions`; additive migration `0006_counts_for.sql` (shipped as PR #22). This changes what the client sees on the resolve screen and adds a number to the ledger, so it is a proposal rather than a prompt.

**Why.** The furnace's *reinterpret* move — accept the disconfirming event, then re-describe it until it no longer counts — is what Kube and Rief's group measures as cognitive immunization (Kube et al. 2019; the Immunization Scale, Ewen, Rief & Wilhelm 2022). The ledger already captures the reinterpretation as text. It does not capture the *amount* of the discount. One number, asked at the moment of resolution, turns the reinterpret move into a quantity the ledger can read back — "of your nine misses, you said six didn't fully count" — which is a sentence no client has been shown about themselves.

## The field

`predictions.counts_for smallint null`, check 0–100. The client's answer to: **How much does this one count?**

- Asked only when `outcome_verdict` is `miss` or `partial`. A hit is not discounted; the question would be noise.
- Asked **after** the verdict and the surprise rating and **before** the reinterpretation text, so the number is not anchored by the story the client is about to write.
- Client-facing copy, in the vocabulary rules: label *How much does this one count?* · hint *Against the rule you were testing. Zero means it doesn't count at all; a hundred means it counts completely.* · scale 0–100 in steps of ten. No theory words. The question is ours; it is not an IMS item, and IMS items are not reproduced anywhere in the app.
- Nullable and skippable. An unanswered question is `null`, never 100.

## What is computed from it

In `packages/shared/src/calibration/`:

- `discountRate(predictions)`: mean of `(100 − counts_for)` over scored misses and partials with a non-null answer; also the count of misses rated ≤ 30 ("dismissed"). Pure, unit-tested, never model-generated.
- `summarizeLedger()` gains `discount: { rate, dismissed, answered }`. The client's ledger sentence gains one clause when `answered ≥ 3`: *"Of your N misses, you said M didn't fully count."* Neutral wording — it is a record, not a verdict. The clinician view shows the rate as a number alongside the furnace profile.
- `shouldRouteToClinician()` gains a case: a **loud miss** (per `isLoudMiss`) with `counts_for ≤ 30` routes — a high-confidence, present, unassisted disconfirmation the client immediately discounted is the reinterpret move caught in the act, and the clinician should see it. `isLoudMiss` itself is unchanged.

## What it touches

`predictions` schema, the `predictions_summary` view (rebuilt DROP/CREATE as in 0002; `counts_for` is a structured field and is included in the summary a clinician with `share_predictions = false` can see, because it carries no prose), the shared zod schema and codec (the refine lives on `predictionSchema` so sync rejects a hit carrying `counts_for`), sync (the IndexedDB store version is not bumped: stores hold whole documents with no per-field index, so existing rows simply read the field as absent), the resolve screen in `apps/web`, the research export allowlist (add `counts_for`), and the calibration tests. The Expo client is parked and is not updated.

## Build status (added 2026-09-10)

Two items in "What it touches" are **blocked on prompts that have not run**, not skipped:

- **The clinician view's "Discount rate" and "Dismissed misses" rows.** The clinician ledger screen arrives with Prompt 3; there is no furnace profile block to add rows to yet. The numbers exist in `discountRate()` and on `summarizeLedger().discount`, and there is a TODO pointing here in `packages/shared/src/calibration/`.
- **The research export allowlist.** That module arrives with Prompt 8 (proposal 03). `counts_for` goes in it when it exists; there is a TODO pointing here in `docs/proposal-03-research-readiness.md`.

One item is **deliberately not done**: the IndexedDB store version is not bumped. The stores hold whole documents with no per-field index, so an added optional field needs no migration, and `upgrade()` in `apps/web/src/db/` calls `createObjectStore` unconditionally — a version bump would throw in every browser that already has the database. Ruled and confirmed 2026-09-10.

## What it does not do

It does not change `isLoudMiss`, the crisis rules, the mismatch "why" screen, or any clinician-writable column. It is not a symptom measure; the IMS as a full instrument lives in `measures` (proposal 03) and is administered separately.

## Boundary note for the paper

Hilleke et al. (2025) found that calibration of *fear-intensity* predictions did not relate to outcome in exposure for panic. `counts_for` is attached to *outcome* predictions, not intensity forecasts, and should be analysed that way; the interoceptive track's intensity forecast stays as data and is not treated as an outcome.
