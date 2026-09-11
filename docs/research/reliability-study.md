---
title: "Locator inter-rater reliability — design"
status: DRAFT for faculty review
date: 2026-09-10
---

# Locator inter-rater reliability — design

**Draft. No code, no data, no submission.** One page so the design exists before
the locator is used in a study that assumes it works.

## The question

Two clinicians reading the same note, independently, place the client on the
same floor how often? The locator weights signs; it is not an assessment
instrument and has no outcome data of its own. If two trained readers disagree
about the floor, every downstream claim that starts "this case is floor 6"
inherits that disagreement.

## Stimulus set

`docs/theory/eval/locate-notes.md` — the same fixture the locating assistant is
evaluated against, which is currently placeholder rows awaiting the author.
The set has to be filled and expanded before this is runnable; the reliability
study and the assistant eval need the same thing and should not have two.

Notes are de-identified before they are shown to anyone. Real notes require
consent under a protocol that does not exist yet; synthetic notes written by
the author are the honest starting point and their limitation is that the
author wrote both the notes and the instrument.

## Procedure

Two or more clinicians, trained on the Decision Aid, place each note
independently: the gates, the signs ticked, the floor. No discussion between
raters, no access to each other's answers, and no access to the author's.

## Analysis

Cohen's κ on floor placement for two raters; Fleiss' κ for more. Per-sign
agreement as a secondary analysis — a floor that disagrees because one sign is
read differently is a fixable problem with the sign's wording, not with the
model.

Nothing is claimed about validity. This measures whether two people using the
same instrument get the same answer, which is a precondition for asking whether
the answer is any good.
