# AGENTS.md

## Project Overview

MultiDrive is a Google Drive, OneDrive and S3 storage gateway. It lets users register/login with email/password or Google, automatically connect the first Drive account during Google sign-in, connect additional Google Drive accounts, track combined quota, upload files through the backend into a dedicated Google Drive `MultiDrive` folder, organize files in virtual folders, preview/download/share files, sync MySQL file records from Google Drive, invite other users to files/folders, and route uploads to a connected Drive account with enough free space.

## Repository Structure

- `backend/`: Express API, TypeScript, Prisma schema/migrations, MySQL access, auth, Google OAuth/Drive integration.
- `frontend/`: Vite React app, protected dashboard UI, file/folder management, sharing, uploads, quota/settings pages.
- `docker-compose.yml`: MySQL, backend, and nginx-served frontend services.
- `.env.docker.example`: Docker environment template.
- `README.md`: local setup, Google Cloud setup, Docker notes, deployment notes.

## Requirements

- Node.js 20+
- npm
- MySQL 8+
- Google Cloud project with Google Drive API enabled
- Google OAuth client ID and secret

## Backend

Stack:
- Express 5
- TypeScript
- Prisma 6
- MySQL
- Zod
- JWT bearer auth
- Argon2 password hashing
- Busboy streaming uploads
- Google APIs client
- Undici for Google file streaming

Important files:
- `backend/src/server.ts`: server entrypoint.
- `backend/src/app.ts`: Express app and route mounting.
- `backend/src/config/env.ts`: environment validation.
- `backend/src/config/prisma.ts`: Prisma client.
- `backend/prisma/schema.prisma`: database schema.
- `backend/src/middleware/auth.middleware.ts`: bearer auth.
- `backend/src/middleware/error.middleware.ts`: JSON error responses.
- `backend/src/modules/**`: feature route modules and provider services.
- `backend/src/modules/files/stream-google-file.ts`: Google file preview/download streaming.
- `backend/src/modules/microsoft/microsoft.service.ts`: OneDrive (Microsoft Graph) tokens with refresh rotation, quota, app folder, sync, upload sessions, content, thumbnails, rename and delete. `microsoft.routes.ts` holds the connect flow. `stream-microsoft-file.ts` streams OneDrive files. Add a new provider the same way: a `modules/<provider>/` service, a branch in each dispatcher below, and `modules/storage/sync-quota.ts`.
- `backend/src/scripts/seed-microsoft-config.ts`: stores the encrypted Microsoft OAuth app (`npm run seed:microsoft-config`, skipped when the variables are empty).
- `backend/src/scripts/seed-google-config.ts`: stores encrypted global Google OAuth config.

Commands:
- `cd backend && npm run dev`: start development server.
- `cd backend && npm run build`: typecheck/build backend.
- `cd backend && npm run start`: run compiled backend from `dist/server.js`.
- `cd backend && npm test`: run the Vitest suite (`src/**/*.test.ts`, needs Node 22+). Tests set their own environment in `backend/vitest.config.mts`, never read a `.env`, and never reach a real Google account or database.
- `cd backend && TEST_DATABASE_URL=mysql://... npm run test:integration`: run the HTTP integration tests (`src/**/*.int.test.ts`) against a throwaway MySQL with the migrations applied (`prisma migrate deploy`). The database name must end in `_test` or the run refuses to start, and every table is truncated before each test. Google is faked.
- `cd backend && npm run prisma:migrate`: run Prisma dev migration.
- `cd backend && npm run prisma:generate`: regenerate Prisma client.
- `cd backend && npm run seed:google-config`: store encrypted Google OAuth config.

Environment:
- `DATABASE_URL`
- `APP_PORT`
- `FRONTEND_URL`
- `JWT_ACCESS_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `RECAPTCHA_SECRET_KEY` (optional; enables captcha verification when paired with frontend site key)
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_DAYS`
- `MAX_UPLOAD_BYTES`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (optional; enable OneDrive, see README "OneDrive Setup")

Backend conventions:
- Put route logic under `backend/src/modules/<feature>/<feature>.routes.ts`.
- Mount new routers in `backend/src/app.ts`.
- Use `requireAuth` for authenticated routes.
- Use `AuthRequest` when accessing `req.user`.
- Validate request bodies/query params with Zod.
- Use Prisma from `backend/src/config/prisma.ts`.
- Return JSON errors with stable `code` and human-readable `message`.
- Pass unexpected errors to `next(error)`.
- Never put a raw `error.message` in a response: it can carry file paths, query arguments or provider response bodies. Throw `HttpError` (`backend/src/utils/http-error.ts`) for messages meant for the client. The global handler maps Zod errors to 400, Prisma not found and unique violations to 404 and 409, body-parser errors to 400 and 413, and everything else to a generic 500.
- Routes that build their own error responses (batch results, `failed[]`) use `clientMessage(error, fallback)` and log with `describeError(error)`.
- Every new error `code` the UI can show needs an `error.<CODE>` entry in `frontend/src/i18n/en.ts` and `es.ts`.
- In upload handlers register stream `error` listeners before any `await`: an unhandled stream error exits the whole process.
- Convert `bigint` values to strings before sending JSON responses.
- Keep Google-specific OAuth/Drive behavior in provider modules/services when possible.
- Keep public-token routes outside `requireAuth`; verify token hash, status, and expiry before streaming/returning data.
- Google sign-in/register uses one-time auth handoff tokens; never send app access/refresh tokens through URL query params.
- Email/password registration verifies reCAPTCHA only when `RECAPTCHA_SECRET_KEY` is configured.

Security rules:
- Never commit `.env` files or secrets.
- Never log access tokens, refresh tokens, OAuth client secrets, JWT secrets, encryption keys, or raw public share tokens.
- Google and Microsoft tokens are encrypted before database storage. Microsoft rotates the refresh token on every refresh, so the new one must be stored each time.
- A OneDrive upload session URL (`providerSessionUri`) is pre-authenticated: call it without an `Authorization` header and never log or return it.
- App refresh tokens are hashed before database storage.
- Auth handoff, share, and preview tokens are stored as hashes where applicable.
- Public share tokens are looked up by `tokenHash` only. The raw token, kept so a link can be shown again, is stored encrypted (`backend/src/utils/share-token.ts`).
- `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY`, `MYSQL_ROOT_PASSWORD` and `MYSQL_PASSWORD` have no defaults, and `env.ts` rejects secrets that start with `change-this` or `replace-with`.
- `TRUST_PROXY` is a hop count (default 1, use 0 when the backend is exposed directly). Never set `trust proxy` to `true`: it trusts a client controlled header.
- Login and register are rate limited (`backend/src/middleware/rate-limit.middleware.ts`).
- Uploaded files must stream through backend to Google Drive folder `MultiDrive`; do not store uploaded files on disk.
- Never grant Google Drive permissions automatically. Uploads and `GET /files/:id/view-url` leave the file private; `view-url` returns the Drive link only if the file is already public and `url: null` otherwise, so the UI falls back to a MultiDrive share link (read only, revocable). Only the explicit `POST /files/:id/public-permission` opens a Drive file, as `anyone` with `reader`. MultiDrive has no way to remove a Drive permission, so never use `writer` for `anyone`.
- Keep CORS restricted by `FRONTEND_URL`.
- Keep auth/token storage behavior centralized; do not change without explicit reason.

Database rules:
- Change DB schema through Prisma schema and migrations.
- Do not hand-edit generated Prisma client files.
- After schema changes, run Prisma migration/generation and backend build.
- Add indexes for new common filters before relying on them in hot paths.

## Frontend

Stack:
- React 19
- Vite 8
- TypeScript
- React Router 7
- Tailwind CSS 4
- lucide-react
- class-variance-authority
- clsx
- tailwind-merge

Important files:
- `frontend/src/main.tsx`: React entrypoint.
- `frontend/src/App.tsx`: route registration.
- `frontend/src/layouts/DriveLayout.tsx`: protected app shell, sidebar, header search, storage sidebar stats.
- `frontend/src/pages/AllFilesPage.tsx`: core file/folder UI, uploads, context menus, preview, share/invite modals.
- `frontend/src/pages/PhotosPage.tsx`: `/fotos` photo gallery (month-grouped grid, `components/photos/**` for thumbnail and viewer).
- `frontend/src/pages/SharedPage.tsx`: shared links and invites UI.
- `frontend/src/pages/QuotaTrackerPage.tsx`: connected-account quota UI.
- `frontend/src/pages/SettingsPage.tsx`: Google account/settings UI.
- `frontend/src/pages/GoogleAuthPage.tsx`: Google auth handoff exchange page.
- `frontend/src/pages/PublicFilePage.tsx`: public shared file viewer/embed page.
- `frontend/src/components/auth/GoogleLogo.tsx`: Google button logo.
- `frontend/src/components/drive/**`: drive-specific UI components.
- `frontend/src/components/ui/**`: reusable UI primitives.
- `frontend/src/lib/api.ts`: API helper, token refresh retry, formatting utilities.
- `frontend/src/lib/auth.ts`: local auth session storage.
- `frontend/src/lib/plyr.ts`: video preview player loading.
- `frontend/src/style.css`: Tailwind import and global styles.

Commands:
- `cd frontend && npm run dev`: start Vite dev server.
- `cd frontend && npm run build`: typecheck/build frontend.
- `cd frontend && npm test`: run the Vitest suite (`src/**/*.test.{ts,tsx}`, jsdom + Testing Library, needs Node 22+). Config in `frontend/vitest.config.mts`, shared setup in `src/test/`. Tests never reach the network: `fetch` is stubbed.
- `cd frontend && npm run preview`: preview production build.

Environment:
- `VITE_API_URL`: backend base URL. Vite embeds this at build time.
- `VITE_RECAPTCHA_SITE_KEY`: optional reCAPTCHA site key. Vite embeds this at build time; blank disables captcha UI.

Frontend conventions:
- Use `@/*` imports for files under `frontend/src`.
- Keep route registration in `frontend/src/App.tsx`.
- Use `apiFetch` for normal JSON API calls.
- Use raw `fetch` or `XMLHttpRequest` only when response streaming/blob/progress requires it.
- Keep access/refresh token handling centralized in `frontend/src/lib/api.ts` and `frontend/src/lib/auth.ts`.
- Use existing `Button`, `Card`, and `Input` primitives before adding new UI primitives.
- Use `cn` from `frontend/src/lib/utils.ts` for conditional class names.
- Preserve current Tailwind visual style unless task explicitly asks redesign.
- Keep protected dashboard pages inside `ProtectedRoute` and `DriveLayout`.
- Keep file/folder URL state in query params when it affects navigation, e.g. `folderId` and file search `q`.

## API Notes

General:
- `GET /health`
- Authenticated routes expect `Authorization: Bearer <accessToken>` unless listed as public.

Auth:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/google/url`
- `GET /auth/google/callback`
- `POST /auth/google/exchange`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

Provider configs:
- `POST /provider-configs/google`
- `GET /provider-configs`
- `DELETE /provider-configs/:id`

Google connected accounts:
- `GET /connected-accounts/google/connect-url`
- `GET /connected-accounts/google/connect`
- `GET /connected-accounts/google/callback`
- `GET /connected-accounts`
- `POST /connected-accounts/:id/sync-quota`
- `DELETE /connected-accounts/:id`

OneDrive connected accounts (personal Microsoft accounts):
- `GET /connected-accounts/onedrive/connect-url`
- `GET /connected-accounts/onedrive/connect`
- `GET /connected-accounts/onedrive/callback`: every outcome redirects to `/google-connected?status=...&provider=onedrive`.
- Returns 409 `MICROSOFT_NOT_CONFIGURED` when no active Microsoft config was seeded.

Storage:
- `GET /storage/summary`
- `GET /storage/breakdown`

Photos:
- `GET /photos?limit=<1-200>&cursor=<opaque>`: active image and video files of the user, newest first by `COALESCE(taken_at, created_at)` then id. Returns `{ files, nextCursor }`; pass `nextCursor` back as `cursor`. Each file has `displayDate` and `hasThumbnail` (true for Google Drive files). An invalid cursor returns 400 `INVALID_CURSOR`.
- `GET /files/:id/thumbnail?size=<32-2048>` (default 320): streams a Drive thumbnail for Google Drive files (404 `THUMBNAIL_UNAVAILABLE` otherwise). The Drive link is signed and works without auth, so it is only used server side and never returned. The frontend loads it with `fetch` plus the Bearer token and shows an object URL, since `<img>` cannot send headers and tokens never go in URLs.
- `files.taken_at` is filled by the Google sync from `imageMediaMetadata.time`; uploads stay null until the next sync.

Folders:
- `GET /folders?parentId=<id>`
- `GET /folders?all=1`
- `GET /folders/recent?limit=4`
- `POST /folders`
- `PATCH /folders/:id`
- `DELETE /folders/:id`

Files:
- `GET /files`
- `GET /files?folderId=<id>`
- `PATCH /files/:id` and `PATCH /files/batch` with `folderId`: a Google Drive file is moved in Drive too (the sync reads its folder from there), and only into a folder mirrored in its own account, otherwise 400 `FOLDER_NOT_ON_ACCOUNT`. The batch answers `{ moved, failed[] }` (400 when nothing could be moved). OneDrive and S3 files keep their folders in the database.
- `DELETE /folders/:id` deletes the folder and its files from the provider. Files really gone (and Google files already in the trash inside a removed Drive folder) are removed from MySQL; files that could not be deleted go to the trash (`status: deleted`). A folder Drive could not remove is not marked deleted and the request answers 502 `FOLDER_DELETE_FAILED`. `DELETE /files/batch/permanent` treats a file that is already gone from its provider as deleted.
- `GET /files?rootOnly=1`: only the files that are not inside a folder (what All Files shows at the root when nothing is searched or filtered).
- `GET /files?q=<search>`
- `GET /files/shared-links`
- `GET /files/:id`
- `PATCH /files/:id`
- `PATCH /files/batch`
- `DELETE /files/batch`
- `POST /files/sync-google`
- `POST /files/:id/share`
- `DELETE /files/:id/share`
- `POST /files/:id/preview-token`
- `GET /files/:id/view-url`
- `GET /files/:id/thumbnail?size=<32-2048>`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /files/preview/:token`

Invites:
- `GET /invites`
- `POST /invites`
- `DELETE /invites/:id`

Public shared files:
- `GET /public/files/:token`
- `GET /public/files/:token/download`
- `GET /public/files/:token/preview`

Uploads:
- `POST /uploads`
- Content type: `multipart/form-data`.
- Current frontend sends metadata first as `filesMeta`: JSON array of `{ fieldName, fileName, mimeType, sizeBytes, folderId? }`.
- File fields then match `filesMeta[*].fieldName`, e.g. `file-0`, `file-1`.
- Backend selects a connected Drive account with enough available quota and streams each file directly to Google Drive.
- Google Drive uploads are placed under the root Drive folder named `MultiDrive`; folders created in the app are mirrored in Drive, and Drive subfolders are imported by the sync.
- OneDrive accounts take part in the same routing. Files up to 4 MiB use a simple upload; larger ones use a Graph upload session with 10 MiB chunks. Both `POST /uploads` and the resumable endpoints (`/uploads/resumable/init`, `/status/:id`, `/chunk/:id`, which the web UI uses) support OneDrive. A same-name upload is renamed by OneDrive instead of replacing the file. Files live in the OneDrive folder `MultiDrive`; virtual folders stay database-only.
- `POST /files/sync-google` treats Google Drive folder `MultiDrive` as source of truth for physical files and folders: it walks the whole subfolder tree, creates or updates the matching `folders` rows (name and parent, restoring a soft-deleted one that exists again), soft-deletes mirrored folders that no longer exist in Drive (folders without `providerFolderId` are left alone), creates missing MySQL file rows, updates changed metadata (including the folder a file sits in), and marks missing Drive files as deleted. A file it marks as deleted because it disappeared gets `deletedBySync: true` and comes back when it reappears; a file trashed in the app (`deletedBySync: false`) is never touched, so it stays in the trash until it is restored there (same for OneDrive). It also syncs OneDrive accounts (same rules, folder `MultiDrive`).

## Docker

Commands:
- `docker compose up -d --build`: build and start MySQL, backend, frontend.
- `docker compose exec backend npm run seed:google-config`: seed Google config inside backend container.
- `docker compose exec backend npm run seed:microsoft-config`: seed the OneDrive (Microsoft) config.
- `docker compose logs -f backend`: backend logs.
- `docker compose logs -f frontend`: frontend logs.
- `docker compose logs -f mysql`: MySQL logs.
- `docker compose down`: stop services.
- `docker compose down -v`: stop services and remove DB volume.

Docker notes:
- MySQL image is `mysql:8.4`.
- Backend listens on `4000`.
- Frontend build is served by nginx on host port `5173`.
- Frontend build arg `VITE_API_URL` is embedded at build time.
- Rebuild frontend when `VITE_API_URL` changes.

## Verification

Before finishing backend changes:
- `cd backend && npm run build`
- `cd backend && npm test`

Before finishing frontend changes:
- `cd frontend && npm run build`
- `cd frontend && npm test`

Before finishing schema changes:
- `cd backend && npm run prisma:migrate`
- `cd backend && npm run build`

Manual smoke test:
- Register/login.
- Open Settings.
- Connect Google Drive.
- Verify connected account appears.
- Open Quota Tracker and sync quota.
- Create nested folders in All Files.
- Use header search for an uploaded file name.
- Upload one or more files and verify progress panel.
- Switch file list/grid view.
- Right-click file and test preview/download/rename/move/share/invite/delete where relevant.
- Open Shared page and verify shared links/invites.
- Open public file link and test preview/download.

## Agent Rules

- Prefer small, targeted changes.
- Preserve existing architecture and naming.
- Do not introduce new dependencies unless necessary.
- Do not commit secrets.
- Do not edit `node_modules`, build output, or generated Prisma client.
- Do not change auth/token storage behavior without explicit reason.
- Do not change Google OAuth scopes or redirect behavior without checking README and env requirements.
- Do not change upload behavior to write files to disk.
