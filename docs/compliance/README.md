# Compliance evidence

Screenshots and documents that show an agreement or a control **actually
exists**, rather than a sentence elsewhere in this repository asserting that it
does.

This directory exists because of the standing rule in Prompt 0: *a gate closes
on evidence that the procedure ran, never on the existence of the procedure.*
Prose in `go-live-gate.md` is the claim; a file in here is the evidence for it.
Every row in that document that says "accepted" or "done" should name a file
here or name the command whose output is the evidence.

## What belongs here

- BAA acceptance screenshots, from the console where acceptance happened.
- Acceptance confirmations that arrive as email or PDF.
- Console state that cannot be read from this repository and would otherwise
  be a claim: an org policy listing, an enabled-services listing.

## What does not

**No PHI, and nothing containing a client or a clinician's identity.** These
files are evidence about the vendor relationship, not about anyone's care. A
screenshot of a console is fine; a screenshot of an application screen with
someone's data on it is not, and no deletion afterwards undoes having put it in
git history.

## Naming

`<subject>-<what>-<state>-<ISO date>.<ext>`, so a directory listing sorts into
something readable and each file says what it evidences without being opened.

## Current contents

| File | Evidences |
|---|---|
| `courageloop-gcp-baa-accepted-2026-09-11.png` | Google Cloud HIPAA BAA, accepted 11 Sept 2026 |
| `courageloop-workspace-baa-accepted-2026-09-14.png` | Google Workspace / Cloud Identity HIPAA BAA, accepted 14 Sept 2026 |

Both are referenced from `docs/go-live-gate.md` under **Agreements in force**.
