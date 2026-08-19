export const appendicitisEvidence = {
  references: [
    {
      id: "wses-2025-rec-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 1",
      recommendation:
        "Use risk stratification scales to triage patients with right iliac fossa pain: AIR or AAS in adults, PAS in children. Low-risk patients may avoid imaging; intermediate-risk patients need imaging or active observation.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП≠",
      local_note:
        "КП МЗ РК 2018 names Alvarado. The guideline names AIR, AAS and PAS; the adult vertical slice may name only AIR and AAS, because PAS is a paediatric score. Numeric cutoffs are not entered into source data and are neither displayed nor scored.",
    },
    {
      id: "wses-2025-rec-3-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 3.1",
      recommendation:
        "Risk stratification plus ultrasound is an acceptable first-line pathway where CT is unavailable or radiation minimization is prioritized; low-dose CT is preferred where available.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T2",
      kz_protocol_status: "КП=",
      local_note:
        "КП РК also uses resource language around availability of imaging and endovideosurgical equipment.",
    },
    {
      id: "wses-2025-rec-9-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 9.1",
      recommendation:
        "Perform laparoscopic appendectomy within 24 hours of hospital admission for adults with uncomplicated acute appendicitis selected for surgery.",
      strength: "strong",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП−",
      local_note:
        "КП РК says emergency operation but does not express a separate 24-hour ceiling in the same way.",
    },
    {
      id: "wses-2025-rec-15-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 15.1",
      recommendation:
        "Give one appropriate preoperative prophylactic antibiotic dose for an adult undergoing appendectomy for uncomplicated appendicitis, according to the local approved protocol; do not add a treatment course merely for waiting when appendectomy is performed within 24 hours.",
      strength: "strong",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП≠",
      local_note:
        "v0.2 source marks this as direct_conflict_or_scope_mismatch: КП МЗ РК 2018 addresses 12/24-hour observation in diagnostically uncertain intermediate-risk patients, while WSES R15.1 addresses confirmed uncomplicated appendicitis selected for appendectomy.",
    },
    {
      id: "wses-2025-rec-17-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 17.1",
      recommendation:
        "Routine postoperative antibiotics are usually not recommended in adults after appendectomy for uncomplicated appendicitis. Conditional recommendation, low certainty: a clinically justified deviation is permitted and this is never a safety stop.",
      strength: "conditional",
      certainty: "low",
      provenance: "T1",
      kz_protocol_status: "КП=",
      local_note: "КП РК and WSES both reject postoperative antibiotics for uncomplicated adult appendicitis.",
    },
    {
      // The nonoperative option and, more importantly, the conditions under
      // which it is an option at all. Kept as one entry so a mentor cannot
      // quote the permission without quoting the selection criteria.
      id: "wses-2025-rec-5-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 5.1",
      recommendation:
        "Antibiotic therapy is an acceptable alternative to appendectomy in selected adults with confirmed uncomplicated appendicitis, given adequate clinical monitoring, access to reassessment and rescue surgery, and shared decision-making. Appendicolith status and the possibility of misclassified complicated disease have to be considered.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП?",
      local_note:
        "A nonoperative plan is never wrong merely for being nonoperative. Where the selection facts are not established in the case, the plan cannot yet be judged and the missing condition is what the mentor asks for.",
    },
    {
      // Reviewer-facing only. Recurrence figures always travel with their time
      // horizon and their study population; no percentage reaches a learner
      // until a rule carrying it has completed the approval workflow.
      id: "appac-2018-recurrence",
      name: "APPAC randomized clinical trial, five-year follow-up",
      year: 2018,
      citation:
        "Salminen P, Tuominen R, Paajanen H, et al. Five-Year Follow-up of Antibiotic Therapy for Uncomplicated Acute Appendicitis in the APPAC Randomized Clinical Trial. JAMA. 2018;320(12):1259-1265. DOI 10.1001/jama.2018.13201.",
      section: "Recurrence after antibiotic therapy",
      recommendation:
        "In the APPAC trial population, recurrence after antibiotic therapy was 27.3% at 1 year and 39.1% at 5 years.",
      strength: "primary study",
      certainty: "single trial population",
      provenance: "T1",
      kz_protocol_status: "n/a",
      local_note:
        "Reviewer context, not learner content. These figures describe one trial population and must never be quoted without the time horizon and the population limitation.",
      learner_visible: false,
    },
    {
      // Why a pregnancy test is expected. WSES recommendation 1 is about risk
      // stratification and does not carry this obligation on its own.
      id: "acep-pregnancy-test-abdominal-pain",
      name: "ACEP quality measure: pregnancy test for female abdominal pain",
      year: 2019,
      citation:
        "American College of Emergency Physicians. Pregnancy test for female abdominal pain patients. CEDR quality measure, 2019.",
      section: "Reproductive safety",
      recommendation:
        "Establish pregnancy status in a female patient of reproductive age presenting with abdominal pain, before imaging and before operative decisions.",
      strength: "quality measure",
      certainty: "not GRADE",
      provenance: "T2",
      kz_protocol_status: "n/a",
      local_note:
        "Supports the pregnancy-status obligation only. It does not make pelvic ultrasound, pelvic examination or gynaecology consultation automatically expected.",
    },
    {
      id: "acr-pelvic-pain-reproductive-age",
      name: "ACR Appropriateness Criteria: Acute Pelvic Pain in the Reproductive Age Group",
      year: 2023,
      citation:
        "American College of Radiology. ACR Appropriateness Criteria: Acute Pelvic Pain in the Reproductive Age Group.",
      section: "Imaging selection",
      recommendation:
        "Pelvic imaging selection depends on pregnancy status and on the clinical question, not on reproductive age alone.",
      strength: "appropriateness criteria",
      certainty: "not GRADE",
      provenance: "T2",
      kz_protocol_status: "n/a",
      local_note:
        "Basis for treating pelvic ultrasound and gynaecologic assessment as conditional on findings rather than as an automatic obligation for every woman of reproductive age.",
    },
    {
      // Supports one negative claim and nothing more: routine DRE does not rule
      // appendicitis in or out. It authorises no positive patient finding.
      id: "takada-2015-dre",
      name: "Digital rectal examination for appendicitis: systematic review and meta-analysis",
      year: 2015,
      citation:
        "Takada T, Nishiwaki H, Yamamoto Y, et al. The Role of Digital Rectal Examination for Diagnosis of Acute Appendicitis: A Systematic Review and Meta-Analysis. PLoS One. 2015;10(9):e0136996. PMID 26332867. DOI 10.1371/journal.pone.0136996.",
      section: "Diagnostic performance",
      recommendation:
        "Routine digital rectal examination has poor overall diagnostic performance for acute appendicitis and cannot rule the diagnosis in or out. In the limited pelvic-appendicitis subgroup, sensitivity was approximately 0.38 and specificity was not established.",
      strength: "systematic review",
      certainty: "low",
      provenance: "T1",
      kz_protocol_status: "n/a",
      local_note:
        "Justifies keeping DRE out of expected actions and out of scoring. It does not support a deterministic positive rectal finding in any phenotype.",
    },
    {
      id: "rk-appendicitis-2018-resource",
      name: "КП МЗ РК: Острый аппендицит",
      year: 2018,
      citation:
        "Клинический протокол МЗ РК 'Острый аппендицит', одобрен ОКК 04.03.2019, протокол N61.",
      section: "Resource-dependent operative access",
      recommendation:
        "If endovideosurgical equipment is unavailable and acute appendicitis cannot be clearly excluded, the issue is resolved in favor of emergency operation.",
      strength: "local protocol",
      certainty: "not GRADE",
      provenance: "T2",
      kz_protocol_status: "КП=",
      local_note:
        "Used only to support the resource-context route, not to override WSES clinical source of truth.",
    },
  ],
};
