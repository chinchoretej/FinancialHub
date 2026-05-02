# FinancialHub - Cloud Functions backend (Loan engine)

Senior-engineer pass over the home-loan tab. The Cloud Functions in this
package own the **calculation engine**, the **disbursement / builder-stage /
builder-payment lifecycle**, and the **aggregate fields** the dashboard reads.

> Region: `asia-south1` (Mumbai)
> Runtime: Node 20, Firebase Functions v2 (callables)
> Project: `financialhub-214f7`

---

## 1 - Why a backend pass at all?

Until now the loan tab calculated EMI, Pre-EMI and outstanding amounts on
the client. That works for a single user device but breaks the moment we
have:

- two clients (web + Android) writing the same fields
- partial disbursements that need to update the loan aggregate atomically
- builder demands paid in slices (must update stage status correctly)
- a hard requirement that **every disbursement and builder payment carries
  a unique UTR** for audit

The new design moves the *write path* for those flows into Cloud Functions
that wrap each operation in a Firestore transaction. Reads stay direct
from the clients - they're cheap and the persisted aggregates are kept
in sync by the functions.

---

## 2 - Firestore schema

```
/loans/{loanId}                       (existing collection - extended)
  bankName              string
  loanAccountNumber     string
  sanctionAmount        number  (positive)
  interestRate          number  (annual %, e.g. 8.5)
  tenureYears           number  (preferred)
  tenureMonths          number  (or this; functions accept either)
  startDate             Timestamp

  // ---- Repayment configuration (May 2026 amortization rewrite) -----------
  // Defaults applied automatically on first disbursement if missing.
  repaymentType         "PRE_EMI" | "FULL_EMI"           (default "FULL_EMI")
  emiAdjustmentType     "RECALCULATE_EMI" |
                        "KEEP_EMI_EXTEND_TENURE"          (default "RECALCULATE_EMI")
  fixedEmi              number  (only when emiAdjustmentType =
                        KEEP_EMI_EXTEND_TENURE; pinned EMI to honour)

  // Aggregates - written ONLY by Cloud Functions. Mirrors of the legacy
  // field names are kept so the existing UI keeps reading the same keys.
  disbursedAmount       number   (= sum of disbursements.amount)
  totalDisbursed        number   (legacy mirror)
  totalLoanOutstanding  number   (= sanctionAmount - disbursedAmount)
  remainingAmount       number   (legacy mirror)
  disbursementPercentage number  (= disbursedAmount / sanctionAmount * 100)
  emi                   number   (full-amortising; reducing-balance EMI on
                                  disbursedAmount with currentTenureMonths)
  emiAmount             number   (legacy mirror)
  preEmi                number   (interest-only on disbursedAmount)
  preEmiAmount          number   (legacy mirror)
  monthlyPayment        number   (= preEmi if PRE_EMI, else emi)
  currentTenureMonths   number   (active tenure after extensions; falls
                                  back to tenureMonths for fresh loans)
  isFullyDisbursed      boolean

  createdAt, updatedAt  Timestamp

/disbursements/{disbursementId}       (NEW)
  loanId                string
  amount                number  (>0, cumulative <= sanctionAmount)
  disbursementDate      Timestamp
  utrNumber             string  (uppercase alphanumeric, unique globally)
  stageId               string|null  (optional link to a builder stage)
  remarks               string  (<=500 chars)
  createdAt, createdBy

/builderStages/{stageId}              (NEW)
  loanId                string|null
  stageName             string  (unique within a loan)
  percentage            number  (0..100; sum across stages <= 100)
  agreementValue        number  (snapshot at creation)
  expectedAmount        number  (= agreementValue * percentage / 100)
  order                 number
  totalPaid             number  (aggregate)
  totalGstPaid          number  (aggregate)
  remainingAmount       number  (= expectedAmount - totalPaid)
  status                "pending" | "partial" | "paid"
  createdAt, updatedAt, createdBy

/builderPayments/{paymentId}          (NEW)
  stageId               string
  loanId                string|null    (denormalised for queries)
  amount                number  (>0)
  gstAmount             number  (>=0)
  totalAmount           number  (= amount + gstAmount)
  paidBy                "self" | "bank"
  paymentDate           Timestamp
  utrNumber             string  (unique)
  notes                 string  (<=500)
  createdAt, createdBy

/utrIndex/{utrNumber}                 (NEW - uniqueness ledger)
  type                  "disbursement" | "builderPayment"
  refId                 string  (id of the doc that owns this UTR)
  loanId | stageId      string
  amount                number
  createdAt, createdBy

/projectMeta/{loanId}                 (NEW - optional project-wide info)
  agreementValue        number  (default source for stage percentages)
  builderName           string
  ...
```

**Legacy collections** (`demands`, `payments`, `flatCost`, `expenses`,
`bills`, `investments`, ...) are untouched. The Loan UI continues to read
them while the new write path is rolled in incrementally.

---

## 3 - Calculation engine (`functions/src/lib/loan-math.ts`)

Pure functions, no Firebase imports - trivially unit-testable.

**EMI is computed against `disbursedAmount`, not `sanctionAmount`.** This
matches how Indian banks bill on under-construction property: each
disbursement bumps the principal that the EMI is amortising. The previous
implementation treated EMI as a constant computed off the full sanction;
the May 2026 rewrite fixes that.

| Field                    | Formula                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `disbursementPercentage` | `disbursed / sanction * 100`                                       |
| `totalLoanOutstanding`   | `sanction - disbursed`                                             |
| `preEmi`                 | `disbursed * rate / (12 * 100)`                                    |
| `emi` (FULL_EMI)         | `P * r * (1+r)^n / ((1+r)^n - 1)`, **P = disbursedAmount**         |
| `monthlyPayment`         | `preEmi` if `repaymentType==PRE_EMI`, else `emi`                   |
| `currentTenureMonths`    | from `tenureMonths`, or re-solved if KEEP_EMI_EXTEND_TENURE        |
| `totalInterest`          | `emi * n - principal`                                              |
| `totalPayable`           | `emi * n`                                                          |
| `isFullyDisbursed`       | `disbursed >= sanction && sanction > 0`                            |

### 3.1 Repayment type

| `repaymentType` | Monthly outflow                                                 | Schedule shape                           |
| --------------- | --------------------------------------------------------------- | ---------------------------------------- |
| `FULL_EMI`      | Full reducing-balance EMI on `disbursedAmount`                  | principal reduces each month             |
| `PRE_EMI`       | Interest-only `= disbursed * r` (construction-phase billing)    | principal stays flat at `disbursedAmount` |

### 3.2 EMI adjustment on a new disbursement

| `emiAdjustmentType`         | Behaviour on `addDisbursement`                                                  |
| --------------------------- | ------------------------------------------------------------------------------- |
| `RECALCULATE_EMI` (default) | Keep the original tenure, raise EMI to amortise the new disbursed total.        |
| `KEEP_EMI_EXTEND_TENURE`    | Pin EMI (`fixedEmi`), re-solve `currentTenureMonths` for the new principal.     |

When `KEEP_EMI_EXTEND_TENURE` is in effect we re-solve the tenure with:

```
n = ln(EMI / (EMI - P*r)) / ln(1 + r)
```

If `EMI <= P*r` the new principal can never be amortised at the given rate -
`addDisbursement` rejects with `invalid-argument` and asks the caller to
either bump the EMI or switch to `RECALCULATE_EMI`.

### 3.3 Amortization schedule

`generateAmortizationSchedule(snapshot)` returns one row per month:

```
month, openingBalance, emi, interestComponent, principalComponent,
closingBalance, cumulativeInterest, cumulativePrincipal
```

For FULL_EMI, the last row pays off the residual balance exactly so the
schedule closes at 0 (absorbing rounding drift). For PRE_EMI, every row
shows `principalComponent = 0` and `closingBalance = principal`.

### 3.4 Validation rules (per spec section 7)

- `EMI > interestComponent` for every FULL_EMI row (always true for `r > 0,
  n > 0` so this is a structural invariant rather than a runtime check).
- `KEEP_EMI_EXTEND_TENURE` rejects when EMI cannot amortise the new
  principal (`EMI <= P*r`).
- `closingBalance` is clamped to `>= 0` per row to prevent negative drift.
- All money outputs run through `round2()` (2 dp).

Edge cases:
- 0 % loans (`r = 0`) take the linear-amortisation branch (`P / n`).
- Any non-finite / non-positive input returns `0` rather than `NaN`.
- Schedule with `disbursedAmount = 0` returns `{ rows: [] }`.

---

## 4 - Callable functions

Each function:

1. Calls `requireAllowedCaller(req)` — rejects unauthenticated requests
   with `unauthenticated`, and rejects emails outside the allow-list with
   `permission-denied`.
2. Validates the input — rejects with `invalid-argument` and a `details`
   payload describing what was wrong.
3. Runs reads + writes inside `db.runTransaction` so partial failures
   roll back.

| Function                          | Verb   | Effect                                                                          |
| --------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `calculateLoanDetails`            | read   | EMI / Pre-EMI / outstanding for a stored loan or "what-if" override             |
| `getLoanSummary`                  | read   | One round-trip dashboard payload (loan + disbursements + stages + builder totals) |
| `generateAmortizationSchedule`    | read   | Full month-by-month schedule + chart-ready `graph` array                        |
| `calculateMonthlyBreakdown`       | read   | Schedule shaped for charting libs: `{labels, interest[], principal[], balance[]}` plus yearly buckets |
| `addDisbursement` / `applyDisbursement` | write | Atomically appends a disbursement, claims its UTR, recomputes aggregates per `repaymentType` + `emiAdjustmentType` |
| `addBuilderStage`                 | write  | Creates a stage; checks sum-of-percentages ≤ 100 and unique name                |
| `addBuilderPayment`               | write  | Appends payment, claims UTR, updates stage totals + status                      |
| `recomputeLoanAggregates`         | write  | Repair tool: rebuilds `loans.*` and stage aggregates from source docs           |

> `applyDisbursement` is a spec-compatible alias for `addDisbursement` -
> same handler, same behaviour. New integrations may use either name.

Errors surface as standard `HttpsError` codes:

```
unauthenticated      no Firebase ID token
permission-denied    email not in allow-list
invalid-argument     bad amount, missing UTR, bad date, ...
already-exists       duplicate UTR, duplicate stage name
not-found            loanId / stageId doesn't exist
```

---

## 5 - Sample requests & responses

All examples assume the client SDK has signed the user in and the
Firebase callable wrapper has injected the auth header.

### 5.1  `calculateLoanDetails`

Request:

```json
{
  "loanId": "loan_42",
  "overrides": { "disbursedAmount": 2500000 }
}
```

Response:

```json
{
  "input": {
    "sanctionAmount": 5000000,
    "disbursedAmount": 2500000,
    "interestRate": 8.5,
    "tenureMonths": 360,
    "currentTenureMonths": 360,
    "repaymentType": "FULL_EMI",
    "emiAdjustmentType": "RECALCULATE_EMI"
  },
  "computed": {
    "disbursementPercentage": 50,
    "totalLoanOutstanding": 2500000,
    "isFullyDisbursed": false,
    "preEmi": 17708.33,
    "emi": 19222.96,
    "monthlyPayment": 19222.96,
    "currentTenureMonths": 360,
    "totalInterest": 4420226.96,
    "totalPayable": 6920226.96,
    "repaymentType": "FULL_EMI",
    "emiAdjustmentType": "RECALCULATE_EMI"
  }
}
```

Note: `emi` is now computed on the disbursed amount (25L) not the sanction
(50L), so the value is half of what the legacy formula returned.

### 5.2  `generateAmortizationSchedule`

Request:

```json
{ "loanId": "loan_42", "startDate": "2026-05-01" }
```

Response (truncated):

```json
{
  "input": { "...same shape as calculateLoanDetails.input..." },
  "computed": { "...same shape..." },
  "schedule": {
    "rows": [
      {
        "month": 1,
        "monthLabel": "2026-05",
        "openingBalance": 2500000,
        "emi": 19222.96,
        "interestComponent": 17708.33,
        "principalComponent": 1514.63,
        "closingBalance": 2498485.37,
        "cumulativeInterest": 17708.33,
        "cumulativePrincipal": 1514.63
      }
    ],
    "summary": {
      "repaymentType": "FULL_EMI",
      "principal": 2500000,
      "interestRate": 8.5,
      "tenureMonths": 360,
      "monthlyPayment": 19222.96,
      "totalInterest": 4420226.96,
      "totalPayable": 6920226.96,
      "finalBalance": 0
    },
    "graph": [
      { "month": 1, "interest": 17708.33, "principal": 1514.63, "balance": 2498485.37 }
    ]
  }
}
```

### 5.3  `calculateMonthlyBreakdown`

Request:

```json
{ "loanId": "loan_42" }
```

Response (truncated):

```json
{
  "computed": { "...same shape..." },
  "summary":  { "...same as schedule.summary..." },
  "monthly": {
    "labels":    ["M1", "M2", "M3", "..."],
    "interest":  [17708.33, 17697.61, 17686.81, "..."],
    "principal": [1514.63, 1525.35, 1536.15, "..."],
    "balance":   [2498485.37, 2496960.02, 2495423.87, "..."]
  },
  "yearly": [
    {
      "year": 1,
      "interest": 211324.39,
      "principal": 19351.15,
      "payment": 230675.54,
      "closingBalance": 2480648.85
    }
  ],
  "rows": [ "...full AmortizationRow[] array..." ]
}
```

### 5.4  `addDisbursement` / `applyDisbursement`

Request:

```json
{
  "loanId": "loan_42",
  "amount": 1000000,
  "disbursementDate": "2026-04-15",
  "utrNumber": "HDFCN12345678901",
  "stageId": "stage_slab",
  "remarks": "Slab milestone disbursement"
}
```

Response:

```json
{
  "disbursementId": "dsb_abc123",
  "loanAggregates": {
    "disbursedAmount": 3500000,
    "totalLoanOutstanding": 1500000,
    "disbursementPercentage": 70,
    "emi": 26911.97,
    "preEmi": 24791.67,
    "monthlyPayment": 26911.97,
    "currentTenureMonths": 360,
    "repaymentType": "FULL_EMI",
    "emiAdjustmentType": "RECALCULATE_EMI",
    "isFullyDisbursed": false
  }
}
```

If the loan was configured with `emiAdjustmentType: "KEEP_EMI_EXTEND_TENURE"`
and the new principal cannot be amortised at the pinned EMI, the function
rejects with:

```json
{ "code": "invalid-argument",
  "message": "Fixed EMI is too low to amortise the new principal at this rate. Switch emiAdjustmentType to RECALCULATE_EMI or raise the EMI.",
  "details": { "fixedEmi": 26912.13, "newDisbursed": 5000000, "interestRate": 8.5 } }
```

Errors:

```json
// duplicate UTR
{ "code": "already-exists",
  "message": "UTR HDFCN12345678901 has already been recorded",
  "details": { "conflictingRefId": "dsb_xyz789", "conflictingType": "disbursement" } }

// over-disbursement
{ "code": "invalid-argument",
  "message": "Disbursement would exceed sanction amount (5100000 > 5000000)",
  "details": { "sanctionAmount": 5000000, "attemptedDisbursed": 5100000 } }
```

### 5.3  `addBuilderStage`

Request:

```json
{
  "loanId": "loan_42",
  "stageName": "Plinth",
  "percentage": 10,
  "agreementValue": 8000000,
  "order": 2
}
```

Response:

```json
{
  "stageId": "stage_plinth",
  "stageName": "Plinth",
  "percentage": 10,
  "expectedAmount": 800000
}
```

### 5.4  `addBuilderPayment`

Request:

```json
{
  "stageId": "stage_plinth",
  "amount": 500000,
  "gstAmount": 25000,
  "paidBy": "bank",
  "paymentDate": "2026-04-20",
  "utrNumber": "ICIC2026042099",
  "notes": "Partial payment on plinth demand"
}
```

Response:

```json
{
  "paymentId": "bp_001",
  "stageAggregates": {
    "stageId": "stage_plinth",
    "totalPaid": 525000,
    "remainingAmount": 275000,
    "status": "partial"
  },
  "totalAmount": 525000
}
```

### 5.5  `getLoanSummary`

Request:

```json
{ "loanId": "loan_42" }
```

Response (truncated):

```json
{
  "loan": {
    "id": "loan_42",
    "bankName": "HDFC",
    "sanctionAmount": 5000000,
    "interestRate": 8.5,
    "tenureMonths": 360,
    "disbursedAmount": 3500000,
    "disbursementPercentage": 70,
    "totalLoanOutstanding": 1500000,
    "emi": 38445.91,
    "preEmi": 24791.67,
    "isFullyDisbursed": false
  },
  "disbursements": [
    { "id": "dsb_abc123", "amount": 1000000, "utrNumber": "HDFCN12345678901", "...": "..." }
  ],
  "builder": {
    "stages": [
      {
        "id": "stage_plinth",
        "stageName": "Plinth",
        "percentage": 10,
        "expectedAmount": 800000,
        "totalPaid": 525000,
        "remainingAmount": 275000,
        "status": "partial",
        "payments": [ { "id": "bp_001", "totalAmount": 525000, "...": "..." } ]
      }
    ],
    "totalExpected": 8000000,
    "totalPaidToBuilder": 525000,
    "remainingBuilderAmount": 7475000
  }
}
```

---

## 6 - Client integration

### React (web)

```js
import { getFunctions, httpsCallable } from "firebase/functions";

const fns = getFunctions(undefined, "asia-south1");
const addDisbursement = httpsCallable(fns, "addDisbursement");

const { data } = await addDisbursement({
  loanId, amount, disbursementDate, utrNumber, stageId, remarks,
});
console.log(data.loanAggregates);
```

### Android (Kotlin)

```kotlin
val fns = Firebase.functions("asia-south1")
val result = fns.getHttpsCallable("addDisbursement")
    .call(mapOf(
        "loanId" to loanId,
        "amount" to amount,
        "disbursementDate" to disbursementDate,
        "utrNumber" to utr,
    ))
    .await()
val data = result.data as Map<*, *>
```

Add the SDK dependency:

```kotlin
implementation("com.google.firebase:firebase-functions-ktx")
```

---

## 7 - Deploy

From the repo root:

```bash
# install Functions SDK once
cd functions && npm install && cd ..

# rules + indexes + functions
firebase deploy --only firestore:rules,firestore:indexes,functions

# or piecemeal
firebase deploy --only functions:addDisbursement
firebase deploy --only firestore:rules
```

The Firestore rules **deny direct writes** to `disbursements`,
`builderStages`, `builderPayments` and `utrIndex`. After the deploy,
clients must use the callables for those flows; the legacy `demands`,
`payments`, `flatCost` collections continue to accept direct writes.

---

## 8 - Local development

```bash
cd functions
npm run build:watch        # in one terminal
firebase emulators:start   # in another
```

The emulators run on:

```
auth      :9099
firestore :8080
functions :5001
ui        http://localhost:4000
```

Point the web client at the emulators by adding to `src/lib/firebase.js`:

```js
import { connectFunctionsEmulator } from "firebase/functions";
import { getFunctions } from "firebase/functions";
const fns = getFunctions(app, "asia-south1");
if (import.meta.env.DEV) connectFunctionsEmulator(fns, "localhost", 5001);
```

---

## 9 - Performance & cost notes

- All callables use **Firestore transactions** so concurrent disbursements
  for the same loan can't race-condition the aggregate.
- The dashboard reads the **persisted aggregate** on `loans/{loanId}`,
  not a recomputation, so the home tab stays O(1) regardless of how many
  disbursements / payments exist.
- `getLoanSummary` is the only place we re-aggregate, and it does so in
  parallel with two `where` queries + a single `in` query (chunked at 10).
- UTR uniqueness is enforced by **document-id** on `utrIndex` - a single
  Firestore `create` on a duplicate id fails with `ALREADY_EXISTS`, no
  extra read needed beyond the transactional `get`.
- Functions run in `asia-south1` to keep latency under ~150 ms RTT from
  Indian users on mobile.

---

## 10 - Validation summary

| Rule                                              | Where enforced                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Caller signed in                                  | `requireAllowedCaller` + Firestore rules                         |
| Caller email allow-listed                         | `requireAllowedCaller` + Firestore rules (`isOwner`)             |
| Amount is a positive finite number                | `parseAmount` + `isPositiveAmount` (functions)                   |
| GST amount non-negative                           | `addBuilderPayment` (`isNonNegativeAmount`)                      |
| UTR present and ≥ 6 chars                         | `addDisbursement`, `addBuilderPayment`                           |
| UTR globally unique                               | `utrIndex/{utrNumber}` document-id collision in transaction      |
| Disbursement ≤ remaining sanction                 | `addDisbursement` transaction                                    |
| Builder payment ≤ remaining stage amount          | `addBuilderPayment` transaction                                  |
| Sum of stage percentages ≤ 100                    | `addBuilderStage` transaction                                    |
| Stage names unique within a loan                  | `addBuilderStage` transaction                                    |
| Direct writes blocked on aggregate collections    | `firestore.rules` (`allow write: if false`)                      |
| Numeric precision (₹, 2 dp)                       | `round2` everywhere we persist money                             |
