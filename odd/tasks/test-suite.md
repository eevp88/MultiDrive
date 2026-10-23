# test-suite

Objective: add automated tests at every level (backend unit, backend integration, frontend unit/component, end to end) plus CI, so the risky logic fixed during the audit has a safety net.
Branch: one branch per task from `main` | Delivery strategy: `stacked-to-main` (each task is its own PR, merged in order) | Test runner: Vitest (backend and frontend), Playwright (e2e)

## Specs

Quotes are the user's exact words. Items marked (assumption) come from the assistant's proposal and can be changed.

- S1. "vamos amplementar todos los tipos de test": tests at every level: backend unit, backend integration over HTTP, frontend unit/component, and end to end in a browser.
- S2. (assumption) Vitest for backend and frontend. Supertest for HTTP routes. Playwright for e2e. The user chose "todos los tipos" without picking a runner, so these are the assistant's defaults.
- S3. (assumption) Tests never touch the real Google Drive or any real account. Google and Microsoft calls are faked at the module boundary; the database is a throwaway MySQL (compose service locally, service container in CI), never the development data.
- S4. (assumption) Cover first what failed during the audit: `contentDisposition`/`effectiveDisposition`, `isProviderNotFound` and error mapping, upload validation (`sizeBytes`, `filesMeta`, malformed fields), the `GET /files` query schema, batch move/delete results, trash and sync rules (`deletedBySync`), ZIP failure handling.
- S5. (assumption) CI with GitHub Actions: backend build + tests and frontend build + tests on every PR; e2e as its own job.
- S6. (assumption) New dev dependencies are allowed only for testing. No production code is changed except what a test needs to be testable (for example exporting a function), and each such change is noted in its PR.
- S7. Project rules that apply: update `AGENTS.md` and the README with the test commands, UI strings in `en.ts` and `es.ts`, never read `.env` files, tests must not write files to disk outside temp dirs.

## Tasks

- [x] T1 | S1, S2, S4, S5 | inline | Backend: Vitest setup, unit tests for the pure utils and the error middleware (Zod schemas live inside the route files, so they are covered over HTTP in T2), `npm test`, and the CI workflow (build + test) | commit: see git log (branch test/backend-unit-and-ci; 77 tests pass, 4 deliberate breakages detected, clean-install simulation of the CI steps passes)
- [ ] T2 | S1, S3, S4 | inline | Backend integration: Supertest against `app` with a test MySQL and faked Google, covering auth, files, folders, uploads, trash/sync | commit: pending
- [ ] T3 | S1, S2, S4 | inline | Frontend: Vitest + Testing Library + jsdom, tests for api helpers, selection logic, upload context, panels | commit: pending
- [ ] T4 | S1, S3, S5 | inline | End to end: Playwright against the docker stack with a seeded user, flows that do not need Drive | commit: pending
- [ ] T5 | S5, S7 | inline | Docs (README, AGENTS.md) and CI wiring of the integration and e2e jobs | commit: pending

## Log

- L1 (2026-10-23): "vamos amplementar todos los tipos de test"
- L2 (2026-10-23): context before L1: the repo had no tests, no test framework and no CI (checked: no `*.test.*`, no `.github/workflows`, only `test:s3` and `test:api-upload` manual scripts). The assistant offered Vitest vs `node:test` vs Jest for the backend, and Vitest + Testing Library and Playwright for the frontend. The user answered with L1 without choosing, so S2 is an assumption.
- L3 (2026-10-23): T1 finding: `decryptText(encryptText(''))` throws "Invalid encrypted payload" because the data part of an empty value is empty. No caller encrypts an empty value, so production code was left alone and the behavior is pinned by a test. Vitest 5 needs Node 22.12+ while the production image is Node 20: CI uses Node 22 and AGENTS.md says tests need Node 22+.
