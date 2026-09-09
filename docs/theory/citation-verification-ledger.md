# Citation Verification Ledger
## *A Unified Clinical Model of Psychotherapy* — Pass 1 (records)

**Date of pass:** 31 July 2026
**Scope:** 49 references, record layer only
**Method:** live retrieval only — publisher pages, DOI-registry metadata, PubMed, Europe PMC, library catalogs. No reference was confirmed from model memory.
**Signature line:** _________________________ (Daniel Frenkel) — *verification is a ledger, and the ledger is signed by a person.*

---

### What this pass did and did not check

**Checked (record layer):** author surnames, initials, and order; year; exact title wording; journal or publisher; volume; issue; page range; edition.

**Not checked (claim layer):** whether each source actually argues what the sentence citing it says it argues. That is Pass 2. Page numbers inside works were also not opened; they should be confirmed against originals before formal use.

### Evidence tiers

**P1 — publisher-authoritative.** The publisher's own article or book page, or DOI-registry metadata deposited by the publisher itself.
**P2 — registry or catalog.** PubMed, Europe PMC, JSTOR, ERIC, or a major library catalog record.
**P3 — scan or holdings record.** Internet Archive or Open Library record, used only where P1 and P2 were unreachable. Every P3 here is a book, where the record layer is stable and the risk is low.

Bot-blocking was widespread. PubMed HTML, ScienceDirect, MIT Press, Royal Society Publishing, APA PsycNet, WorldCat, HathiTrust, Wiley Online, HarperCollins, the Library of Congress, and the University of Chicago Press all returned 403 or CAPTCHA at some point in the pass. Where that happened the fallback was the publisher's own deposited metadata through `api.crossref.org` or `citation.doi.org`, or a distributor page carrying the publisher's copy — which is why Penguin Random House appears for an MIT Press title and Hachette for two Basic Books titles.

---

## Result

| | |
|---|---|
| References checked | 49 |
| Confirmed clean | 46 |
| Corrected during the pass | 3 |
| Unresolvable | 0 |
| Advisory items for your call | 5 |

---

## The three corrections

**1. Hamilton (1964) was a composite that matches no single record.**
The entry cited one paper spanning pages 1–52. There are two papers, published back to back in the same issue: Part I at pages 1–16, Part II at pages 17–52. Split into 1964a and 1964b; §4.1's inline citation now reads `(Hamilton, 1964a, 1964b; Trivers, 1971)`.
*Evidence:* `pubmed.ncbi.nlm.nih.gov/5875341` · Crossref `10.1016/0022-5193(64)90039-6`

**2. The despair-mortality bridge was attributed to the wrong Sterling work.**
The new allostasis paragraph originally routed that link through Sterling's 2020 book. He does not make it there. He makes it in Sterling & Platt (2022), *JAMA Psychiatry* — a paper written for exactly that argument. The sentence now cites the right source and the reference was added.
*Evidence:* `pubmed.ncbi.nlm.nih.gov/35107578` · DOI `10.1001/jamapsychiatry.2021.4209`
*Note:* this error was mine, introduced the same hour. The pass caught it in minutes. That is the rule working.

**3. Two journal names were incomplete.**
`Quarterly Review of Biology` → `The Quarterly Review of Biology` (Trivers, 1971).
`Philosophical Transactions of the Royal Society B` → `...Royal Society B: Biological Sciences` (O'Connor & Kirtley, 2018).

**And one long-standing suspicion retired.** The hierometer/sociometer entry — carried as a suspected attribution swap for weeks — verified clean. Mahadevan, Gregg & Sedikides (2019) is correctly attributed, correctly titled, correct volume, issue, and pages. The published abstract states that self-esteem operates as both sociometer and hierometer while narcissism operates primarily as a hierometer. Nothing is swapped.

---

## The ledger

| # | Reference | Tier | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Anderson, Hildreth & Howland (2015) | P2 | pubmed.ncbi.nlm.nih.gov/25774679 | clean |
| 2 | Barrett (2017) | P3 | archive.org/details/howemotionsarema0000barr | clean · see advisory 4 |
| 3 | Baumeister & Leary (1995) | P2 | pubmed.ncbi.nlm.nih.gov/7777651 | clean |
| 4 | Beck (1976) | P3 | openlibrary.org/books/OL5207244M | clean |
| 5 | Bowlby (1969) | P3 | archive.org/details/attachmentloss0001bowl | clean |
| 6 | Case & Deaton (2020) | P1 | press.princeton.edu — 9780691190785 | clean |
| 7 | Cheng, Tracy, Foulsham, Kingstone & Henrich (2013) | P2 | pubmed.ncbi.nlm.nih.gov/23163747 | clean |
| 8 | Clark (2016) | P1 | global.oup.com — 9780190217013 | clean · see advisory 1 |
| 9 | Corlett, Frith & Fletcher (2009) | P1 | link.springer.com/10.1007/s00213-009-1561-0 | clean |
| 10 | Craske, Treanor, Conway, Zbozinek & Vervliet (2014) | P1 | Crossref 10.1016/j.brat.2014.04.006 | clean |
| 11 | Ecker, Ticic & Hulley (2012) | P2 | searchworks.stanford.edu/view/10086744 | clean |
| 12 | Eubanks, Muran & Safran (2018) | P1 | Crossref 10.1037/pst0000185 | clean |
| 13 | Flückiger, Del Re, Wampold & Horvath (2018) | P1 | Crossref 10.1037/pst0000172 | clean |
| 14 | Fonagy & Allison (2014) | P1 | Crossref 10.1037/a0036505 | clean |
| 15 | Friston (2010) | P1 | nature.com/articles/nrn2787 | clean |
| 16 | Gazzaniga (2011) | P3 | archive.org/details/whosinchargefree0000gazz | clean |
| 17 | Haidt (2006) | P1 | hachettebookgroup.com — 9780465028023 | clean |
| 18 | Haidt (2012) | P1 | penguinrandomhousehighereducation.com — 9780307377906 | clean |
| 19 | Hamilton (1964a) | P1/P2 | pubmed 5875341 · Crossref 10.1016/0022-5193(64)90039-6 | **corrected** |
| 20 | Hamilton (1964b) | P1/P2 | same issue, pp. 17–52 | **corrected** |
| 21 | Henrich & Gil-White (2001) | P1 | Crossref 10.1016/S1090-5138(00)00071-4 | clean |
| 22 | Hofmann & Hayes (2019) | P1 | journals.sagepub.com/10.1177/2167702618772296 | clean |
| 23 | Hohwy (2013) | P1 | academic.oup.com/book/4105 | clean |
| 24 | Janoff-Bulman (1992) | P3 | archive.org/details/shatteredassumpt00ronn | clean |
| 25 | Joiner (2005) | P3 | archive.org/details/whypeoplediebysu0000join | clean |
| 26 | Jordan (2018) | P2 | jstor.org/stable/j.ctv1chrsst | clean |
| 27 | Kapur (2003) | P1 | Crossref 10.1176/appi.ajp.160.1.13 | clean |
| 28 | Kelly (1955) | P3 | openlibrary.org/books/OL6172423M | clean · see advisory 3 |
| 29 | Klass, Silverman & Nickman (1996) | P1 | routledge.com — 9781560323396 | clean |
| 30 | Lambert (2010) | P3 | openlibrary.org/isbn/9781433807824 | clean |
| 31 | Leary, Tambor, Terdal & Downs (1995) | P1 | Crossref 10.1037/0022-3514.68.3.518 | clean |
| 32 | Mahadevan, Gregg & Sedikides (2019) | P1/P2 | eprints.soton.ac.uk author copy · DOI 10.1037/pspp0000189 | **clean — suspicion retired** |
| 33 | Miller & Stiver (1997) | P2 | wellcomecollection.org/works/fch5xbmr | clean |
| 34 | Nisbett & Wilson (1977) | P2 | eric.ed.gov/?id=EJ163657 | clean |
| 35 | O'Connor & Kirtley (2018) | P1 | Crossref 10.1098/rstb.2017.0268 | **journal name completed** |
| 36 | Rao & Ballard (1999) | P1 | nature.com/articles/nn0199_79 | clean |
| 37 | Seth (2021) | P1 | penguinrandomhouse.com/books/566315 | clean |
| 38 | Solms (2021) | P1 | wwnorton.co.uk — 9780393542011 | clean |
| 39 | Sterling (2012) | P2 | pubmed.ncbi.nlm.nih.gov/21684297 | clean |
| 40 | Sterling (2020) | P1 | penguinrandomhouse.com/books/653890 | clean |
| 41 | Sterling & Eyer (1988) | P2 | openlibrary.org/isbn/0471912697 · zenodo.org/records/13537701 | **new — verified** |
| 42 | Sterling & Platt (2022) | P1/P2 | pubmed 35107578 · DOI 10.1001/jamapsychiatry.2021.4209 | **new — verified** |
| 43 | Sue & Sue (2016) | P2 | lane.stanford.edu/view/bib/328833 | clean · see advisory 2 |
| 44 | Trivers (2011) | P1 | hachettebookgroup.com — 9780465028054 | clean · see advisory 5 |
| 45 | Trivers (1971) | P1 | Crossref 10.1086/406755 | **journal name completed** |
| 46 | Van Orden, Witte, Cukrowicz, Braithwaite, Selby & Joiner (2010) | P2 | Europe PMC · DOI 10.1037/a0018697 | clean |
| 47 | Villiger (2025) | P1 | link.springer.com/10.1007/s10879-024-09637-7 | clean |
| 48 | Wampold & Imel (2015) | P1 | routledge.com — 9780805857092 | clean |
| 49 | Young, Klosko & Weishaar (2003) | P1 | guilford.com — 9781593853723 | clean |

---

## Advisory items — your call, not errors

These are places where the record is defensible as written but a copy editor might query it. None was changed.

**1. Clark, *Surfing Uncertainty*.** The paper says 2016. Oxford's own metadata gives 2015 for first publication; 2016 is the widely cited paperback year and the one most sources use. Either is arguable.

**2. Sue & Sue, 7th edition.** Copyright 2016, released December 2015. Standard practice is to cite the copyright year, which is what the paper does.

**3. Kelly (1955).** *The Psychology of Personal Constructs* was published in two volumes. If a specific volume is meant anywhere in the text, the entry could carry it.

**4. Barrett, *How Emotions Are Made*.** Houghton Mifflin Harcourt at first publication, which is what the paper says. Google Books now shows HarperCollins, following the imprint's acquisition. The original publisher is the correct citation.

**5. Trivers, two entries.** They appear as `Trivers, R. (2011)` and `Trivers, R. L. (1971)` — same man, two initial forms, and the later work listed first. Making both `Trivers, R. L.` and ordering 1971 before 2011 would be the cleaner APA form. Say the word and I'll change it.

**One thing fixed without asking, because it was my own error from this session:** Sterling & Platt (2022) had been inserted ahead of Sterling & Eyer (1988). Eyer alphabetizes before Platt. Reordered. Byte count unchanged.

---

## Pass 2 — what is still owed

**Claim-level verification.** Every source above is real and correctly described *as an object*. Whether it argues what the citing sentence says it argues has not been checked. The sentences that lean hardest on their sources are the ones to check first.

**Known claim-level exposures already on the list:**

- The CBT-I component-literature clause, added 30 July, written from memory and never checked against the dismantling studies it summarizes.
- Page numbers throughout — none were opened.
- In the trade book, separately: "exposure, the most thoroughly proven move in the entire clinical toolkit."

**What the browser is actually for.** Pass 1 ran better from the cloud — parallel retrieval against DOI registries and publisher pages, six workers at once, no navigation. Pass 2 is the opposite shape: it needs full texts, several of them paywalled, and the thing that unlocks them is your own institutional login sitting in your browser. It also needs Google Scholar, which blocks automated fetching outright. That is the work only the browser can do.

---

*Pass 1 located and recorded. It does not confirm. Confirmation is a signature, and the signature is yours.*

---

## Addendum — 1 August 2026 (two references added with the §6.1 origin-vs-maintenance note)

**50. Ratts, M. J., Singh, A. A., Nassar-McMillan, S., Butler, S. K., & McCullough, J. R. (2015). *Multicultural and social justice counseling competencies.* American Counseling Association.** — Status: **RECORD LAYER PENDING.** Located via Singh, Appling & Trepal (2020, *JCD* 98, p. 261), which cites it as the ACA-endorsed competencies document (retrieved from counseling.org). Confirm against counseling.org's own copy: author order, year (the competencies *document* is 2015; the related *JMCD* article is Ratts et al., 2016 — do not conflate), and exact title.

**51. Spielman, A. J., Caruso, L. S., & Glovinsky, P. B. (1987). A behavioral perspective on insomnia treatment. *Psychiatric Clinics of North America, 10*(4), 541–553.** — Status: **RECORD LAYER PENDING.** Same work as tracker row 60 in the Strategies of Disconnection corpus. Crossref rate-limited (429) at the time of this addendum; check the publisher record (Elsevier) for volume/issue/pages before signing.

Both await the same live-retrieval check and signature as Pass 1. Claim layer for Pass 2: the §6.1 sentence attributes to Spielman et al. the predisposing/precipitating/perpetuating framing with treatment aimed at perpetuating factors — confirm on the paper's own pages.

---

## Addendum — references added after Pass 1

**2026-08-22 — two additions, UNVERIFIED (not part of the signed 31 July pass).** Gap found by Daniel: the paper cites Rogers' sufficiency claim in the abstract and §5, and the crosswalk carries a Person-centered row, but no Rogers entry existed in the references. Added:

| Source | Status | Verified by |
|---|---|---|
| Rogers, C. R. (1951). *Client-centered therapy.* Houghton Mifflin. | UNVERIFIED — record layer not yet checked | *(blank — yours)* |
| Rogers, C. R. (1957). The necessary and sufficient conditions of therapeutic personality change. *Journal of Consulting Psychology, 21*(2), 95–103. | UNVERIFIED — record layer not yet checked | *(blank — yours)* |

Both entries are named-from-memory and must go through the same live-retrieval check as Pass 1 (Crossref/registry) before formal use. In-text: "(1957)" was added at the abstract's sufficiency mention and §5's "what Rogers was reporting." The reference count in the paper is now 50 — note the arithmetic: Pass 1 checked 49, and the list held 48 before these two additions, so one reference has been removed from the paper since 31 July (or Pass 1 miscounted by one). Worth a glance in Pass 2.
