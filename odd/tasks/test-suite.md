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
- [x] T2 | S1, S3, S4 | inline | Backend integration: Supertest against `app` with a test MySQL and faked Google, covering auth, files, folders, uploads, trash/sync | commit: see git log (branch test/backend-integration, stacked on test/backend-unit-and-ci; 97 integration tests pass 3 runs in a row, 77 unit tests and `npm run build` pass, 4 deliberate breakages detected)
- [x] T3 | S1, S2, S4 | inline | Frontend: Vitest + Testing Library + jsdom, tests for api helpers, selection logic, upload context, panels | commit: see git log (branch test/frontend-unit, stacked on test/backend-integration; 109 tests pass 3 runs in a row, `npm run build` passes, 4 deliberate breakages detected; selection logic and the upload panel are NOT covered, see L7)
- [ ] T4 | S1, S3, S5 | inline | End to end: Playwright against the docker stack with a seeded user, flows that do not need Drive | commit: pending
- [ ] T5 | S5, S7 | inline | Docs (README, AGENTS.md) and CI wiring of the integration and e2e jobs | commit: pending

## Log

- L1 (2026-10-23): "vamos amplementar todos los tipos de test"
- L2 (2026-10-23): context before L1: the repo had no tests, no test framework and no CI (checked: no `*.test.*`, no `.github/workflows`, only `test:s3` and `test:api-upload` manual scripts). The assistant offered Vitest vs `node:test` vs Jest for the backend, and Vitest + Testing Library and Playwright for the frontend. The user answered with L1 without choosing, so S2 is an assumption.
- L3 (2026-10-23): T1 finding: `decryptText(encryptText(''))` throws "Invalid encrypted payload" because the data part of an empty value is empty. No caller encrypts an empty value, so production code was left alone and the behavior is pinned by a test. Vitest 5 needs Node 22.12+ while the production image is Node 20: CI uses Node 22 and AGENTS.md says tests need Node 22+.
- L4 (2026-10-27): T2 finding, production code left alone (S6): the first batch upload of a user with two or more files can fail one of them with `UPLOAD_FAILED` (Prisma P2002). `selectAccount` in `upload.routes.ts` does `uploadRoutingPolicy.upsert` per file, the files run concurrently, and with no policy row yet both try to insert it. The T2 upload tests create the policy row up front. Fix candidates: create the policy once before the per-file loop, or catch P2002 and re-read. Needs the user's decision.
- L5 (2026-10-27): T2 design: integration tests are `*.int.test.ts`, run by `npm run test:integration` with `TEST_DATABASE_URL`; `integration-setup.ts` refuses a database whose name does not end in `_test`, truncates every table before each test and fakes `googleapis` and `google.service.ts`. The unit config excludes them, so `npm test` still needs no database. The batch ZIP failure test accepts either a 500 or an aborted connection, because which one happens depends on whether the ZIP header was already sent.
- L6 (2026-10-27): T3 design: `frontend/vitest.config.mts` is separate from `vite.config.ts` (no PWA plugin in tests), jsdom, `restoreMocks`, localStorage cleared before each test, `VITE_API_URL` fixed. `fetch` is stubbed per test. The en/es dictionaries are checked for identical keys and `{placeholders}`. The frontend CI job now also runs `npm test`.
- L7 (2026-10-27): T3 gap: the multi-select logic (`handleRowClick`, `toggleAllVisibleFiles` in `AllFilesPage.tsx`) and the upload progress panel (inline in `DriveLayout.tsx`) live inside 1000 and 584 line components, so testing them means either rendering whole pages with router and API fakes or extracting pure functions and a component, which changes production code (S6). Not done; needs the user's decision.
