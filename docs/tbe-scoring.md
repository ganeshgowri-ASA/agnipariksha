# TBE Scoring — Rules & Guardrails
**Agnipariksha procurement | Technical-Bid Evaluation v1.0 | 2026-05-16**

> Authoritative scoring rules for evaluating vendor bids when procuring spare parts,
> test instruments, and chamber/PSU equipment used by the Agnipariksha test station
> (ref. PRD v2.0 §4 Reliability Analytics — spare parts inventory & maintenance).

---

## 1. Scope
Applies to every Technical-Bid Evaluation (TBE) produced by the Spares & Equipment
procurement workflow:
- Spare parts reorder (auto-triggered when `qty <= reorder_level`).
- New / replacement test equipment (ITECH PSU, thermal chamber, scanner, etc.).
- Calibration & service contracts longer than 6 months.

A TBE record MUST exist before any Purchase Order is issued. The TBE record is
the single source of truth for the award decision and is persisted under
`AuditLog` (see PRD v2.0 §2 Database).

---

## 2. Weighting Matrix

| # | Criterion   | Weight | Sub-criteria considered                                     |
|---|-------------|-------:|-------------------------------------------------------------|
| 1 | Price       |   40 % | Quoted price (landed, incl. taxes, freight, insurance).     |
| 2 | Lead Time   |   20 % | Calendar days from PO to delivery at Shreshtata dock.       |
| 3 | Quality     |   25 % | Vendor quality history, MTBF on similar parts, warranty.    |
| 4 | Compliance  |   15 % | IEC / safety certifications, regulatory & ESG declarations. |
|   | **Total**   |**100 %**|                                                            |

Weights are fixed at the policy level. Any change requires a signed amendment
from the Procurement Lead and is captured as a new `policy_version` in the
audit trail.

### 2.1 Scoring formulas (per criterion, 0–100 scale)

Each criterion is normalized to a 0–100 sub-score, multiplied by its weight,
and summed. Higher is better in every case.

```
price_score      = 100 × (P_min / P_bid)                       # lowest landed price wins
leadtime_score   = 100 × (L_min / L_bid)                       # shortest lead time wins
quality_score    = weighted average of (MTBF%, warranty%, NCR%)# see §2.2
compliance_score = 100 × (certs_satisfied / certs_required)    # binary per cert

total_score = 0.40·price_score + 0.20·leadtime_score
            + 0.25·quality_score + 0.15·compliance_score
```

`P_min` / `L_min` are the lowest qualifying price / lead time across **all
non-disqualified** bids in the same TBE round. Bids disqualified under §3 are
excluded from the min-set so they do not artificially inflate other vendors'
scores.

### 2.2 Quality sub-score breakdown
| Sub-criterion          | Sub-weight | Source                                  |
|------------------------|-----------:|-----------------------------------------|
| MTBF on similar part   |        40 %| `Equipment.mtbf_hours` history          |
| Warranty months        |        30 %| Bid document (capped at 60 months)      |
| Non-conformance rate   |        30 %| `MaintenanceTicket` history (12 months) |

Each sub-criterion is normalized to 0–100 against the field across the bid set,
then combined per the sub-weights.

---

## 3. Disqualification Rules (mandatory — bid scores 0 and is excluded)

A bid is **automatically disqualified** if **any** of the following is true.
DQ is binary; partial credit is not allowed.

| Code     | Rule                                                                                          |
|----------|-----------------------------------------------------------------------------------------------|
| DQ-DOC   | Mandatory documents missing (datasheet, ISO 9001 cert, MSDS where applicable).                |
| DQ-CERT  | Required IEC / safety certification absent for the item class (e.g. IEC 61730 for PV gear).   |
| DQ-FIN   | Vendor on the Procurement Black-List or under active financial sanction.                      |
| DQ-LEAD  | Quoted lead time > 2 × the median across qualifying bids (procurement-blocker).               |
| DQ-PRICE | Quoted landed price > 1.5 × the published budget ceiling for the line item.                   |
| DQ-WARR  | Warranty < 12 months on safety-critical components (PSU, ground-bond circuits).               |
| DQ-CONF  | Conflict of interest declared (vendor employs a Shreshtata staff member's first-degree relative) and not waived by the Procurement Committee. |
| DQ-DUP   | Duplicate bid from the same legal entity under a different trading name (collusion guard).    |

Each DQ MUST cite the rule code, the evidence (file hash or `AuditLog` ref),
and the reviewer's identity (operator id + timestamp).

---

## 4. Tie-Breaker

When two or more bids end within **±0.5 points** of the top score (after weighted
sum), the following cascade applies, in order, until the tie is broken:

1. **Lower landed price** — the bid with the lower `P_bid` wins.
2. **Shorter lead time** — the bid with the lower `L_bid` wins.
3. **Higher quality sub-score** — see §2.2.
4. **Higher compliance sub-score** — more certs satisfied beyond the mandatory set.
5. **Prior performance** — fewer open `MaintenanceTicket`s against the vendor in the last 12 months.
6. **Committee vote** — Procurement Committee (Procurement Lead + Quality Lead + Test Engineer Lead) cast one vote each; majority wins, ties broken by the Procurement Lead. Recorded in the audit trail with `tiebreak_step = "committee"`.

Each step that fires MUST be recorded on the TBE record as a `tie_break_log`
entry so that the reasoning is traceable.

---

## 5. Audit Trail

Every TBE round persists an immutable audit record. Required fields:

| Field             | Description                                                          |
|-------------------|----------------------------------------------------------------------|
| `tbe_id`          | UUID, also surfaced in the PO and printed on the QR label.           |
| `policy_version`  | Semver of the weight/DQ policy in force at evaluation time.          |
| `opened_at`       | ISO-8601 UTC timestamp of bid-window open.                           |
| `closed_at`       | ISO-8601 UTC timestamp of bid-window close (no further edits).       |
| `evaluator_id`    | Operator id of the engineer that ran the scoring tool.               |
| `reviewer_ids`    | Procurement Committee members who signed off.                        |
| `bids[]`          | Array of bid records (see schema §6).                                |
| `min_price_used`  | `P_min` snapshot used for normalization.                             |
| `min_lead_used`   | `L_min` snapshot used for normalization.                             |
| `disqualified[]`  | List of `{bid_id, rule_code, evidence_ref, reviewer_id, at}`.        |
| `tie_break_log[]` | Cascade entries with the rule that fired.                            |
| `winning_bid_id`  | UUID of the awarded bid.                                             |
| `decision_hash`   | SHA-256 of the canonicalised JSON record; written to `AuditLog`.     |

### 5.1 Immutability & retention
- The TBE record is written once; corrections create a new versioned record
  with `supersedes = <prior_tbe_id>` and a written justification.
- Retention: **7 years** (aligned with statutory tender-record retention).
- Backups follow the nightly `pg_dump` policy (PRD v2.0 §2), 14-day on-site
  rolling + quarterly off-site archive.

### 5.2 Access control
- Read: Procurement, Quality, Finance, Internal Audit.
- Write: Procurement evaluator (during the open window) only.
- Lock: Procurement Lead seals the record at `closed_at`; thereafter only
  Internal Audit may add annotations (no field edits).

---

## 6. Schema reference

The machine-readable contract for a TBE record lives at
[`docs/schemas/tbe-score.schema.json`](./schemas/tbe-score.schema.json)
(JSON Schema Draft 2020-12). All TBE producers and consumers MUST validate
against this schema before persistence or display.

---

## 7. Worked Example

Three bids for spare-part `SP-PSU-FAN-120MM` (budget ceiling ₹4,000, lead-time
median 14 days):

| Vendor | Price ₹ | Lead (d) | MTBF h | Warranty m | NCR % | Certs |
|--------|--------:|---------:|-------:|-----------:|------:|------:|
| Alpha  | 3,200   | 10       | 60 000 | 24         | 1.2   | 4/4   |
| Beta   | 3,500   | 14       | 80 000 | 36         | 0.8   | 4/4   |
| Gamma  | 2,950   | 30       | 40 000 | 12         | 3.5   | 3/4   |

Gamma is **disqualified** (`DQ-LEAD`, lead > 2× median = 28 d). Min set is
{Alpha, Beta}, `P_min = 3,200`, `L_min = 10`.

| Vendor | Price | Lead | Quality | Compliance | Total |
|--------|------:|-----:|--------:|-----------:|------:|
| Alpha  |100.00 |100.00| 73.50   | 100.00     | **93.4** |
| Beta   | 91.43 | 71.43| 91.00   | 100.00     | **86.9** |

Award: **Alpha**. Tie-breaker not invoked (gap > 0.5 pts).

---

## 8. References
- PRD v2.0 §2 Database — `AuditLog` model.
- PRD v2.0 §4 Reliability Analytics — spare parts inventory & MTBF.
- PRD v2.0 §5 Ticketing — `MaintenanceTicket` history feeds NCR sub-score.
- IEC 61730-2 — safety certification used by `DQ-CERT` for PV-side hardware.
- ISO 9001:2015 — vendor quality management baseline used by `DQ-DOC`.
