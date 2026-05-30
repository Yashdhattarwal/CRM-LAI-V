# PaymentsVault Implementation Spec (portable)

This document describes the **PaymentsVault** service as implemented in this repository, in a form you can copy into another project and ask an agent (e.g., Claude) to implement the same behavior.

It includes:
- **API contract** (routes, headers, requests, responses, status codes)
- **Authentication/authorization model**
- **Database schema requirements** (SQL Server + Always Encrypted) and **migration scripts**
- **Business rules / invariants**
- **Gateway integration** (RTN order/create + order/Pay)
- **Operational/deployment** notes (App Service + certs)

---

## Service overview

PaymentsVault is a .NET Web API that stores payment instruments (CARD/ACH) in SQL Server using **SQL Server Always Encrypted** for sensitive columns, and exposes:
- Instrument **create / read (masked) / patch-update**
- **Verification** (compare customer-supplied plaintext to stored ciphertext; internal-only gate)
- **Charge** (submit payment to RTN using decrypted instrument; internal-only gate)
- **Vault client** bootstrap/admin endpoints (protected by an admin API key)

### Key security posture
- Public responses **never include** full PAN, full ACH routing number, or full ACH account number.
- Sensitive request bodies (PAN/ACH/CVV) must **never be logged**.
- Encryption/decryption occurs in the **SQL client driver** (Always Encrypted), not in application code.

---

## Tech stack expectations

- **.NET**: ASP.NET Core Web API
- **SQL**: Microsoft SQL Server (supports Always Encrypted)
- **DB access**: `Microsoft.Data.SqlClient` with parameterized SQL (ADO.NET)
- **Gateway HTTP**: RestSharp client to RTN (simple POST JSON wrapper)
- **Swagger**: Swashbuckle

---

## Configuration

### Required configuration keys

#### Database
- `ConnectionStrings:PaymentsVaultDb`
  - Must include:
    - `Column Encryption Setting=Enabled`
    - `Encrypt=True`
  - Example: `Server=...;Database=PaymentsVault;User Id=...;Password=...;Encrypt=True;TrustServerCertificate=True;Column Encryption Setting=Enabled;`

#### Vault options
- `PaymentVault:HmacSecret` (Base64; **>= 32 bytes** when decoded)
- `PaymentVault:EnableSwagger` (optional; can enable Swagger in prod)
- `PaymentVault:VerboseValidationErrors` (optional)

#### Decrypted read gates
Legacy:
- `PaymentVault:AllowInternalDecryptedReads` (bool)

Per-endpoint overrides:
- `PaymentVault:AllowChargeWithDecryptedReads` (bool?; falls back to legacy)
- `PaymentVault:AllowVerificationWithDecryptedReads` (bool?; falls back to legacy)

#### Vault client admin
- `PaymentVault:VaultClientsAdminApiKey`
  - When set and host is **not Development**, `/api/paymentvault/clients/*` requires header `X-Vault-Admin-Key` with this value.
  - If missing outside Development, admin endpoints are blocked (403).

#### RTN gateway configuration
- `RtnPay:BaseUrl` (required)
- `RtnPayTest:BaseUrl` (required)
- `RtnPay:OrderCreateReturnUrl` (optional; default `https://rtngateway.com/payment_status`)
- `RtnPayTest:OrderCreateReturnUrl` (optional; default `https://rtngateway.com/payment_status`)
- `RtnPay:RequestTimeoutSeconds` (optional; default 100)
- `RtnPayTest:RequestTimeoutSeconds` (optional; default 100)

---

## Authentication / Authorization model

### Vault client auth (merchant scoping)

Most endpoints require two headers:
- `X-Key`
- `X-Password`

Behavior:
- Request is authenticated by matching `X-Key`/`X-Password` to a row in `vault.VaultClients` where `IsActive=1`.
- The middleware stores `VaultClientId` in request context and the API **scopes all instrument queries by VaultClientId**.
- The same headers also determine whether the request uses RTN **prod** credentials or **test** credentials:
  - If headers match `(XKeyTest, XPasswordTest)` → treat as **test gateway** and use test tables (`PaymentInstrumentTest`, `PaymentProfileTest`).
  - Otherwise treat as prod and use prod tables.

### Vault client admin auth (management endpoints)

Admin endpoints under `/api/paymentvault/clients/*` are protected by:
- `X-Vault-Admin-Key: <configured PaymentVault:VaultClientsAdminApiKey>`

Outside Development:
- Missing configuration → block admin endpoints (403).
- Wrong/missing header → 401.

---

## API surface (routes)

Base URL variable in examples: `{{baseUrl}}`

### 1) Vault clients (admin)

#### POST `/api/paymentvault/clients`
Creates a vault client.

Headers:
- `X-Vault-Admin-Key` (required when configured outside Development)

Request body:

```json
{ "clientName": "merchant-a" }
```

If `xKey`/`xPassword` are omitted, server generates them and returns them.

Response 201 example:

```json
{
  "vaultClientId": 123,
  "clientName": "merchant-a",
  "isActive": true,
  "xKey": "generated-or-null",
  "xPassword": "generated-or-null",
  "xKeyTest": null,
  "xPasswordTest": null
}
```

#### PUT `/api/paymentvault/clients/{id}`
Updates client fields (name/credentials/active flag).

Headers:
- `X-Vault-Admin-Key`

#### POST `/api/paymentvault/clients/{id}/enable`
#### POST `/api/paymentvault/clients/{id}/disable`
Enable/disable the client.

Headers:
- `X-Vault-Admin-Key`

---

### 2) Save instrument

#### POST `/api/savepaymentvault`
Creates a vault payment instrument (CARD or ACH) and associated profile metadata.

Headers:
- `X-Key`
- `X-Password`
- `Content-Type: application/json`

Request body: **CARD**

```json
{
  "customerId": 999,
  "instrumentType": "CARD",
  "cardNumber": "4111111111111111",
  "expMonth": 12,
  "expYear": 2028,
  "brand": "VISA",
  "billingName": "Jane Doe",
  "billingPostalCode": "78701"
}
```

Request body: **ACH**

```json
{
  "customerId": 999,
  "instrumentType": "ACH",
  "achRoutingNumber": "021000021",
  "achAccountNumber": "123456789",
  "bankAccountType": "CHECKING",
  "bankName": "Example Bank",
  "billingName": "Jane Doe",
  "billingPostalCode": "78701"
}
```

Response 201: `PaymentInstrumentMaskedResponse`
- Includes a base64 `rowVersion` for optimistic concurrency.

Example:

```json
{
  "paymentInstrumentId": 555,
  "customerId": 999,
  "instrumentType": "CARD",
  "status": "ACTIVE",
  "brand": "VISA",
  "last4": "1111",
  "bin6": "411111",
  "expMonth": 12,
  "expYear": 2028,
  "billingName": "Jane Doe",
  "billingPostalCode": "78701",
  "createdAtUtc": "2026-04-20T00:00:00Z",
  "updatedAtUtc": "2026-04-20T00:00:00Z",
  "rowVersion": "AAAAAAAAB9E="
}
```

Errors:
- 400 validation errors (instrumentType mismatch, invalid PAN/ACH shape, etc.)
- 409 conflict on duplicate active fingerprint (see DB constraints)
- 503 on DB connectivity / Always Encrypted misconfiguration

---

### 3) Get instrument (masked)

#### POST `/api/getpaymentvault`
Reads an instrument by id (masked projection).

Headers:
- `X-Key`
- `X-Password`

Body:

```json
{ "paymentInstrumentId": 555 }
```

Responses:
- 200 with `PaymentInstrumentMaskedResponse`
- 404 if not found for this vault client

---

### 4) Update instrument (patch)

#### PUT `/api/updatepaymentvault`
Patch update; null means “leave unchanged”.

Headers:
- `X-Key`
- `X-Password`

Body (metadata-only update with optimistic concurrency):

```json
{
  "paymentInstrumentId": 555,
  "billingName": "Jane Doe Updated",
  "rowVersion": "AAAAAAAAB9E="
}
```

Important rules:
- If `rowVersion` provided and row changed since read → **409 Conflict**
- CARD: cannot update `last4`/`bin6` unless updating `cardNumber`
- ACH: cannot update `accountLast4` unless updating `achAccountNumber`; cannot update `routingLast4` unless updating `achRoutingNumber`

Responses:
- 200 with reloaded masked response
- 404 not found (wrong vault client or id)
- 409 conflict (rowversion mismatch)
- 400 invalid patch

---

### 5) Verify customer information (internal-only gate)

#### POST `/api/paymentvault/verify`
Compares customer-provided plaintext with decrypted stored fields.

Headers:
- `X-Key`
- `X-Password`

Gate:
- Requires `PaymentVault:AllowVerificationWithDecryptedReads=true` (or legacy `AllowInternalDecryptedReads=true`)

Body (CARD verify):

```json
{
  "paymentInstrumentId": 555,
  "customerId": 999,
  "cardNumber": "4111111111111111",
  "expMonth": 12,
  "expYear": 2028
}
```

Body (ACH verify):

```json
{
  "paymentInstrumentId": 555,
  "customerId": 999,
  "achRoutingNumber": "021000021",
  "achAccountNumber": "123456789"
}
```

Response 200:

```json
{
  "paymentInstrumentId": 555,
  "customerId": 999,
  "status": true
}
```

Notes:
- Returns 200 with `status=false` when instrument missing or mismatch (reduces enumeration).

---

### 6) Charge (internal-only gate + idempotency)

#### POST `/api/paymentvault/charge`
Uses decrypted stored instrument to submit payment to RTN:
- RTN `/order/create` first
- then RTN `/order/Pay` as `card_pay` or `ach_pay`

Headers:
- `X-Key`
- `X-Password`
- Optional: `Idempotency-Key: <string>`

Gate:
- Requires `PaymentVault:AllowChargeWithDecryptedReads=true` (or legacy `AllowInternalDecryptedReads=true`)

Body (shared fields):

```json
{
  "paymentInstrumentId": 555,
  "amount": 1.23,
  "customerId": 999,
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "customerMobile": "+15551234567",
  "resource": "order-abc",
  "description": "Monthly subscription"
}
```

CARD-only required fields:
- `cvv`, `address1`, `city`, `state`, `country`, `postalCode` (address2 optional)

ACH-only optional field:
- `accountHolderName` (falls back to instrument billingName / customerName)

Response 200:

```json
{
  "paymentInstrumentId": 555,
  "payResponse": {
    "customerId": 999,
    "order_id": "ORD_...",
    "transaction_id": "...",
    "status": "Success",
    "result_code": "...",
    "result_message": "...",
    "message": "..."
  }
}
```

Declines:
- RTN sometimes returns HTTP 200 with JSON `status` Fail/Failed/Failure; API returns 200 but `payResponse.status` is `"Failed"` and includes result code/message.

Timeouts:
- `order/create` timeout → 504
- `order/Pay` timeout → 504

Idempotency:
- If `Idempotency-Key` is repeated with same vault client + instrument/customer/amount/resource, server replays the stored 200 response body from `vault.PaymentChargeIdempotency` (does not re-call gateway).

---

## Database requirements

### SQL Server + Always Encrypted

Instrument sensitive columns must be Always Encrypted with randomized encryption:
- `vault.PaymentInstrument.CardNumber`
- `vault.PaymentInstrument.AchAccountNumber`
- `vault.PaymentInstrument.AchRoutingNumber`
And equivalents in `vault.PaymentInstrumentTest`.

### Required vault tables (minimum)

#### `vault.VaultClients`
Stores vault client credentials and RTN gateway credentials (prod/test).
Minimum columns used by app:
- `VaultClientId` (PK)
- `ClientName`
- `XKey`, `XPassword` (prod)
- `XKeyTest`, `XPasswordTest` (optional)
- `IsActive`
- timestamps

#### `vault.PaymentInstrument` / `vault.PaymentInstrumentTest`
Minimum columns used by app:
- `PaymentInstrumentId` (PK)
- `VaultClientId` (FK → `vault.VaultClients`)
- `CustomerId`
- `InstrumentType` (`CARD`/`ACH`)
- `Status` (expects `ACTIVE` for charge)
- `FingerprintHmac` (`varbinary(32)`)
- masked metadata columns: `Last4`, `Bin6`, `ExpMonth`, `ExpYear`, `BankAccountType`, `BankName`, `AccountLast4`, `RoutingLast4`, `BillingName`, `BillingPostalCode`
- encrypted columns: `CardNumber`, `AchAccountNumber`, `AchRoutingNumber`
- `RowVersion` (SQL Server rowversion) for concurrency

#### `vault.PaymentProfile` / `vault.PaymentProfileTest`
Holds verification and metadata.
Must have a 1:1 relationship with instrument:
- Unique index or constraint on `PaymentInstrumentId` in `PaymentProfile`

### Fingerprints and dedupe

Application computes:
- Card fingerprint: HMAC-SHA256 over `CARD|{customerId}|{panDigits}`
- ACH fingerprint: HMAC-SHA256 over `ACH|{customerId}|{routingDigits}|{accountDigits}`

Recommended DB constraints (implemented by hardening script):
- Filtered unique index on `(VaultClientId, CustomerId, FingerprintHmac)` where `Status = 'ACTIVE'`

### Idempotency storage

Required table (implemented by hardening script):
- `vault.PaymentChargeIdempotency`
  - `(VaultClientId, IdempotencyKeyHash)` unique
  - stores cached JSON response

---

## DB migration scripts (from this repo)

Run these against the target database:

1) `scripts/add-vault-client-id-to-payment-instrument.sql`
- Adds `VaultClientId` to `vault.PaymentInstrument` and `vault.PaymentInstrumentTest`
- Backfills existing rows
- Adds FK and indexes

2) `scripts/payment-vault-hardening.sql`
- Adds `RowVersion` (rowversion) to instrument tables
- Adds filtered unique indexes for active fingerprints
- Adds `vault.PaymentChargeIdempotency` table

---

## Operational / deployment notes

### Always Encrypted CMK provider

If the database CMK uses `MSSQL_CERTIFICATE_STORE` (Windows certificate store):
- The API must run on a **Windows host** where the CMK cert is available
  - Azure App Service: upload certificate + configure `WEBSITE_LOAD_CERTIFICATES` (thumbprint or `*` for testing)
- Local macOS execution will fail to decrypt/encrypt Always Encrypted columns (unsupported provider).

To support macOS/Linux hosts, use an Always Encrypted provider such as **Azure Key Vault** (requires DB key rotation and app configuration changes).

---

## Non-goals / known limitations (as implemented)

- Vault client secrets are stored in DB as plaintext strings (not hashed). If implementing from scratch, prefer hashed secrets or external secret storage.
- Charge flow does not currently write a full payment ledger (e.g., billing attempts) besides idempotency cache.
- Charge idempotency caches only successful HTTP 200 responses returned by the controller.

---

## Implementation checklist (for another project)

1) **Create database schema** and Always Encrypted keys (CMK/CEK) and encrypted columns.
2) Implement `VaultClients` + `PaymentInstrument*` + `PaymentProfile*` tables and constraints.
3) Implement vault client auth middleware using `X-Key`/`X-Password`.
4) Implement admin middleware for `/api/paymentvault/clients/*` with `X-Vault-Admin-Key`.
5) Implement ADO.NET repositories:
   - Create instrument in a **transaction** (instrument + profile).
   - Read masked / read full (decrypted).
   - Patch update with **rowversion** concurrency.
6) Implement RTN client:
   - POST wrapper `{ "data": { ... } }`
   - endpoints: `order/create`, `order/Pay`
   - configurable timeout + returnUrl.
7) Implement `verify` endpoint (decrypt + compare; return 200 with status).
8) Implement `charge` endpoint:
   - validate instrument active + customer ownership
   - RTN create then pay
   - idempotency cache table keyed by hash of header + request.
9) Swagger operation filters to document required headers.
10) Global exception handler producing RFC7807 `ProblemDetails` and safe redaction.

