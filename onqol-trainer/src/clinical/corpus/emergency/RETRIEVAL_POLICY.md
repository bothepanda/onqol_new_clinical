# Retrieval policy

## 1. Retrieval can help understand language

Allowed:
- recognize that "Rovsing", "Ровзинг" and natural-language variants refer to a clinical sign
- recognize abbreviations and procedure names
- connect "ERCP" with biliary decompression terminology
- understand RU/KZ wording by mapping it to language-neutral concepts
- retrieve background for content-author review

## 2. Retrieval cannot create patient facts

A retrieved source must never answer:
- Is Rovsing positive in this patient?
- What is this patient's CRP?
- Does this patient have perforation?
- Did the patient's blood pressure improve?

Those values come only from the active Case Card.

If the router recognizes a concept but the Case Card has no defined finding:
`recognized_but_undefined`

Do not guess.

## 3. Retrieval cannot score the learner

Scoring comes only from the validated case rubric.

RAG may help map:
"беру общий анализ, срб и бхг"
to structured concepts.

RAG must not decide whether that bundle deserves 7 or 10 points.

## 4. Authority hierarchy

When sources conflict:

1. Active validated Case Card
2. Validated Disease Card
3. Current disease-specific guideline approved for that Disease Card
4. Kazakhstan protocol overlay
5. General emergency-surgery corpus

The semantic router should not resolve a clinical conflict by itself.

Return a conflict flag for authoring/review:
`evidence_conflict_detected: true`

## 5. Mid-case behavior

Do not surface guideline teaching text during simulation unless the product explicitly enters a hint mode.

Normal simulation:
user text -> semantic router -> case concepts -> deterministic case engine -> patient findings

Debrief:
scoring result -> approved Disease Card teaching points -> evidence citations

## 6. Language

Corpus documents can remain in English.
RU and KZ user input is normalized by the semantic router to language-neutral concept IDs.

Do not translate and duplicate the whole evidence corpus for MVP.
Translate user-facing content, case data and feedback.
