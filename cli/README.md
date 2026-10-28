# multidrive-upload

A command line uploader for MultiDrive, written in Go with the standard library only. It sends files through the API key
endpoint, `POST /api/v1/uploads`, so it needs no login: create a key in **API Keys** in the web app.

## Build

```bash
cd cli
go build -o multidrive-upload ./cmd/multidrive-upload
```

Go 1.24 or newer.

## Use

```bash
export MULTIDRIVE_API_KEY=9d_live_...        # never pass the key as an argument: arguments show up in `ps`
./multidrive-upload --url https://drive.example.com ./photos ./report.pdf
```

Flags go **before** the files and folders:

| Flag | Default | |
|---|---|---|
| `--url` | required | Base URL of MultiDrive. The CLI adds `/api/v1/uploads`. |
| `--folder-id` | root | Upload into an existing folder. Take its id from the app. |
| `--concurrency` | 3 | Requests sent at the same time, 1 to 10. |
| `--max-bytes` | 5 GiB | Skip files larger than this. Match the server's `MAX_UPLOAD_BYTES`. |
| `--dry-run` | off | List what would be uploaded. Sends nothing and needs no key. |

Directories are walked recursively. Files are sent in requests of at most 25 and streamed from disk, so memory does not
grow with file size. Ctrl+C stops the run.

## What it prints and returns

One line per file (`ok name` or `FAIL name: CODE message`) and a summary:
`uploaded 3, failed 1, skipped 0, not sent 0`. The key is never printed.

| Exit code | Meaning |
|---|---|
| 0 | Everything asked was uploaded. |
| 1 | A file failed, was not sent, or a file that is too large or empty was skipped. |
| 2 | The command line is wrong or a path does not exist. Nothing was sent. |

A bad or unauthorised key stops the run at the first request; the rest is counted as `not sent`.

## Limits to know about

- **Folders are not recreated.** An API key cannot create folders (`POST /folders` needs a login token), so files go to the
  root or to a folder that already exists (`--folder-id`).
- **Empty files are skipped.** `POST /uploads` rejects a size of 0.
- **Symlinks and special files are skipped** and reported, so a link loop or a link to a file outside the folder is never followed.
- **No retry.** The server does not deduplicate, so a repeated upload would create a copy. Rerun only what is listed as failed.
- No overall timeout: an upload can take hours.

## Tests

```bash
cd cli
go vet ./... && go test -race ./...          # unit tests, no network
```

The end to end check runs the real binary against the real backend of the isolated docker stack in `../e2e`:

```bash
cd e2e && npm run stack:up
cd ../cli && go test -tags e2e ./e2e
```

That stack has no Drive account, so no file is stored: the check proves that the server accepts the key, the multipart body,
`filesMeta` and the folder id (it answers `NO_ACCOUNT_WITH_ENOUGH_SPACE` for each file) and that a wrong or revoked key is
refused. It cannot prove that the declared `sizeBytes` is exact, because the server only counts the bytes once a storage
account takes the file. Registering is rate limited to 10 per hour per backend process; this check uses 1.
