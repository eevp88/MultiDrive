# onedrive-provider

Objective: add Microsoft OneDrive (personal accounts) as a third storage provider next to `google_drive` and `s3`.
Branch: `feat/onedrive-provider` | Delivery strategy: `stacked-to-main` (assumed, same as photos-gallery L8) | Test runner: none (backend and frontend have no test script)

## Specs

Quotes are the user's exact words. Items marked (assumption) come from the assistant's proposal and can be changed.

- S1. "agreguemos mas proveedores" and "dale, con OneDrive": OneDrive is the first new provider. Dropbox is out of this feature and comes later with the same pattern.
- S2. (assumption) Personal Microsoft accounts only ("es un hotmail.com"). OAuth 2.0 authorization code flow against the `consumers` endpoint, scopes `Files.ReadWrite offline_access User.Read`, the Microsoft Graph API for everything else. Work and school accounts are out of scope.
- S3. (assumption) `provider` is a free string column, so the value `onedrive` needs no migration. OAuth app credentials are stored like Google's: a global `ProviderConfig` row with encrypted client id and secret, seeded from `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_REDIRECT_URI`.
- S4. (assumption) Connect and token handling: the connected account stores encrypted tokens; the access token is refreshed before it expires and the new refresh token Microsoft returns on each refresh is persisted; a failed refresh throws `HttpError(409, 'ACCOUNT_RECONNECT_REQUIRED')`.
- S5. (assumption) Quota comes from `GET /me/drive` (`quota.total`, `used`, `remaining`) into `StorageAccount`, and OneDrive accounts take part in upload routing (`most_available`, `round_robin`, `priority`).
- S6. (assumption) Files live under a root OneDrive folder named `MultiDrive`, created on first use. Virtual folders stay app and database only; no provider folders are created. Sync mirrors `syncGoogleAppFolderFiles`: create, update and soft-delete `File` rows.
- S7. (assumption) Uploads stream through the backend using Graph upload sessions (chunks of a multiple of 320 KiB); nothing is written to disk. Download, preview, batch download, rename, move, permanent delete and the share and public routes work for OneDrive files through the existing dispatchers.
- S8. (assumption) Photos: OneDrive images get thumbnails from Graph (`/items/{id}/thumbnails`) through the existing `GET /files/:id/thumbnail`, and `takenAt` comes from `photo.takenDateTime`, so they show in `/fotos`. `hasThumbnail` is true for `onedrive`.
- S9. (assumption) Frontend: a "Connect OneDrive" action in Settings and the quota page, provider labels and icon, i18n in `en.ts` and `es.ts`, new error codes with `error.<CODE>` entries. Existing Google wording stays Google.
- S10. Out of scope: Microsoft sign-in to MultiDrive, resumable chunk endpoints driven by the browser (`/uploads/resumable/*` stay Google-only), `public-permission` for OneDrive (share links stay MultiDrive links), provider folders, delta sync, Dropbox, any change to Google behavior.
- S11. Project rules that apply: tokens encrypted before storage and never logged, no raw `error.message` in responses (`HttpError`, `clientMessage`, `describeError`), Zod validation, `bigint` as strings, README and AGENTS.md updated including an Azure app registration guide, files never stored on disk.

## Tasks

- [x] T1 | S2, S4, S5, S6 | inline | `microsoft.service.ts`: Graph client, token refresh with rotation, quota sync, app folder, file sync; commit: 7f1e230 (14 checks against a mocked Graph, see L4)
- [ ] T2 | S2, S3 | inline | seed script and env vars, connect-url and callback routes, `ProviderConfig` for `onedrive`; commit: pending
- [ ] T3 | S5, S7 | inline | upload routing and streamed upload through Graph upload sessions; commit: pending
- [ ] T4 | S7 | inline | download, preview, batch download, rename, move, permanent delete, sync route; commit: pending
- [ ] T5 | S8 | inline | thumbnails, `takenAt`, `hasThumbnail` for `onedrive`; commit: pending
- [ ] T6 | S9 | inline | frontend connect flow, labels, icons, i18n, quota page; commit: pending
- [ ] T7 | S11 | inline | README Azure registration guide, AGENTS.md notes, end-to-end check with the user's hotmail account; commit: pending

Route declaration: every task inline, sequential, sharing files; no writer trigger applies. Exploration was one read-only explorer (map of every provider branch point), see L2.

Test policy exception: no runnable test framework, so verification is `npm run build`, scratch scripts against the running stack, and a final check with a real OneDrive account. That check needs the user to register an app in Azure and connect the hotmail account; anything created in the user's OneDrive needs their authorization first.

Forecast: about 1200 authored changed lines, above the 400 heuristic. Slices (one PR each against `main`, in order): PR 1 = this document and T1; PR 2 = T2; PR 3 = T3 and T4; PR 4 = T5; PR 5 = T6 and T7. Push, PR creation and merge are the user's decisions.

## Log

- L1 (2026-10-20, user, original request): agreguemos mas proveedores
- L1b (2026-10-20, user, earlier context): "y en onedrive", "es otro correo", "es un hotmail.com", and now "dale, con OneDrive"
- L2 (2026-10-20, evidence, explorer map): `provider` is a plain VarChar(32) on ConnectedAccount, ProviderConfig, File and Folder. Dispatch is hand written `if s3 else Google` in about ten places: `streamProviderFile`, `syncQuotaForAccount`, `selectAccount`, upload create and resumable, `batch-download`, permanent delete, rename, folders, sync route, `thumbnail.ts`, `photos.routes.ts`. Several sites hardcode `'google_drive'` (File rows in `upload.routes.ts`, folder routes). `UploadSession.googleSessionUri` is Google specific. OAuth config is a global `ProviderConfig` row seeded from `GOOGLE_*` env vars by scripts. The frontend branches on provider in Settings, QuotaTracker, AllFiles and DriveLayout.
- L3 (2026-10-20, decision, assumption): scope and delivery strategy proposed by the assistant, see S2 to S10.
- L4 (2026-10-20, evidence, T1): `backend/src/modules/microsoft/microsoft.service.ts` verified with a scratch script that replaces `fetch` with canned Graph and token responses (real database, a throwaway user and account, all removed afterwards). 14 checks pass: quota into `StorageAccount`; app folder created when missing; two result pages followed; subfolders ignored; created, updated and soft-deleted rows; `takenAt` kept only when valid (missing, future and `0001` dates become null); a file's virtual folder is untouched by sync; a still valid token does not call Microsoft; refresh stores the rotated refresh token encrypted; `invalid_grant` gives 409 `ACCOUNT_RECONNECT_REQUIRED`; any other token failure gives 502 `MICROSOFT_API_ERROR` without provider text; Graph 500 gives a `GraphError` that carries only status and code. Not observed: the real Graph API, because no Microsoft app is registered yet; the real endpoints, field names (`photo.takenDateTime`, `quota`) and the refresh rotation are taken from the Graph documentation and still need the T7 check with the user's account. `MICROSOFT_API_ERROR` still needs its `error.<CODE>` i18n entries (T6).
