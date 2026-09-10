---
title: "Clinician Business Associate Agreement"
status: DRAFT — replace with counsel's template
version: draft-2026-09-10
---

# DRAFT — replace with counsel's template

**This is not an agreement. It is a placeholder so the acceptance flow has
something to render and a version string to record.** Nothing in this file has
been reviewed by a lawyer, and no clinician should be asked to accept it.

Go-live gate A1: the BAA is signed at clinician signup, before any invite can
be created, from a template supplied by counsel or by the professional-liability
insurer. Acceptance is recorded on the clinician's user row as
`baa_accepted_version` and `baa_accepted_at`, and `POST /v1/invites` refuses
while the version is null.

When the real template arrives, replace this file's body with it and change
`version:` in the frontmatter. The version string is what gets stored, so
changing it is what asks every clinician to accept again.

The agreement has to cover, at minimum: the vendor's status as a business
associate; permitted uses and disclosures of PHI; the subprocessors in
`docs/go-live-gate.md` §A and their own agreements; safeguards; breach
notification and the timeline in B8; the clinician's rights on termination,
including what happens to the formulations they wrote.
