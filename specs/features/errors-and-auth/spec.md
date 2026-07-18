# Errors and authentication

The emulator's honesty rules:
answer the modelled surface faithfully,
and refuse everything else so loudly
that a missing capability can never masquerade as a passing test.

## Authentication

Scenarios:

- A request without a `Bearer` token
  → 401 in Google's error envelope
  (`Request had invalid authentication credentials. …`).
- Any bearer token at all is accepted —
  identity is out of scope; OAuth belongs to the consumer's own mocks.
- `GET …?alt=media` requires no token:
  image tags cannot send headers,
  and real Drive serves thumbnails via signed URLs
  the emulator does not model.

## Error envelope

Every error is Google-shaped:

```json
{ "error": { "code": 404, "message": "…", "status": "NOT_FOUND" } }
```

Messages reuse Google's wording where consumers are known
to branch on it
(`File not found: {id}.`, `Requested entity was not found.`,
`already exists`, `Unable to parse range: …`).

## The fail-loud boundary

Scenarios:

- A request outside the modelled surface —
  an unknown path, an unsupported `q` clause,
  a `batchUpdate` request type, a partial-range clear,
  a non-`RAW` value input —
  → 400 or 404 whose message begins with `google-drive-api-mock:`
  or names the offending clause,
  never a silent default or an empty success.
- A consumer adopts a new Google endpoint or clause
  → the first test run against the emulator fails
  with an explicit message,
  which is the signal to extend the modelled surface
  (and this spec) in the same change.
