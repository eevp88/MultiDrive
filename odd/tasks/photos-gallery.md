# photos-gallery

Objective: a photo gallery view in 9Drive across the connected Google accounts (the "multiFoto" idea), without Google Photos.
Branch: `feat/photos-gallery` | Delivery strategy: `stacked-to-main` (assumed, see L8) | Test runner: none (backend and frontend have no test script)

## Specs

Quotes are the user's exact words. Items marked (assumption) come from the assistant's proposal, which the user accepted with "tiene sentido la vista"; they are not literal requests and can be changed.

- S1. "seria bueno  asi como  existe 9drive o  multidrive existir un multiFoto" and "tiene sentido la vista": a photo gallery view inside 9Drive over the files in the connected accounts. Google Photos is not a source: its API no longer exposes the existing library (removed 2025-03-31) and has no delete.
- S2. (assumption, option A) Thumbnails for files in Google accounts come from Drive's `thumbnailLink`, served through a backend endpoint `GET /files/:id/thumbnail` that asks Drive for a fresh link on each request (links expire) and streams it. Files in S3 accounts show a generic icon. S3 thumbnails are out of scope.
- S3. (assumption) New nullable column `files.taken_at`, filled during Google sync from `imageMediaMetadata.time`. Display date is `takenAt`, falling back to `createdAt`. The migration only adds a nullable column.
- S4. (assumption) `GET /photos`: the user's active image and video files, newest first by display date, cursor pagination, `requireAuth`, Zod validation, `bigint` converted to string, JSON errors with a stable `code`.
- S5. (assumption) Frontend route `/fotos` inside `ProtectedRoute` and `DriveLayout`, a "Fotos" entry in the sidebar, grid grouped by month, lazily loaded thumbnails, click opens the existing preview.
- S6. Out of scope: albums, duplicate detection, face or object search, automatic upload from the phone, S3 thumbnails, any change to Google OAuth scopes or redirect behavior.
- S7. Project rules that apply: no Google tokens or thumbnail URLs in logs or responses, update the README and AGENTS.md API notes, UI strings in `en.ts` and `es.ts`, do not store files on disk.

## Tasks

- [ ] T1 | S3 | inline | Prisma migration adding `files.taken_at`; commit: pending
- [ ] T2 | S3 | inline | Request `imageMediaMetadata(time)` in `syncGoogleAppFolderFiles` and store `takenAt`; commit: pending
- [ ] T3 | S2, S7 | inline | `GET /files/:id/thumbnail` proxy with cache headers and no token leakage; commit: pending
- [ ] T4 | S4 | inline | `GET /photos` with cursor pagination; commit: pending
- [ ] T5 | S1, S5 | inline | `/fotos` page, sidebar entry, i18n en and es; commit: pending
- [ ] T6 | S7 | inline | README and AGENTS.md API notes, end-to-end check against a real Drive account; commit: pending

Route declaration: every task inline. No writer trigger applies: the tasks are sequential and share files, nothing runs in parallel. Exploration was done inline within the evidence budget.

Test policy exception: no runnable test framework exists in the backend or the frontend, so there is no meaningful RED test. Each task is verified with `npm run build`, scratch scripts against the running stack, and a final check with real images. The end-to-end check needs images in the user's Drive folder `9drive`, which requires the user's authorization before anything is created there.

Forecast: about 600 authored changed lines (additions plus deletions, generated files excluded), above the 400 planning heuristic.

Slices (one PR each, all against `main`, merged in order; each is safe on its own):
- PR 1: this feature document plus the project documentation updates (branch `feat/photos-gallery`).
- PR 2: T1 and T2, the `taken_at` column and its sync (branch `feat/photos-taken-at`).
- PR 3: T3 and T4, the thumbnail and photos endpoints (branch `feat/photos-api`).
- PR 4: T5 and T6, the `/fotos` page and final documentation (branch `feat/photos-view`).
Push, pull request creation and merge are the user's decisions.

## Log

- L1 (2026-10-20, user, original request): seria bueno  asi como  existe 9drive o  multidrive existir un multiFoto
- L2 (2026-10-20, user, earlier context for the goal): quiro  bajar el espacio ocupado y poder repartirlo en las demas cuentas
- L3 (2026-10-20, user): tiene sentido la vista
- L4 (2026-10-20, user): esto deberia ser un odd
- L5 (2026-10-20, evidence): `File` has no thumbnail or capture date; the Drive sync requests only `id,name,mimeType,size,parents`; the files grid exists but there is no `/fotos` route; the measured quota of the connected account showed that most of its usage is outside Drive (Gmail and Photos), so this feature does not by itself free space in the account.
- L6 (2026-10-20, decision pending): option A (Google only) assumed from the assistant's recommendation; the user has not answered A versus B (S3 thumbnails from the start).
- L7 (2026-10-20, user): documenta todo y sigamos  primero con la galeria
- L8 (2026-10-20, decision, assumption): delivery strategy `stacked-to-main` was the assistant's recommendation and the user answered "primero con la galeria" to the question that offered it; it is recorded as assumed, not as an explicit answer, and can be changed.
- L9 (2026-10-20, evidence): only two providers exist in the code (`google_drive`, `s3`). The user also has files in Dropbox and a personal OneDrive; neither is supported. Free tiers checked: Dropbox 2 GB, OneDrive 5 GB, Cloudflare R2 and Backblaze B2 10 GB. Photos stored in S3 accounts would show a generic icon under option A, which makes the pending A versus B decision (L6) more relevant if the user moves photos to R2 or B2.
- L10 (2026-10-20, progress): project documentation updated (README sections 6.6 and Storage Providers And Limits, AGENTS.md conventions). Next: T1.
