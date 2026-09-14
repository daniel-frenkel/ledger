# The pseudonym secret: per-run or per-study?

> **PARKED — 14 September 2026.** Do not act on this, and do not revisit it
> without a ruling. It is recorded so the question is not lost, not so that
> somebody answers it.
>
> **One live constraint while it is open:** nothing new in the codebase may
> take a dependency on the secret being per-run. A change that would make this
> decision harder to reverse is a change to stop and raise, not to make.

**Status: a question, not a decision.** Nothing is being changed. This is
written down because the current behaviour was a consequence rather than a
choice, and the consequence is large enough that somebody should choose it on
purpose.

**It is not an engineering question.** It touches what participants were told,
what a study can claim, and what has to be protected for how long — so it is
Daniel's call, and probably an IRB one.

---

## What happens today

Every export run generates a fresh 32-byte secret. `participant` is
`HMAC-SHA256(user_id, secret)` truncated to 16 hex characters, and the mapping
is never stored. The secret is printed once and kept nowhere.

So the same person exported twice receives **two unrelated pseudonyms**.

## What that buys

**Exports are mutually unlinkable.** Two files that escape, from two different
runs, cannot be joined to each other — not by us, not by a reviewer, not by
whoever ends up holding them. There is no key anywhere that relinks them,
because no key was kept.

That is a real privacy property and it is stronger than the usual arrangement.
It also means **a re-identification request cannot be answered**, which is the
trade already recorded in `export.ts`.

## What it costs

**Longitudinal work is impossible.** A study that adds a second wave cannot
join it to the first. Not "with difficulty" — at all. The same participant is
two different rows with no way to know it.

Concretely, none of these can be done across two exports:

- a within-person change score between waves
- attrition analysis, since nobody can tell who is missing from wave two
- a multiple-baseline design whose phases span the exports
- re-running an analysis on corrected data and comparing it to the original

The last one is worth dwelling on: **a corrected re-export is a new study
population as far as the data can tell.** If wave one turns out to have a bug,
the fix produces a dataset that cannot be compared to what was already
reported.

## The alternative

**A per-study secret**, generated once and held somewhere with a stated
lifecycle: where it lives, who can reach it, when it is destroyed, and what
happens to the linkability when it is.

That makes exports within a study joinable and creates **a new thing to
protect** — a key that relinks otherwise unlinkable data, which is precisely
the object the current design avoids having. Its existence has to be disclosed
to participants and to the IRB, because "your data cannot be relinked" stops
being true.

## The shape of the decision

| | Per-run (today) | Per-study |
|---|---|---|
| Two exports joinable | No | Yes, within the study |
| Longitudinal analysis | Impossible | Possible |
| Re-export after a fix | A new population | Comparable |
| A key exists that relinks | No | **Yes** |
| Something to protect and destroy | No | Yes, with a lifecycle |
| What participants are told | "cannot be relinked" | "linkable within this study" |

**It is not obvious which is right**, and it may depend on the study. A
single-wave cross-sectional look wants per-run. Anything following people over
time needs per-study, and needs to have said so in advance.

## What would have to happen either way

If per-study is chosen, four things that are not code:

1. The consent text says the linking key exists and when it is destroyed.
2. The IRB protocol describes where it is held and who can reach it.
3. `docs/research/consent-text.md` is updated before anyone consents under it.
4. The key's destruction is a dated event with evidence, like any other gate.

If per-run stays, one thing:

1. The hypotheses document says the design is cross-sectional by construction,
   so that nobody plans a second wave against data that cannot support one.

Neither is written yet, because the decision is not made.
