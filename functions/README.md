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

  // Aggregates - written ONLY by Cloud Functions. Mirrors of the legacy
  // field names are kept so the existing UI keeps reading the same keys.
  disbursedAmount       number   (= sum of disbursements.amount)
  totalDisbursed        number   (legacy mirror)
  totalLoanOutstanding  number   (= sanctionAmount - disbursedAmount)
  remainingAmount       number   (legacy mirror)
  disbursementPercentage number  (= disbursedAmount / sanctionAmount * 100)
  emi                   number   (full-amortising; reducing balance)
  emiAmount             number   (legacy mirror)
  preEmi                number   (interest-only on disbursedAmount)
  preEmiAmount          number   (legacy mirror)
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

| Field                    | Formula                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `disbursementPercentage` | `disbursed / sanction * 100`                                 |
| `totalLoanOutstanding`   | `sanction - disbursed`                                       |
| `preEmi`                 | `disbursed * rate / (12 * 100)`                              |
| `emi`                    | `P * r * (1+r)^n / ((1+r)^n - 1)`, `r = rate/12/100`         |
| `totalInterest`          | `emi * n - principal`                                        |
| `totalPayable`           | `emi * n`                                                    |
| `isFullyDisbursed`       | `disbursed >= sanction && sanction > 0`                      |

Edge cases:
- 0 % loans (`r = 0`) take the linear-amortisation branch (`P / n`).
- Any non-finite / non-positive input returns `0` rather than `NaN`.
- All money outputs are rounded to 2 dp (`round2`) so persisted values
  never drift.

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

| Function                    | Verb   | Effect                                                          |
| --------------------------- | ------ | --------------------------------------------------------------- |
| `calculateLoanDetails`      | read   | Returns EMI / Pre-EMI / outstanding for a stored loan or "what-if" override |
| `getLoanSummary`            | read   | One round-trip dashboard payload (loan + disbursements + stages + builder totals) |
| `addDisbursement`           | write  | Atomically appends a disbursement, claims its UTR, updates loan aggregates |
| `addBuilderStage`           | write  | Creates a stage; checks sum-of-percentages ≤ 100 and unique name |
| `addBuilderPayment`         | write  | Appends payment, claims UTR, updates stage totals + status |
| `recomputeLoanAggregates`   | write  | Repair tool: rebuilds `loans.*` and stage aggregates from source docs |

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
    "tenureMonths": 360
  },
  "computed": {
    "disbursementPercentage": 50,
    "totalLoanOutstanding": 2500000,
    "isFullyDisbursed": false,
    "preEmi": 17708.33,
    "emi": 38445.91,
    "totalInterest": 8840527.6,
    "totalPayable": 13840527.6
  }
}
```

### 5.2  `addDisbursement`

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
    "emi": 38445.91,
    "preEmi": 24791.67,
    "isFullyDisbursed": false
  }
}
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
