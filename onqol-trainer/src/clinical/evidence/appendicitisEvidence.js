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
        "Use risk stratification scales such as AIR, AAS or PAS to triage patients with right iliac fossa pain; low-risk patients may avoid imaging, intermediate-risk patients need imaging or active observation.",
      strength: "conditional",
      certainty: "moderate",
      provenance: "T1",
      kz_protocol_status: "КП≠",
      local_note:
        "КП МЗ РК 2018 names Alvarado. V2 corpus treats AIR/AAS/PAS as current WSES tools and flags numeric cutoffs as not yet entered into source data.",
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
        "Give a single preoperative broad-spectrum antibiotic prophylaxis dose for uncomplicated adult appendicitis; do not give additional antibiotics while awaiting appendectomy within 24 hours.",
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
        "Do not use postoperative antibiotics in adults after appendectomy for uncomplicated appendicitis.",
      strength: "conditional",
      certainty: "low",
      provenance: "T1",
      kz_protocol_status: "КП=",
      local_note: "КП РК and WSES both reject postoperative antibiotics for uncomplicated adult appendicitis.",
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
