## Focused Second Clinical Re-Review — TRJ-POSTOP-RECOVERY Clock Anchor

> Verbatim record of the independent reviewer's decision, filed for provenance.
> Received 2026-09-01. Acted on the same day: `TRJ-POSTOP-RECOVERY` promoted to
> `approved_for_training` (only that object). See
> `APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md` for the packet this decides
> and the governance action taken.

**Reviewer decision:** **APPROVE**

**Scope reviewed:** only the change of the postoperative recovery clock anchor from
`SOURCE_CONTROL_COMPLETED` to `PROCEDURE_COMPLETED`.

**Clinical assessment:**
`PROCEDURE_COMPLETED`, as defined in the current packet, is an appropriate
postoperative recovery anchor because it represents completion of the operative
procedure, including closure, sets the operative state to completed, and is
immediately followed by transfer to the recovery phase. This correctly separates
intraoperative source-control completion from the start of postoperative/anaesthetic
recovery.

The previous `SOURCE_CONTROL_COMPLETED` anchor was clinically inappropriate because
source control may occur before completion of surgical closure, completion of the
procedure, and transition toward anaesthetic emergence.

**Not re-reviewed:**
The 6–12 h and 12–24 h recovery windows, 50/50 variant weights, postoperative pain
states, recovery domains, bounded transition model, and discharge-readiness logic were
not re-reviewed because they were unchanged in this remediation.

**Governance condition:**
Until this focused re-review is formally recorded as approved, `TRJ-POSTOP-RECOVERY`
should remain `pending`, `runtime_status` should remain `development_only`, and the
APP-004 pilot should remain **NO-GO**.

**Final decision:** **APPROVE**

Reviewer: Sarina T.T.
Date: 01/09/2026
