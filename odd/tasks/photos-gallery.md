# photos-gallery

Objective: a photo gallery view in 9Drive across the connected Google accounts (the "multiFoto" idea), without Google Photos.
Branch: `feat/photos-gallery` | Delivery strategy: `stacked-to-main` (assumed, see L8; PRs merged in order) | Test runner: none (backend and frontend have no test script)

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

- [x] T1 | S3 | inline | Prisma migration adding `files.taken_at`; commit: 16d7d76 (column `datetime(3)` nullable present in MySQL, `prisma migrate status` up to date with 18 migrations, server healthy)
- [x] T2 | S3 | inline | `imageMediaMetadata(time)` requested in `syncGoogleAppFolderFiles` and stored as `takenAt`; commit: 8f1e4d3 (observed end to end against the real Drive, see L17)
- [x] T3 | S2, S7 | inline | `GET /files/:id/thumbnail` proxy with cache headers and no token leakage; commit: 18fd742 (observed on real Drive images: JPEG, HEIF served as JPEG, PNG; size, auth, ownership, S3 and validation cases; no Google URL in headers, body or logs)
- [x] T4 | S4 | inline | `GET /photos` with cursor pagination; commit: ffb35c3 (observed: 30 visible rows walked in 5 pages with no repeats or gaps, strict (date, id) order, ties and null taken_at, user isolation, invalid cursor and limit cases)
- [x] T5 | S1, S5 | inline | `/fotos` page, sidebar entry, i18n en and es; commit: d26ebbd (frontend build passes; served by the rebuilt frontend container; opened in the browser by the user, see L21 and L23)
- [x] T6 | S7 | inline | README and AGENTS.md API notes, end-to-end check against a real Drive account; commit: see L21 (docs written; end-to-end covered by L13, L17 and the browser check in L21)

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
- L11 (2026-10-20, evidence): real Drive check, read-only, 110 images of the connected account: `imageMediaMetadata.time` is always `YYYY:MM:DD HH:MM:SS` (90 of 90) and `parseExifTime` accepted all of them; PNG files carry no capture date (fallback to `createdAt`); JPEG 27 of 37 and HEIF 63 of 63 carry it. 19 parser cases pass (impossible dates, `0000:00:00`, future dates, non EXIF formats). Risk for T3 and T5: 63 of 110 images are HEIF (iPhone), which browsers do not render in an `<img>`, so the existing preview will not show them; the viewer should use a large Drive thumbnail for those.
- L12 (2026-10-20, progress): T1 and T2 committed on `feat/photos-taken-at`. The sync write path needs files in the Drive folder `9drive` and a Sync from All Files; that is a user action on the user's Drive, so it is left to the user or to an explicit authorization. Persisting `takenAt` for uploads was left out on purpose: the capture date is not available when the upload finishes, so those rows stay null until the next sync.
- L13 (2026-10-20, evidence): Drive thumbnail links are signed URLs that work without authentication until they expire, accept `=sNN` to change the size, and Drive returns HEIF as JPEG. For that reason the link is only used server side and never returned. 34 checks pass on T3 and T4, using three real Drive images (read only) plus synthetic rows for ties and null dates. Stress: 60 connections cut halfway and 90 thumbnails requested 30 at a time all behaved (90 of 90 correct in 4 seconds, server never restarted); the logs hold no Google URL, `thumbnailLink` or token.
- L14 (2026-10-20, decision for T5): an `<img>` cannot send an Authorization header and the project forbids tokens in URLs, so the page must fetch each thumbnail with `fetch` plus the Bearer token and show it through an object URL, loading lazily. The viewer for HEIF files uses `size=2048`, since the original is not displayable in a browser.
- L15 (2026-10-20, evidence, separate finding, not changed): four places grant `role: writer, type: anyone` on the Drive file: both upload paths (`upload.routes.ts`), `POST /files/:id/public-permission` and `GET /files/:id/view-url`. Every file uploaded through 9Drive therefore becomes editable by anyone holding its link. This is product behavior that needs the user's decision; it is outside this feature.
- L16 (2026-10-20, progress): T3 and T4 committed on `feat/photos-api`, stacked on `feat/photos-taken-at`. Known limit of `GET /photos`: it sorts on `COALESCE(taken_at, created_at)`, which cannot use an index, so it scans the user's rows; fine for a personal library. Next: T5.
- L17 (2026-10-20, user, then evidence): "termina T2". With that authorization two copies of existing images (a JPEG with EXIF date and a PNG without) were created in the empty Drive folder `9drive` of the connected account and removed afterwards. Observed with the app's own `syncGoogleAppFolderFiles`: the first sync created the 2 rows; the JPEG row got `taken_at` equal to the EXIF date of the source and the PNG row stayed null; a second sync changed nothing (0 created, 0 updated, 0 deleted); after setting `taken_at` to null on the JPEG row a third sync restored it (1 updated). Drive needed a few seconds to compute the metadata of a new image, so a sync right after an upload can still see no date; the next sync fills it. Cleanup confirmed: 0 files left in the `9drive` folder and 0 rows in the database.
- L18 (2026-10-20, progress): PR #15 (Drive no longer made public with writer rights) and the whole stack (#12, #13, #14) are merged to main. An audit of the user's accounts found no owned file exposed.
- L19 (2026-10-20, user): "dale T5". Branch `feat/photos-view` from main.
- L20 (2026-10-20, progress): T5 committed (d26ebbd). `/fotos` route and sidebar entry, month-grouped grid, thumbnails loaded lazily with IntersectionObserver and fetched with the Bearer token into object URLs (revoked on unmount), a new viewer (Esc and arrow keys; images use `size=2048`, so HEIF displays; videos use the existing preview-token flow), cursor "load more", i18n en and es. S5 says "click opens the existing preview"; the existing preview is embedded in AllFilesPage and cannot show HEIF, so a small dedicated viewer was written instead (deviation from S5, reason in L11 and L14). Only one real image row exists in the user's database, so scroll and pagination in the browser were not exercised with a large library. Next: T6.
- L21 (2026-10-20, user, then evidence): the user opened `/fotos` in the browser and sent a screenshot: sidebar entry present, the real PNG shown as a thumbnail under the month heading through the Bearer fetch and the backend proxy. The heading showed "Octubre De 2026" (CSS `capitalize`); the user answered "dale" to fixing it and it now capitalizes only the first letter. T6: README Features line and AGENTS.md (Photos API notes, thumbnail route, PhotosPage file entry) updated. Not exercised in a browser: the viewer, keyboard navigation, "load more" and HEIF, because the database holds a single image row. Open decisions still with the user: A versus B for S3 thumbnails (L6).
- L22 (2026-10-20, user, decision): "dejemos las miniaturas de S3 como están". Resolves L6: option A stays. Thumbnails exist only for Google Drive files; S3 files keep the generic icon. S3 thumbnails remain out of scope (S6).
- L23 (2026-10-20, progress, feature closed): all tasks done and merged to main. T5 and T6 shipped in PR #16. Follow-ups after the user tried the page in the browser: PR #17 added arrow-key navigation over the grid (the user's "las flechas no cambia" was about the grid, not the viewer; the viewer was verified separately with Chromium, including HEIF), PR #18 renamed the product from 9Drive to MultiDrive everywhere (the Drive folder is renamed in place, browser keys are migrated; DB names and the S3 key prefix were kept on purpose) and PR #19 replaced the "9" logo with a tilted M. The three test copies created in the user's Drive for the viewer check were deleted afterwards. Known limit: "load more" was not exercised with a library larger than one page.
