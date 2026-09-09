/**
 * Every work cited across docs/theory, and what the verification ledger says.
 *
 * GENERATED — do not edit by hand. Regenerate with:
 *   pnpm --filter @ledger/clinician build:references
 * test/references.test.ts re-derives this from the sources and fails on drift.
 *
 * Three origins, none of them interpreted here:
 *
 *   corpus / external  the keyed entries the Library already cited by key, from
 *                      the file key of docs/theory-mapping.md.
 *   ledger             the 49 numbered rows of the signed Pass-1 table in
 *                      docs/theory/citation-verification-ledger.md, plus the
 *                      four later entries it marks pending or unverified.
 *   pin                the "Pin targets" table of each protocol.
 *
 * `tier` is the ledger's evidence tier. null means the ledger does not cover
 * the work, and the page marks it "record not yet verified". That is a
 * statement about the ledger's coverage, not a judgement about the source:
 * the ledger verified the paper's reference list, and the protocols cite a
 * largely different set of works. Nothing here verifies a citation, and no DOI
 * or URL appears that the sources do not contain.
 */
import { z } from 'zod';

export const TIERS = ['P1', 'P2', 'P3', 'P1/P2'] as const;
export type Tier = (typeof TIERS)[number];

export const referenceSchema = z.object({
  /** Stable key. Content modules cite by this and only this. */
  key: z.string().min(1),
  /** The token the sources use for this work. */
  citedAs: z.string().min(1),
  /** The path or citation as the source gives it. */
  source: z.string().min(1),
  kind: z.enum(['corpus', 'external', 'pin', 'ledger']),
  /** The ledger's evidence tier, or null where the ledger does not cover it. */
  tier: z.enum(TIERS).nullable(),
  ledgerRow: z.number().int().nullable(),
  /** Protocol slugs whose Pin targets table names this work. */
  citedBy: z.array(z.string()),
});

export type Reference = z.infer<typeof referenceSchema>;

export const REFERENCES: readonly Reference[] = z.array(referenceSchema).parse([
  {
    "key": "ucm",
    "citedAs": "UCM",
    "source": "Unified Theory of Psychotherapy/A Unified Clinical Model of Psychotherapy.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "cg",
    "citedAs": "CG",
    "source": "The Clinician's Guide to Predictive Processing.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "f4",
    "citedAs": "F4",
    "source": "floor-notes/Floor N — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "f5",
    "citedAs": "F5",
    "source": "floor-notes/Floor N — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "f6",
    "citedAs": "F6",
    "source": "floor-notes/Floor N — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "f7",
    "citedAs": "F7",
    "source": "floor-notes/Floor N — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "p-panic",
    "citedAs": "P-Panic",
    "source": "Clinical Tools/Protocol — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "p-ptsd",
    "citedAs": "P-PTSD",
    "source": "Clinical Tools/Protocol — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "p-sa",
    "citedAs": "P-SA",
    "source": "Clinical Tools/Protocol — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "da",
    "citedAs": "DA",
    "source": "Decision Aid — Locating the Floor.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "fr",
    "citedAs": "FR",
    "source": "Formulation Router — Door to Drawer.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "mod",
    "citedAs": "MOD",
    "source": "How the Major Modalities Recalibrate Priors.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rn-surprise",
    "citedAs": "RN-Surprise",
    "source": "research-notes/2026-08-12 — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rn-guess",
    "citedAs": "RN-Guess",
    "source": "research-notes/2026-08-12 — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rn-elastic",
    "citedAs": "RN-Elastic",
    "source": "research-notes/2026-08-12 — ….md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "wtd",
    "citedAs": "WtD",
    "source": "Waking the Driver — full manuscript (build 2026-08-22).md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rnu",
    "citedAs": "R&U",
    "source": "Respected and Unwanted — TRADE BOOK.md",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rnu-gauges",
    "citedAs": "R&U-Gauges",
    "source": "Respected and Unwanted/Concepts/",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rnu-bridge",
    "citedAs": "R&U-Bridge",
    "source": "Respected and Unwanted/Concepts/",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rnu-evidence",
    "citedAs": "R&U-Evidence",
    "source": "Respected and Unwanted/Concepts/",
    "kind": "corpus",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "craske-2014",
    "citedAs": "Craske et al. (2014)",
    "source": "Craske et al. (2014)",
    "kind": "external",
    "tier": "P1",
    "ledgerRow": 10,
    "citedBy": []
  },
  {
    "key": "eubanks-2018",
    "citedAs": "Eubanks, Muran, & Safran, 2018",
    "source": "Eubanks, Muran, & Safran, 2018",
    "kind": "external",
    "tier": "P1",
    "ledgerRow": 12,
    "citedBy": []
  },
  {
    "key": "lambert-2010",
    "citedAs": "Lambert, 2010",
    "source": "Lambert, 2010",
    "kind": "external",
    "tier": "P3",
    "ledgerRow": 30,
    "citedBy": []
  },
  {
    "key": "salkovskis",
    "citedAs": "Salkovskis",
    "source": "Salkovskis",
    "kind": "external",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "barlow-craske",
    "citedAs": "Barlow/Craske",
    "source": "Barlow/Craske",
    "kind": "external",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "anderson-hildreth-howland-2015",
    "citedAs": "Anderson, Hildreth & Howland (2015)",
    "source": "Anderson, Hildreth & Howland (2015)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 1,
    "citedBy": []
  },
  {
    "key": "barrett-2017",
    "citedAs": "Barrett (2017)",
    "source": "Barrett (2017)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 2,
    "citedBy": []
  },
  {
    "key": "baumeister-leary-1995",
    "citedAs": "Baumeister & Leary (1995)",
    "source": "Baumeister & Leary (1995)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 3,
    "citedBy": []
  },
  {
    "key": "beck-1976",
    "citedAs": "Beck (1976)",
    "source": "Beck (1976)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 4,
    "citedBy": []
  },
  {
    "key": "bowlby-1969",
    "citedAs": "Bowlby (1969)",
    "source": "Bowlby (1969)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 5,
    "citedBy": []
  },
  {
    "key": "case-deaton-2020",
    "citedAs": "Case & Deaton (2020)",
    "source": "Case & Deaton (2020)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 6,
    "citedBy": []
  },
  {
    "key": "cheng-tracy-foulsham-kingstone-henrich-2013",
    "citedAs": "Cheng, Tracy, Foulsham, Kingstone & Henrich (2013)",
    "source": "Cheng, Tracy, Foulsham, Kingstone & Henrich (2013)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 7,
    "citedBy": []
  },
  {
    "key": "clark-2016",
    "citedAs": "Clark (2016)",
    "source": "Clark (2016)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 8,
    "citedBy": []
  },
  {
    "key": "corlett-frith-fletcher-2009",
    "citedAs": "Corlett, Frith & Fletcher (2009)",
    "source": "Corlett, Frith & Fletcher (2009)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 9,
    "citedBy": []
  },
  {
    "key": "craske-treanor-conway-zbozinek-vervliet-2014",
    "citedAs": "Craske, Treanor, Conway, Zbozinek & Vervliet (2014)",
    "source": "Craske, Treanor, Conway, Zbozinek & Vervliet (2014)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 10,
    "citedBy": [
      "addiction",
      "chronic-pain",
      "insomnia",
      "ocd",
      "panic",
      "prolonged-grief",
      "ptsd",
      "social-anxiety",
      "the-self-story",
      "worry-gad"
    ]
  },
  {
    "key": "ecker-ticic-hulley-2012",
    "citedAs": "Ecker, Ticic & Hulley (2012)",
    "source": "Ecker, Ticic & Hulley (2012)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 11,
    "citedBy": []
  },
  {
    "key": "eubanks-muran-safran-2018",
    "citedAs": "Eubanks, Muran & Safran (2018)",
    "source": "Eubanks, Muran & Safran (2018)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 12,
    "citedBy": []
  },
  {
    "key": "fl-ckiger-del-re-wampold-horvath-2018",
    "citedAs": "Flückiger, Del Re, Wampold & Horvath (2018)",
    "source": "Flückiger, Del Re, Wampold & Horvath (2018)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 13,
    "citedBy": []
  },
  {
    "key": "fonagy-allison-2014",
    "citedAs": "Fonagy & Allison (2014)",
    "source": "Fonagy & Allison (2014)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 14,
    "citedBy": []
  },
  {
    "key": "friston-2010",
    "citedAs": "Friston (2010)",
    "source": "Friston (2010)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 15,
    "citedBy": []
  },
  {
    "key": "gazzaniga-2011",
    "citedAs": "Gazzaniga (2011)",
    "source": "Gazzaniga (2011)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 16,
    "citedBy": []
  },
  {
    "key": "haidt-2006",
    "citedAs": "Haidt (2006)",
    "source": "Haidt (2006)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 17,
    "citedBy": []
  },
  {
    "key": "haidt-2012",
    "citedAs": "Haidt (2012)",
    "source": "Haidt (2012)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 18,
    "citedBy": []
  },
  {
    "key": "hamilton-1964a",
    "citedAs": "Hamilton (1964a)",
    "source": "Hamilton (1964a)",
    "kind": "ledger",
    "tier": "P1/P2",
    "ledgerRow": 19,
    "citedBy": []
  },
  {
    "key": "hamilton-1964b",
    "citedAs": "Hamilton (1964b)",
    "source": "Hamilton (1964b)",
    "kind": "ledger",
    "tier": "P1/P2",
    "ledgerRow": 20,
    "citedBy": []
  },
  {
    "key": "henrich-gil-white-2001",
    "citedAs": "Henrich & Gil-White (2001)",
    "source": "Henrich & Gil-White (2001)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 21,
    "citedBy": []
  },
  {
    "key": "hofmann-hayes-2019",
    "citedAs": "Hofmann & Hayes (2019)",
    "source": "Hofmann & Hayes (2019)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 22,
    "citedBy": []
  },
  {
    "key": "hohwy-2013",
    "citedAs": "Hohwy (2013)",
    "source": "Hohwy (2013)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 23,
    "citedBy": []
  },
  {
    "key": "janoff-bulman-1992",
    "citedAs": "Janoff-Bulman (1992)",
    "source": "Janoff-Bulman (1992)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 24,
    "citedBy": []
  },
  {
    "key": "joiner-2005",
    "citedAs": "Joiner (2005)",
    "source": "Joiner (2005)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 25,
    "citedBy": []
  },
  {
    "key": "jordan-2018",
    "citedAs": "Jordan (2018)",
    "source": "Jordan (2018)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 26,
    "citedBy": []
  },
  {
    "key": "kapur-2003",
    "citedAs": "Kapur (2003)",
    "source": "Kapur (2003)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 27,
    "citedBy": []
  },
  {
    "key": "kelly-1955",
    "citedAs": "Kelly (1955)",
    "source": "Kelly (1955)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 28,
    "citedBy": []
  },
  {
    "key": "klass-silverman-nickman-1996",
    "citedAs": "Klass, Silverman & Nickman (1996)",
    "source": "Klass, Silverman & Nickman (1996)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 29,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "lambert-2010-2",
    "citedAs": "Lambert (2010)",
    "source": "Lambert (2010)",
    "kind": "ledger",
    "tier": "P3",
    "ledgerRow": 30,
    "citedBy": []
  },
  {
    "key": "leary-tambor-terdal-downs-1995",
    "citedAs": "Leary, Tambor, Terdal & Downs (1995)",
    "source": "Leary, Tambor, Terdal & Downs (1995)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 31,
    "citedBy": []
  },
  {
    "key": "mahadevan-gregg-sedikides-2019",
    "citedAs": "Mahadevan, Gregg & Sedikides (2019)",
    "source": "Mahadevan, Gregg & Sedikides (2019)",
    "kind": "ledger",
    "tier": "P1/P2",
    "ledgerRow": 32,
    "citedBy": []
  },
  {
    "key": "miller-stiver-1997",
    "citedAs": "Miller & Stiver (1997)",
    "source": "Miller & Stiver (1997)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 33,
    "citedBy": []
  },
  {
    "key": "nisbett-wilson-1977",
    "citedAs": "Nisbett & Wilson (1977)",
    "source": "Nisbett & Wilson (1977)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 34,
    "citedBy": []
  },
  {
    "key": "oconnor-kirtley-2018",
    "citedAs": "O'Connor & Kirtley (2018)",
    "source": "O'Connor & Kirtley (2018)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 35,
    "citedBy": []
  },
  {
    "key": "rao-ballard-1999",
    "citedAs": "Rao & Ballard (1999)",
    "source": "Rao & Ballard (1999)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 36,
    "citedBy": []
  },
  {
    "key": "seth-2021",
    "citedAs": "Seth (2021)",
    "source": "Seth (2021)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 37,
    "citedBy": []
  },
  {
    "key": "solms-2021",
    "citedAs": "Solms (2021)",
    "source": "Solms (2021)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 38,
    "citedBy": []
  },
  {
    "key": "sterling-2012",
    "citedAs": "Sterling (2012)",
    "source": "Sterling (2012)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 39,
    "citedBy": []
  },
  {
    "key": "sterling-2020",
    "citedAs": "Sterling (2020)",
    "source": "Sterling (2020)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 40,
    "citedBy": []
  },
  {
    "key": "sterling-eyer-1988",
    "citedAs": "Sterling & Eyer (1988)",
    "source": "Sterling & Eyer (1988)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 41,
    "citedBy": []
  },
  {
    "key": "sterling-platt-2022",
    "citedAs": "Sterling & Platt (2022)",
    "source": "Sterling & Platt (2022)",
    "kind": "ledger",
    "tier": "P1/P2",
    "ledgerRow": 42,
    "citedBy": []
  },
  {
    "key": "sue-sue-2016",
    "citedAs": "Sue & Sue (2016)",
    "source": "Sue & Sue (2016)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 43,
    "citedBy": []
  },
  {
    "key": "trivers-2011",
    "citedAs": "Trivers (2011)",
    "source": "Trivers (2011)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 44,
    "citedBy": []
  },
  {
    "key": "trivers-1971",
    "citedAs": "Trivers (1971)",
    "source": "Trivers (1971)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 45,
    "citedBy": []
  },
  {
    "key": "van-orden-witte-cukrowicz-braithwaite-selby-joiner-2010",
    "citedAs": "Van Orden, Witte, Cukrowicz, Braithwaite, Selby & Joiner (2010)",
    "source": "Van Orden, Witte, Cukrowicz, Braithwaite, Selby & Joiner (2010)",
    "kind": "ledger",
    "tier": "P2",
    "ledgerRow": 46,
    "citedBy": []
  },
  {
    "key": "villiger-2025",
    "citedAs": "Villiger (2025)",
    "source": "Villiger (2025)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 47,
    "citedBy": []
  },
  {
    "key": "wampold-imel-2015",
    "citedAs": "Wampold & Imel (2015)",
    "source": "Wampold & Imel (2015)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 48,
    "citedBy": []
  },
  {
    "key": "young-klosko-weishaar-2003",
    "citedAs": "Young, Klosko & Weishaar (2003)",
    "source": "Young, Klosko & Weishaar (2003)",
    "kind": "ledger",
    "tier": "P1",
    "ledgerRow": 49,
    "citedBy": []
  },
  {
    "key": "ratts-m-j-singh-a-a-nassar-mcmillan-s-butler-s-k-mccullough",
    "citedAs": "Ratts, M. J., Singh, A. A., Nassar-McMillan, S., Butler, S. K., & McCullough, J. R. (2015). Multicultural and social justice counseling competencies. American Counseling Association.",
    "source": "Ratts, M. J., Singh, A. A., Nassar-McMillan, S., Butler, S. K., & McCullough, J. R. (2015). Multicultural and social justice counseling competencies. American Counseling Association.",
    "kind": "ledger",
    "tier": null,
    "ledgerRow": 50,
    "citedBy": []
  },
  {
    "key": "spielman-a-j-caruso-l-s-glovinsky-p-b-1987-a-behavioral-pers",
    "citedAs": "Spielman, A. J., Caruso, L. S., & Glovinsky, P. B. (1987). A behavioral perspective on insomnia treatment. Psychiatric Clinics of North America, 10(4), 541–553.",
    "source": "Spielman, A. J., Caruso, L. S., & Glovinsky, P. B. (1987). A behavioral perspective on insomnia treatment. Psychiatric Clinics of North America, 10(4), 541–553.",
    "kind": "ledger",
    "tier": null,
    "ledgerRow": 51,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "rogers-c-r-1951-client-centered-therapy-houghton-mifflin",
    "citedAs": "Rogers, C. R. (1951). Client-centered therapy. Houghton Mifflin.",
    "source": "Rogers, C. R. (1951). Client-centered therapy. Houghton Mifflin.",
    "kind": "ledger",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "rogers-c-r-1957-the-necessary-and-sufficient-conditions-of-t",
    "citedAs": "Rogers, C. R. (1957). The necessary and sufficient conditions of therapeutic personality change. Journal of Consulting Psychology, 21(2), 95–103.",
    "source": "Rogers, C. R. (1957). The necessary and sufficient conditions of therapeutic personality change. Journal of Consulting Psychology, 21(2), 95–103.",
    "kind": "ledger",
    "tier": null,
    "ledgerRow": null,
    "citedBy": []
  },
  {
    "key": "kube-et-al-2019",
    "citedAs": "Kube et al. 2019",
    "source": "Kube et al. 2019",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction",
      "chronic-pain",
      "insomnia",
      "prolonged-grief",
      "ptsd",
      "the-self-story"
    ]
  },
  {
    "key": "joiner",
    "citedAs": "Joiner",
    "source": "Joiner",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction",
      "chronic-pain",
      "prolonged-grief"
    ]
  },
  {
    "key": "sleep-block-riemann-espie-harvey",
    "citedAs": "Sleep block (Riemann; Espie; Harvey)",
    "source": "Sleep block (Riemann; Espie; Harvey)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction",
      "chronic-pain",
      "prolonged-grief",
      "ptsd"
    ]
  },
  {
    "key": "berridge-robinson",
    "citedAs": "Berridge & Robinson",
    "source": "Berridge & Robinson",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "marlatt-gordon-1985",
    "citedAs": "Marlatt & Gordon 1985",
    "source": "Marlatt & Gordon 1985",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "bowen-et-al-mbrp-trials",
    "citedAs": "Bowen et al. (MBRP trials)",
    "source": "Bowen et al. (MBRP trials)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "miller-rollnick",
    "citedAs": "Miller & Rollnick",
    "source": "Miller & Rollnick",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "witkiewitz-marlatt-2004",
    "citedAs": "Witkiewitz & Marlatt 2004",
    "source": "Witkiewitz & Marlatt 2004",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "sinha",
    "citedAs": "Sinha",
    "source": "Sinha",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "volkow-et-al",
    "citedAs": "Volkow et al.",
    "source": "Volkow et al.",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "mclellan-et-al-2000",
    "citedAs": "McLellan et al. 2000",
    "source": "McLellan et al. 2000",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "addiction"
    ]
  },
  {
    "key": "sterling-allostasis",
    "citedAs": "Sterling (allostasis)",
    "source": "Sterling (allostasis)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "ashar-et-al-2022-jama-psychiatry",
    "citedAs": "Ashar et al. 2022, JAMA Psychiatry",
    "source": "Ashar et al. 2022, JAMA Psychiatry",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "moseley-butler-explain-pain-lineage",
    "citedAs": "Moseley & Butler, Explain Pain lineage",
    "source": "Moseley & Butler, Explain Pain lineage",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "vlaeyen-linton-2000",
    "citedAs": "Vlaeyen & Linton 2000",
    "source": "Vlaeyen & Linton 2000",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "woolf-2011",
    "citedAs": "Woolf 2011",
    "source": "Woolf 2011",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "kosek-et-al-2016-iasp",
    "citedAs": "Kosek et al. 2016 (IASP)",
    "source": "Kosek et al. 2016 (IASP)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "sullivan-et-al-pcs-kori-et-al-tsk",
    "citedAs": "Sullivan et al., PCS; Kori et al., TSK",
    "source": "Sullivan et al., PCS; Kori et al., TSK",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "fordyce",
    "citedAs": "Fordyce",
    "source": "Fordyce",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "lumley-schubiner-eaet",
    "citedAs": "Lumley & Schubiner (EAET)",
    "source": "Lumley & Schubiner (EAET)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "chronic-pain"
    ]
  },
  {
    "key": "kube-et-al-2019-psychological-medicine",
    "citedAs": "Kube et al. 2019, Psychological Medicine",
    "source": "Kube et al. 2019, Psychological Medicine",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression",
      "ocd",
      "panic",
      "social-anxiety",
      "worry-gad"
    ]
  },
  {
    "key": "swann-et-al-1992-j-abnormal-psychology",
    "citedAs": "Swann et al. 1992, J. Abnormal Psychology",
    "source": "Swann et al. 1992, J. Abnormal Psychology",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "jacobson-et-al-1996-component-analysis-martell-dimidjian-ba",
    "citedAs": "Jacobson et al. 1996 component analysis; Martell/Dimidjian BA",
    "source": "Jacobson et al. 1996 component analysis; Martell/Dimidjian BA",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "lewinsohn-behavioral-model-of-depression",
    "citedAs": "Lewinsohn, behavioral model of depression",
    "source": "Lewinsohn, behavioral model of depression",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "nolen-hoeksema-watkins-rfcbt",
    "citedAs": "Nolen-Hoeksema; Watkins (RFCBT)",
    "source": "Nolen-Hoeksema; Watkins (RFCBT)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "beck-cognitive-model-the-triad",
    "citedAs": "Beck, cognitive model / the triad",
    "source": "Beck, cognitive model / the triad",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "gilbert-defeat-entrapment-social-rank",
    "citedAs": "Gilbert, defeat–entrapment; social rank",
    "source": "Gilbert, defeat–entrapment; social rank",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "sleep-block-riemann-2023-espie-harvey",
    "citedAs": "Sleep block (Riemann 2023; Espie; Harvey)",
    "source": "Sleep block (Riemann 2023; Espie; Harvey)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression",
      "ocd",
      "worry-gad"
    ]
  },
  {
    "key": "stanley-brown-safety-planning-c-ssrs",
    "citedAs": "Stanley & Brown safety planning; C-SSRS",
    "source": "Stanley & Brown safety planning; C-SSRS",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "exercise-for-depression-schuch-et-al-meta",
    "citedAs": "Exercise for depression (Schuch et al. meta)",
    "source": "Exercise for depression (Schuch et al. meta)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression"
    ]
  },
  {
    "key": "joiner-metalsky-2001",
    "citedAs": "Joiner & Metalsky 2001",
    "source": "Joiner & Metalsky 2001",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "depression",
      "social-anxiety",
      "the-self-story",
      "worry-gad"
    ]
  },
  {
    "key": "espie-et-al-2006-attention-intention-effort",
    "citedAs": "Espie et al. 2006, attention–intention–effort",
    "source": "Espie et al. 2006, attention–intention–effort",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "harvey-cognitive-model-of-insomnia",
    "citedAs": "Harvey, cognitive model of insomnia",
    "source": "Harvey, cognitive model of insomnia",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "riemann-et-al-2023-european-insomnia-guideline",
    "citedAs": "Riemann et al. 2023, European insomnia guideline",
    "source": "Riemann et al. 2023, European insomnia guideline",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "bootzin-1972",
    "citedAs": "Bootzin 1972",
    "source": "Bootzin 1972",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "morin-isi-bastien-et-al-2001",
    "citedAs": "Morin; ISI (Bastien et al. 2001)",
    "source": "Morin; ISI (Bastien et al. 2001)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "stop-bang-chung-et-al-2008",
    "citedAs": "STOP-BANG (Chung et al. 2008)",
    "source": "STOP-BANG (Chung et al. 2008)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "wickwire-krakow-imagery-rehearsal",
    "citedAs": "Wickwire / Krakow, imagery rehearsal",
    "source": "Wickwire / Krakow, imagery rehearsal",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "insomnia"
    ]
  },
  {
    "key": "salkovskis-1991",
    "citedAs": "Salkovskis 1991",
    "source": "Salkovskis 1991",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd",
      "worry-gad"
    ]
  },
  {
    "key": "rachman-de-silva-1978",
    "citedAs": "Rachman & de Silva 1978",
    "source": "Rachman & de Silva 1978",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "salkovskis-1985-1999",
    "citedAs": "Salkovskis 1985; 1999",
    "source": "Salkovskis 1985; 1999",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "van-den-hout-kindt-2003",
    "citedAs": "van den Hout & Kindt 2003",
    "source": "van den Hout & Kindt 2003",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "foa-kozak-foa-et-al-erp-trials",
    "citedAs": "Foa & Kozak; Foa et al., ERP trials",
    "source": "Foa & Kozak; Foa et al., ERP trials",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "shafran-thordarson-rachman-1996",
    "citedAs": "Shafran, Thordarson & Rachman 1996",
    "source": "Shafran, Thordarson & Rachman 1996",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "goodman-et-al-1989",
    "citedAs": "Goodman et al. 1989",
    "source": "Goodman et al. 1989",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "abramowitz-et-al-postpartum-intrusions",
    "citedAs": "Abramowitz et al., postpartum intrusions",
    "source": "Abramowitz et al., postpartum intrusions",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "family-accommodation-calvocoressi-lineage",
    "citedAs": "Family accommodation (Calvocoressi lineage)",
    "source": "Family accommodation (Calvocoressi lineage)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ocd"
    ]
  },
  {
    "key": "salkovskis-1991-behaviour-in-the-maintenance-of-anxiety-and",
    "citedAs": "Salkovskis 1991, behaviour in the maintenance of anxiety and panic",
    "source": "Salkovskis 1991, behaviour in the maintenance of anxiety and panic",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "clark-1986-behaviour-research-and-therapy",
    "citedAs": "Clark 1986, Behaviour Research and Therapy",
    "source": "Clark 1986, Behaviour Research and Therapy",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "barlow-craske-barlow-panic-control-treatment",
    "citedAs": "Barlow; Craske & Barlow, panic control treatment",
    "source": "Barlow; Craske & Barlow, panic control treatment",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "nesse-the-smoke-detector-principle",
    "citedAs": "Nesse, the smoke-detector principle",
    "source": "Nesse, the smoke-detector principle",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "antony-et-al-interoceptive-exercise-batteries",
    "citedAs": "Antony et al., interoceptive exercise batteries",
    "source": "Antony et al., interoceptive exercise batteries",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "shear-et-al-1997",
    "citedAs": "Shear et al. 1997",
    "source": "Shear et al. 1997",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "benzodiazepines-and-exposure-outcome-marks-westra-lineage",
    "citedAs": "Benzodiazepines and exposure outcome (Marks / Westra lineage)",
    "source": "Benzodiazepines and exposure outcome (Marks / Westra lineage)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "caffeine-challenge-studies-charney-lineage",
    "citedAs": "Caffeine challenge studies (Charney lineage)",
    "source": "Caffeine challenge studies (Charney lineage)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "panic"
    ]
  },
  {
    "key": "shear-et-al-2005-2014-jama-jama-psychiatry",
    "citedAs": "Shear et al. 2005; 2014 (JAMA; JAMA Psychiatry)",
    "source": "Shear et al. 2005; 2014 (JAMA; JAMA Psychiatry)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "prigerson-et-al",
    "citedAs": "Prigerson et al.",
    "source": "Prigerson et al.",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "boelen-et-al-2006",
    "citedAs": "Boelen et al. 2006",
    "source": "Boelen et al. 2006",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "stroebe-schut-1999",
    "citedAs": "Stroebe & Schut 1999",
    "source": "Stroebe & Schut 1999",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "oconnor-the-grieving-brain",
    "citedAs": "O'Connor, The Grieving Brain",
    "source": "O'Connor, The Grieving Brain",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "bonanno",
    "citedAs": "Bonanno",
    "source": "Bonanno",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "jordan-mcintosh",
    "citedAs": "Jordan & McIntosh",
    "source": "Jordan & McIntosh",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "prolonged-grief"
    ]
  },
  {
    "key": "van-ijzendoorn-et-al-1999",
    "citedAs": "van IJzendoorn et al. 1999",
    "source": "van IJzendoorn et al. 1999",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "ehlers-clark-2000-behaviour-research-and-therapy",
    "citedAs": "Ehlers & Clark 2000, Behaviour Research and Therapy",
    "source": "Ehlers & Clark 2000, Behaviour Research and Therapy",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "foa-kozak-1986-foa-et-al-pe-trials",
    "citedAs": "Foa & Kozak 1986; Foa et al., PE trials",
    "source": "Foa & Kozak 1986; Foa et al., PE trials",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "resick-et-al-cpt",
    "citedAs": "Resick et al., CPT",
    "source": "Resick et al., CPT",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "bisson-et-al-meta-analyses-incl-emdr-equivalence",
    "citedAs": "Bisson et al., meta-analyses (incl. EMDR equivalence)",
    "source": "Bisson et al., meta-analyses (incl. EMDR equivalence)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "weathers-et-al-pcl-5",
    "citedAs": "Weathers et al., PCL-5",
    "source": "Weathers et al., PCL-5",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "bernstein-putnam-des-ii",
    "citedAs": "Bernstein & Putnam, DES-II",
    "source": "Bernstein & Putnam, DES-II",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "krakow-et-al-imagery-rehearsal",
    "citedAs": "Krakow et al., imagery rehearsal",
    "source": "Krakow et al., imagery rehearsal",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "najavits-seeking-safety",
    "citedAs": "Najavits, Seeking Safety",
    "source": "Najavits, Seeking Safety",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "litz-et-al-moral-injury",
    "citedAs": "Litz et al., moral injury",
    "source": "Litz et al., moral injury",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "rose-et-al-cochrane-on-debriefing",
    "citedAs": "Rose et al., Cochrane on debriefing",
    "source": "Rose et al., Cochrane on debriefing",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "walker-complex-ptsd-4f",
    "citedAs": "Walker, Complex PTSD (4F)",
    "source": "Walker, Complex PTSD (4F)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "ptsd"
    ]
  },
  {
    "key": "salkovskis-1991-behaviour-in-the-maintenance-of-anxiety",
    "citedAs": "Salkovskis 1991, behaviour in the maintenance of anxiety",
    "source": "Salkovskis 1991, behaviour in the maintenance of anxiety",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "swann-read-1981-swann-et-al-1992",
    "citedAs": "Swann & Read 1981; Swann et al. 1992",
    "source": "Swann & Read 1981; Swann et al. 1992",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety",
      "the-self-story"
    ]
  },
  {
    "key": "clark-wells-1995-in-heimberg-et-al-social-phobia",
    "citedAs": "Clark & Wells 1995 (in Heimberg et al., Social Phobia)",
    "source": "Clark & Wells 1995 (in Heimberg et al., Social Phobia)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "wells-et-al-1995",
    "citedAs": "Wells et al. 1995",
    "source": "Wells et al. 1995",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "rapee-heimberg-1997",
    "citedAs": "Rapee & Heimberg 1997",
    "source": "Rapee & Heimberg 1997",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "video-feedback-harvey-et-al-2000-warnock-parkes-et-al-2017",
    "citedAs": "Video feedback (Harvey et al. 2000; Warnock-Parkes et al. 2017)",
    "source": "Video feedback (Harvey et al. 2000; Warnock-Parkes et al. 2017)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "imagery-rescripting-wild-hackmann-clark-2007-2008",
    "citedAs": "Imagery rescripting (Wild, Hackmann & Clark 2007/2008)",
    "source": "Imagery rescripting (Wild, Hackmann & Clark 2007/2008)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "mayo-wilson-et-al-2014-lancet-psychiatry-network-meta-analys",
    "citedAs": "Mayo-Wilson et al. 2014, Lancet Psychiatry network meta-analysis",
    "source": "Mayo-Wilson et al. 2014, Lancet Psychiatry network meta-analysis",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "liebowitz-1987",
    "citedAs": "Liebowitz 1987",
    "source": "Liebowitz 1987",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "gilbert-social-rank-theory",
    "citedAs": "Gilbert, social rank theory",
    "source": "Gilbert, social rank theory",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "social-anxiety-alcohol-comorbidity-buckner-et-al",
    "citedAs": "Social anxiety–alcohol comorbidity (Buckner et al.)",
    "source": "Social anxiety–alcohol comorbidity (Buckner et al.)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "social-anxiety"
    ]
  },
  {
    "key": "fennell-1997-1998",
    "citedAs": "Fennell 1997; 1998",
    "source": "Fennell 1997; 1998",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "the-self-story"
    ]
  },
  {
    "key": "rosenberg-1965",
    "citedAs": "Rosenberg 1965",
    "source": "Rosenberg 1965",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "the-self-story"
    ]
  },
  {
    "key": "gilbert-compassion-focused-therapy",
    "citedAs": "Gilbert, compassion-focused therapy",
    "source": "Gilbert, compassion-focused therapy",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "the-self-story"
    ]
  },
  {
    "key": "neff-self-compassion-program",
    "citedAs": "Neff, self-compassion program",
    "source": "Neff, self-compassion program",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "the-self-story"
    ]
  },
  {
    "key": "orth-robins-self-esteem-trajectories",
    "citedAs": "Orth & Robins, self-esteem trajectories",
    "source": "Orth & Robins, self-esteem trajectories",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "the-self-story"
    ]
  },
  {
    "key": "borkovec-avoidance-theory-of-worry-stimulus-control-postpone",
    "citedAs": "Borkovec, avoidance theory of worry; stimulus-control/postponement",
    "source": "Borkovec, avoidance theory of worry; stimulus-control/postponement",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "worry-gad"
    ]
  },
  {
    "key": "wells-metacognitive-model-of-gad",
    "citedAs": "Wells, metacognitive model of GAD",
    "source": "Wells, metacognitive model of GAD",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "worry-gad"
    ]
  },
  {
    "key": "dugas-et-al-intolerance-of-uncertainty",
    "citedAs": "Dugas et al., intolerance of uncertainty",
    "source": "Dugas et al., intolerance of uncertainty",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "worry-gad"
    ]
  },
  {
    "key": "newman-llera-contrast-avoidance",
    "citedAs": "Newman & Llera, contrast-avoidance",
    "source": "Newman & Llera, contrast-avoidance",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "worry-gad"
    ]
  },
  {
    "key": "spitzer-et-al-2006-gad-7-meyer-et-al-1990-pswq",
    "citedAs": "Spitzer et al. 2006 (GAD-7); Meyer et al. 1990 (PSWQ)",
    "source": "Spitzer et al. 2006 (GAD-7); Meyer et al. 1990 (PSWQ)",
    "kind": "pin",
    "tier": null,
    "ledgerRow": null,
    "citedBy": [
      "worry-gad"
    ]
  }
]);

const BY_KEY = new Map(REFERENCES.map((r) => [r.key, r]));

export const referenceKeys = (): string[] => REFERENCES.map((r) => r.key);

export function reference(key: string): Reference {
  const r = BY_KEY.get(key);
  if (!r) throw new Error(`Unknown reference key: ${key}`);
  return r;
}

/** A citation list rendered as the sources' own tokens, e.g. "UCM · WtD". */
export const citeLabel = (keys: readonly string[]): string => keys.map((k) => reference(k).citedAs).join(' · ');

/** The mark a work carries when the ledger does not cover its record. */
export const UNVERIFIED_MARK = 'record not yet verified';

export const isVerified = (r: Reference): boolean => r.tier !== null;

export const unverified = (): Reference[] => REFERENCES.filter((r) => !isVerified(r));
