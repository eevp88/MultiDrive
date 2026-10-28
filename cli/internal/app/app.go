// Package app is the command line: it reads flags and the environment, plans the upload, sends it and reports. It is
// kept apart from main so the whole flow can be tested with a fake uploader and no process or network.
package app

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"sync"

	"github.com/eevp88/MultiDrive/cli/internal/client"
	"github.com/eevp88/MultiDrive/cli/internal/plan"
)

const (
	keyVariable        = "MULTIDRIVE_API_KEY"
	defaultMaxBytes    = int64(5) << 30 // the docker config's MAX_UPLOAD_BYTES
	defaultConcurrency = 3
	maxConcurrency     = 10

	exitOK      = 0
	exitFailed  = 1
	exitUsage   = 2
	usageHeader = "Usage: multidrive-upload [flags] <file|dir>...\n\nUploads files through the MultiDrive API key endpoint. The API key is read from the " + keyVariable + " environment variable.\n\nFlags:\n"
)

// Uploader sends one batch of files. client.Client is the real one.
type Uploader interface {
	UploadBatch(ctx context.Context, entries []plan.Entry, folderID string) (client.Result, error)
}

// Deps is everything Run needs from the outside.
type Deps struct {
	Stdout, Stderr io.Writer
	Getenv         func(string) string
	NewUploader    func(baseURL, key string) Uploader
}

// DefaultUploader builds the real HTTP client. It sets no overall timeout: an upload can legitimately take hours, and
// Ctrl+C cancels the context instead.
func DefaultUploader(baseURL, key string) Uploader {
	return &client.Client{BaseURL: baseURL, Key: key, HTTP: &http.Client{}}
}

type options struct {
	url         string
	folderID    string
	concurrency int
	dryRun      bool
	maxBytes    int64
}

// Run executes the command and returns the process exit code: 0 when everything asked was uploaded, 1 when something
// failed or was left out, 2 when the command line itself is wrong and nothing was sent.
func Run(ctx context.Context, args []string, deps Deps) int {
	opts := options{}
	flags := flag.NewFlagSet("multidrive-upload", flag.ContinueOnError)
	flags.SetOutput(deps.Stderr)
	flags.StringVar(&opts.url, "url", "", "base `URL` of MultiDrive, for example https://drive.example.com (required)")
	flags.StringVar(&opts.folderID, "folder-id", "", "upload into this existing folder (default: the root)")
	flags.IntVar(&opts.concurrency, "concurrency", defaultConcurrency, "requests sent at the same time (1 to 10)")
	flags.BoolVar(&opts.dryRun, "dry-run", false, "list what would be uploaded without sending anything or needing a key")
	flags.Int64Var(&opts.maxBytes, "max-bytes", defaultMaxBytes, "skip files larger than this many bytes")
	flags.Usage = func() {
		fmt.Fprint(deps.Stderr, usageHeader)
		flags.PrintDefaults()
	}

	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		return exitUsage
	}
	usageError := func(message string) int {
		fmt.Fprintf(deps.Stderr, "multidrive-upload: %s\n\n", message)
		flags.Usage()
		return exitUsage
	}
	switch {
	case opts.url == "":
		return usageError("--url is required")
	case opts.concurrency < 1 || opts.concurrency > maxConcurrency:
		return usageError(fmt.Sprintf("--concurrency must be between 1 and %d", maxConcurrency))
	case opts.maxBytes < 1:
		return usageError("--max-bytes must be positive")
	case flags.NArg() == 0:
		return usageError("give at least one file or directory to upload")
	}
	key := deps.Getenv(keyVariable)
	if key == "" && !opts.dryRun {
		return usageError(keyVariable + " is not set")
	}

	entries, skipped, err := plan.Collect(flags.Args(), opts.maxBytes)
	if err != nil {
		fmt.Fprintf(deps.Stderr, "multidrive-upload: %v\n", err)
		return exitUsage
	}
	blockingSkips := 0
	for _, s := range skipped {
		fmt.Fprintf(deps.Stderr, "warning: skipped %s: %s\n", s.Path, s.Reason)
		// A link is noise when walking a directory; a file that was too large or empty is a file the user wanted uploaded.
		if s.Reason != plan.ReasonNotRegular {
			blockingSkips++
		}
	}
	batches := plan.Batches(entries, plan.MaxFilesPerRequest)

	if opts.dryRun {
		var total int64
		for _, e := range entries {
			total += e.Size
			fmt.Fprintf(deps.Stdout, "would upload %s (%d bytes)\n", e.Path, e.Size)
		}
		fmt.Fprintf(deps.Stdout, "%d files, %d bytes in %d requests, skipped %d\n", len(entries), total, len(batches), len(skipped))
		return exitCode(0, 0, blockingSkips)
	}

	totals := send(ctx, deps, deps.NewUploader(opts.url, key), batches, opts)
	fmt.Fprintf(deps.Stdout, "uploaded %d, failed %d, skipped %d, not sent %d\n", totals.uploaded, totals.failed, len(skipped), totals.notSent)
	return exitCode(totals.failed, totals.notSent, blockingSkips)
}

func exitCode(failed, notSent, blockingSkips int) int {
	if failed > 0 || notSent > 0 || blockingSkips > 0 {
		return exitFailed
	}
	return exitOK
}

type totals struct{ uploaded, failed, notSent int }

// send runs the batches on a pool of workers. A bad or unauthorised key cancels the rest at once, because every other
// request would be refused the same way.
func send(parent context.Context, deps Deps, up Uploader, batches [][]plan.Entry, opts options) totals {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	var mu sync.Mutex
	var sum totals
	say := func(format string, args ...any) { // callers hold mu
		fmt.Fprintf(deps.Stdout, format+"\n", args...)
	}

	jobs := make(chan []plan.Entry, len(batches))
	for _, b := range batches {
		jobs <- b
	}
	close(jobs)

	var wg sync.WaitGroup
	for i := 0; i < opts.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for batch := range jobs {
				if ctx.Err() != nil {
					mu.Lock()
					sum.notSent += len(batch)
					mu.Unlock()
					continue
				}
				res, err := up.UploadBatch(ctx, batch, opts.folderID)
				mu.Lock()
				if err != nil {
					sum.failed += len(batch)
					say("FAIL request of %d files starting at %s: %v", len(batch), batch[0].Path, err)
					var apiErr *client.APIError
					if errors.As(err, &apiErr) && (apiErr.Status == http.StatusUnauthorized || apiErr.Status == http.StatusForbidden) {
						cancel()
					}
					mu.Unlock()
					continue
				}
				for _, f := range res.Files {
					say("ok   %s", f.Name)
				}
				for _, f := range res.Failed {
					say("FAIL %s: %s %s", f.FileName, f.Code, f.Message)
				}
				sum.uploaded += len(res.Files)
				sum.failed += len(res.Failed)
				if missing := len(batch) - len(res.Files) - len(res.Failed); missing > 0 {
					sum.failed += missing
					say("FAIL the server did not report %d of the %d files sent", missing, len(batch))
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return sum
}
