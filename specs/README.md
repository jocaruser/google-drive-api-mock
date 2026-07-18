# Specifications

This tree is the canonical record of what google-drive-api-mock does,
written before and beside the code — specs lead, code follows.

- `features/` — observable behaviour, one folder per capability
  (requirements and scenarios; no implementation detail).
- `decisions/` — Architecture Decision Records
  preserving why the emulator is shaped the way it is.

All prose follows semantic line breaks and British English
(ADR-0004 records the adoption of these conventions,
inherited from the illo3d repository this project was extracted from).

A change that alters observable behaviour MUST update
the matching `features/` spec in the same pull request.
