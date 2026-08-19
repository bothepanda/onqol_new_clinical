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
        "Imaging choice in an adult with suspected appendicitis follows the clinical probability of the diagnosis, the diagnostic question, patient factors and availability. Ultrasound is acceptable first-line where CT is unavailable or radiation minimization is prioritized. If ultrasound is inconclusive and clinical suspicion persists, perform low-dose CT where it is available and appropriate for that patient. Where CT is unavailable, the next step follows risk and may be active observation with reassessment, transfer, or an operative decision.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T2",
      kz_protocol_status: "КП=",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      companion_reference_ids: [
        "wses-2025-rec-3-3",
        "wses-2025-rec-3-4",
        "wses-2025-rec-4",
      ],
      local_note:
        "КП РК also uses resource language around availability of imaging and endovideosurgical equipment. Two corrections from clinical review 19.08.2026: 'inconclusive ultrasound therefore CT' is not unconditional - pregnancy and CT unavailability are separate branches, held in the companion entries - and no fixed effective dose in millisieverts reaches the learner, because the dose belongs to the local radiology protocol rather than to a clinical threshold.",
    },
    {
      // Special populations were previously folded into R3.1, which made the
      // adult imaging rule read as ultrasound-first for everyone.
      id: "wses-2025-rec-3-3",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 3.3",
      recommendation:
        "In adults with obesity (BMI 30 or above), CT, preferably low-dose, is the preferred first-line imaging modality over ultrasound where it is available.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T2",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note: "Carries the obesity branch of the imaging rule. Not a licence to skip ultrasound in anyone else.",
    },
    {
      id: "wses-2025-rec-3-4",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 3.4",
      recommendation:
        "In older adults (65 years and above), CT, preferably low-dose, is the preferred first-line imaging modality over ultrasound where it is available.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T2",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note: "Carries the older-adult branch of the imaging rule.",
    },
    {
      id: "wses-2025-rec-4",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 4",
      recommendation:
        "In pregnancy, where ultrasound is negative or inconclusive and suspicion persists, MRI is preferred, provided it does not cause a clinically significant delay in diagnosis or treatment.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T2",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note:
        "The pregnancy branch of the imaging rule. The delay proviso is part of the recommendation: MRI that is not promptly obtainable is not a reason to defer treatment.",
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
        "After laparoscopic appendectomy for confirmed uncomplicated acute appendicitis, WSES suggests against giving postoperative antibiotics routinely. Conditional recommendation, low certainty: a clinically justified deviation is permitted and this is never a safety stop. If intraoperative or postoperative findings indicate complicated infection, the patient moves to the complicated pathway and this recommendation no longer applies to them.",
      strength: "conditional",
      certainty: "low",
      provenance: "T1",
      kz_protocol_status: "КП=",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note:
        "КП РК and WSES both argue against routine postoperative antibiotics for uncomplicated adult appendicitis. Wording chosen at clinical review 19.08.2026: 'usually not recommended' blurred which way the recommendation points, and 'must not be given' read as an absolute ban on a conditional, low-certainty recommendation. 'WSES suggests against giving them routinely' keeps both the direction and the conditionality.",
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
        "Antibiotic therapy may be offered as an alternative to appendectomy in a carefully selected, haemodynamically stable adult with radiologically confirmed uncomplicated appendicitis and no appendicolith, within shared decision-making. Reliable monitoring, rapid reassessment and access to surgery on failure, deterioration or recurrence are mandatory. The patient has to be told that initial success of antibiotic therapy does not exclude recurrence and a later appendectomy.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП?",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      recurrence_context_ids: ["appac-2018-five-year", "appac-2026-ten-year"],
      local_note:
        "A nonoperative plan is never wrong merely for being nonoperative. Where the selection facts are not established in the case, the plan cannot yet be judged and the missing condition is what the mentor asks for. Clinical review 19.08.2026 added two selection facts that were previously implicit: radiological confirmation and absence of an appendicolith, the latter because the APPAC population excluded it. The counselling duty about later appendectomy is part of the rule, not an optional extra.",
    },
    {
      // Reviewer-facing only. Two endpoints, not one, and the earlier version of
      // this entry collapsed them: it called the cumulative appendectomy rate
      // "recurrence", which overstates histologically confirmed recurrence and
      // understates how many patients reached an operation. Clinical review
      // 19.08.2026 (Сарина Т.Т.) required them separated wherever they appear.
      //
      // Both APPAC entries are one cohort at successive horizons. The ten-year
      // publication ADDS to the five-year one; it does not supersede it, and
      // neither may be quoted without its horizon and its population.
      id: "appac-2018-five-year",
      name: "APPAC randomized clinical trial, five-year follow-up",
      year: 2018,
      citation:
        "Salminen P, Tuominen R, Paajanen H, et al. Five-Year Follow-up of Antibiotic Therapy for Uncomplicated Acute Appendicitis in the APPAC Randomized Clinical Trial. JAMA. 2018;320(12):1259-1265. DOI 10.1001/jama.2018.13201. PMID 30264120.",
      section: "Appendectomy and recurrence after antibiotic therapy",
      recommendation:
        "After initial antibiotic therapy in APPAC, 27.3% (95% CI 22.0-33.2; 70/256) underwent appendectomy within the first year, and the cumulative incidence of appendicitis recurrence was 39.1% (95% CI 33.1-45.3; 100/256) at 5 years.",
      strength: "primary study",
      certainty: "single trial population",
      provenance: "T1",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.; independently re-checked against the PubMed record 2026-08-19",
      local_note:
        "Reviewer context, not learner content. Verified against the source abstract 2026-08-19: the 39.1% is what THIS paper calls cumulative incidence of appendicitis recurrence, and the 27.3% is appendectomy within the first year - the two are not the same endpoint and neither is interchangeable with the ten-year figures, which add histopathological confirmation. A separate 32.4% five-year figure circulated during review and is NOT in this source; it is deliberately not recorded. Study population: 530 adults 18-60 with CT-confirmed uncomplicated appendicitis at six Finnish hospitals, 257 randomised to antibiotics; patients with an appendicolith were not included.",
      learner_visible: false,
    },
    {
      id: "appac-2026-ten-year",
      name: "APPAC randomized clinical trial, ten-year follow-up",
      year: 2026,
      citation:
        "Salminen P, Salminen R, Kallio J, et al. Antibiotic Therapy for Uncomplicated Acute Appendicitis: Ten-Year Follow-Up of the APPAC Randomized Clinical Trial. JAMA. 2026;335(12):1041-1049. DOI 10.1001/jama.2025.25921. PMID 41563747.",
      section: "Appendectomy and recurrence at ten years",
      recommendation:
        "At ten years, true appendicitis recurrence confirmed at histopathology was 37.8% (95% CI 31.6-44.1; 87/230) and the cumulative appendectomy rate was 44.3% (95% CI 38.2-50.4; 112/253).",
      strength: "primary study",
      certainty: "single trial population",
      provenance: "T1",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.; independently re-checked against the PubMed record 2026-08-19",
      local_note:
        "Verified against the source abstract 2026-08-19. 37.8% does not replace the 39.1% of the five-year report: this paper reports true recurrence CONFIRMED AT HISTOPATHOLOGY, while the five-year paper reports cumulative incidence of recurrence without that requirement. Different definitions, so the two are not a trend line. The endpoint that is directly comparable across the two horizons is the operation itself. Extends the five-year entry rather than superseding it; same selected population, so the figures are not a universal prognosis for an individual patient.",
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
      // B1. Written to close a reading, not to add a drug: "prophylaxis PLUS
      // therapy" was being understood as two mandatory parallel courses.
      id: "wses-2025-rec-16-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 16.1",
      recommendation:
        "In an adult with complicated acute appendicitis, start therapeutic antibiotic treatment before surgery, particularly where immediate operation is not possible. The chosen therapeutic regimen has to provide the required perioperative cover according to the local protocol.",
      strength: "strong",
      certainty: "high",
      provenance: "T1",
      kz_protocol_status: "КП?",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note:
        "Prophylactic and therapeutic intent differ, but that does not mean two parallel courses or duplicated agents are automatically required. Whether a separate perioperative dose is needed, which regimen, when it is given and when it is redosed are decided by the approved hospital protocol.",
    },
    {
      // B4. The Russian rendering matters here: "дренирование не предлагается"
      // can be read as "no recommendation exists", which is the opposite of a
      // conditional recommendation against routine drainage.
      id: "wses-2025-rec-11-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 11.1",
      recommendation:
        "In adults after laparoscopic appendectomy for complicated appendicitis, avoiding routine prophylactic abdominal drainage is suggested. Conditional recommendation, low certainty.",
      strength: "conditional",
      certainty: "low",
      provenance: "T1",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      corroborating_reference_ids: ["sages-appendicitis"],
      local_note:
        "The rule is about ROUTINE placement. It does not forbid a drain placed for a specific established indication, and the presence of a drain is not a critical error without assessing the intraoperative situation and the indication.",
    },
    {
      // B5. Kept as one entry with the disagreement inside it, so the mentor
      // cannot quote the WSES preference without the SAGES position.
      id: "wses-2025-rec-10-1",
      name: "WSES Jerusalem Guidelines",
      year: 2025,
      citation:
        "Podda M, Ceresoli M, De Simone B, et al. Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the WSES Jerusalem Guidelines. JAMA Surg. 2026;161(3):283-295.",
      section: "Recommendation 10.1",
      recommendation:
        "In complicated appendicitis, free contaminated fluid has to be evacuated. WSES suggests suction without routine lavage rather than lavage combined with suction. SAGES holds both suction alone and suction with lavage to be acceptable, depending on the intraoperative situation and surgeon preference.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      guideline_disagreement: true,
      corroborating_reference_ids: ["sages-appendicitis"],
      local_note:
        "The guidelines do not agree here, so this is teaching material and not a binary right/wrong action. Performing lavage must never be coded as an error, a safety stop or a penalty. What is assessed is adequacy of source control and removal of the accessible contaminated material.",
    },
    {
      id: "sages-appendicitis",
      name: "SAGES Guideline for the Diagnosis and Treatment of Appendicitis",
      year: 2025,
      citation:
        "Society of American Gastrointestinal and Endoscopic Surgeons. Guideline for the Diagnosis and Treatment of Appendicitis. https://www.sages.org/publications/guidelines/guideline-for-the-diagnosis-and-treatment-of-appendicitis/",
      section: "Intraoperative management of complicated appendicitis",
      recommendation:
        "SAGES recommends against routine drainage after appendectomy for complicated appendicitis, and accepts either suction alone or suction with lavage for peritoneal contamination, noting very low certainty of evidence in adults.",
      strength: "guideline",
      certainty: "very low",
      provenance: "T2",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note:
        "Independent check on the two contested intraoperative rules: it corroborates B4 and it diverges from B5. Held so the divergence can be shown to the learner rather than hidden.",
    },
    {
      id: "perfect-antibiotics-2025",
      name: "PERFECT-Antibiotics randomized clinical trial",
      year: 2025,
      citation:
        "Role of Preoperative Antibiotic Treatment While Awaiting Appendectomy: The PERFECT-Antibiotics Randomized Clinical Trial. JAMA Surg. 2025. DOI 10.1001/jamasurg.2025.1212.",
      section: "Antibiotics while awaiting appendectomy",
      recommendation:
        "In adults with suspected uncomplicated appendicitis operated within 24 hours, adding a therapeutic antibiotic course while awaiting appendectomy did not significantly reduce perforation. Surgical site infection was reported in 1.6% with the added antibiotics and 3.2% without. All patients received the standard single prophylactic dose at induction.",
      strength: "primary study",
      certainty: "single trial population",
      provenance: "T1",
      kz_protocol_status: "n/a",
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      local_note:
        "Supporting evidence for A4 and A5, never the sole basis of either rule. The secondary surgical-site-infection result travels with the primary one: quoting only the perforation finding overstates how settled the question is.",
      learner_visible: false,
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
      last_checked: "2026-08-19",
      checked_by: "Сарина Т.Т.",
      normative_status: "requires_separate_confirmation",
      local_note:
        "Used only to support the resource-context route, not to override WSES clinical source of truth. Verified 19.08.2026: the official text and its imprint were checked against the RCRZ PDF. That check does NOT establish that the protocol remains the operative normative document on that date; current normative status still requires separate confirmation from the official register or a decision of the authorised body. Divergences are carried as an explicit Kazakhstan delta layer, never as a replacement for the current international evidence layer.",
    },
  ],
};
