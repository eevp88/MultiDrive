package app

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/eevp88/MultiDrive/cli/internal/client"
	"github.com/eevp88/MultiDrive/cli/internal/plan"
)

const key = "mdk_test_key_that_must_never_be_printed"

type fakeUploader struct {
	mu          sync.Mutex
	calls       [][]plan.Entry
	folders     []string
	inflight    int
	maxInflight int
	delay       time.Duration
	respond     func(call int, entries []plan.Entry) (client.Result, error)
}

func (f *fakeUploader) UploadBatch(ctx context.Context, entries []plan.Entry, folderID string) (client.Result, error) {
	f.mu.Lock()
	call := len(f.calls)
	f.calls = append(f.calls, entries)
	f.folders = append(f.folders, folderID)
	f.inflight++
	if f.inflight > f.maxInflight {
		f.maxInflight = f.inflight
	}
	f.mu.Unlock()
	defer func() { f.mu.Lock(); f.inflight--; f.mu.Unlock() }()
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.respond != nil {
		return f.respond(call, entries)
	}
	var res client.Result
	for _, e := range entries {
		res.Files = append(res.Files, client.Uploaded{ID: "id-" + e.Name, Name: e.Name})
	}
	return res, nil
}

type run struct {
	code     int
	out, err string
	up       *fakeUploader
	apiKeys  []string
}

func files(t *testing.T, n int) string {
	t.Helper()
	dir := t.TempDir()
	for i := 0; i < n; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%03d.txt", i)), []byte("data"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func exec(t *testing.T, up *fakeUploader, env map[string]string, args ...string) run {
	t.Helper()
	var out, errOut bytes.Buffer
	r := run{up: up}
	code := Run(context.Background(), args, Deps{
		Stdout: &out,
		Stderr: &errOut,
		Getenv: func(k string) string { return env[k] },
		NewUploader: func(baseURL, apiKey string) Uploader {
			r.apiKeys = append(r.apiKeys, apiKey)
			return up
		},
	})
	r.code, r.out, r.err = code, out.String(), errOut.String()
	return r
}

var withKey = map[string]string{"MULTIDRIVE_API_KEY": key}

func TestNothingToUploadIsAUsageError(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x")

	if r.code != 2 || len(r.up.calls) != 0 || !strings.Contains(r.err, "Usage") {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
}

func TestAMissingUrlIsAUsageError(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, files(t, 1))

	if r.code != 2 || !strings.Contains(r.err, "--url") || len(r.up.calls) != 0 {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
}

func TestAMissingKeyIsAUsageErrorThatNamesTheVariable(t *testing.T) {
	r := exec(t, &fakeUploader{}, nil, "--url", "http://x", files(t, 1))

	if r.code != 2 || !strings.Contains(r.err, "MULTIDRIVE_API_KEY") || len(r.up.calls) != 0 {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
}

func TestTheKeyIsReadFromTheEnvironmentAndHandedToTheUploader(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", files(t, 1))

	if len(r.apiKeys) != 1 || r.apiKeys[0] != key {
		t.Fatalf("keys %v", r.apiKeys)
	}
}

func TestAnInvalidConcurrencyIsAUsageError(t *testing.T) {
	for _, n := range []string{"0", "-1", "11"} {
		r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", "--concurrency", n, files(t, 1))
		if r.code != 2 || !strings.Contains(r.err, "--concurrency") {
			t.Fatalf("concurrency %s: code=%d err=%q", n, r.code, r.err)
		}
	}
}

func TestAMissingPathIsAUsageErrorAndNothingIsSent(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", filepath.Join(t.TempDir(), "nope"))

	if r.code != 2 || len(r.up.calls) != 0 || !strings.Contains(r.err, "nope") {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
}

func TestDryRunListsTheFilesWithoutAKeyOrANetworkCall(t *testing.T) {
	dir := files(t, 3)

	r := exec(t, &fakeUploader{}, nil, "--url", "http://x", "--dry-run", dir)

	if r.code != 0 || len(r.up.calls) != 0 || len(r.apiKeys) != 0 {
		t.Fatalf("code=%d calls=%d keys=%v", r.code, len(r.up.calls), r.apiKeys)
	}
	if strings.Count(r.out, "would upload") != 3 || !strings.Contains(r.out, "3 files") {
		t.Fatalf("out %q", r.out)
	}
}

func TestUploadsEveryFileAndSummarisesWithExitZero(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", files(t, 3))

	if r.code != 0 {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
	if strings.Count(r.out, "ok ") != 3 || !strings.Contains(r.out, "uploaded 3, failed 0, skipped 0, not sent 0") {
		t.Fatalf("out %q", r.out)
	}
}

func TestSplitsIntoRequestsOfAtMost25Files(t *testing.T) {
	up := &fakeUploader{}

	r := exec(t, up, withKey, "--url", "http://x", "--concurrency", "1", files(t, 60))

	sizes := []int{}
	for _, c := range up.calls {
		sizes = append(sizes, len(c))
	}
	if r.code != 0 || fmt.Sprint(sizes) != "[25 25 10]" {
		t.Fatalf("code=%d sizes=%v", r.code, sizes)
	}
}

func TestNeverRunsMoreRequestsAtOnceThanTheConcurrencyAsksFor(t *testing.T) {
	up := &fakeUploader{delay: 20 * time.Millisecond}

	r := exec(t, up, withKey, "--url", "http://x", "--concurrency", "2", files(t, 125))

	if r.code != 0 || up.maxInflight > 2 || up.maxInflight < 2 {
		t.Fatalf("code=%d maxInflight=%d", r.code, up.maxInflight)
	}
}

func TestPassesTheFolderIdToEveryRequest(t *testing.T) {
	up := &fakeUploader{}

	exec(t, up, withKey, "--url", "http://x", "--folder-id", "folder-9", files(t, 30))

	if len(up.folders) != 2 || up.folders[0] != "folder-9" || up.folders[1] != "folder-9" {
		t.Fatalf("folders %v", up.folders)
	}
}

func TestAFileTheServerRefusedIsReportedAndMakesTheExitCodeOne(t *testing.T) {
	up := &fakeUploader{respond: func(_ int, entries []plan.Entry) (client.Result, error) {
		return client.Result{
			Files:  []client.Uploaded{{ID: "1", Name: entries[0].Name}},
			Failed: []client.Failure{{FileName: entries[1].Name, Code: "UPLOAD_SIZE_MISMATCH", Message: "Streamed byte count did not match declared size."}},
		}, nil
	}}

	r := exec(t, up, withKey, "--url", "http://x", files(t, 2))

	if r.code != 1 || !strings.Contains(r.out, "FAIL f001.txt: UPLOAD_SIZE_MISMATCH") || !strings.Contains(r.out, "uploaded 1, failed 1") {
		t.Fatalf("code=%d out=%q", r.code, r.out)
	}
}

func TestARequestLevelErrorFailsEveryFileOfThatRequestWithoutLeakingTheKey(t *testing.T) {
	up := &fakeUploader{respond: func(int, []plan.Entry) (client.Result, error) {
		return client.Result{}, &client.APIError{Status: 500, Code: "INTERNAL_SERVER_ERROR", Message: "boom"}
	}}

	r := exec(t, up, withKey, "--url", "http://x", files(t, 3))

	if r.code != 1 || !strings.Contains(r.out, "uploaded 0, failed 3") || !strings.Contains(r.out+r.err, "INTERNAL_SERVER_ERROR") {
		t.Fatalf("code=%d out=%q err=%q", r.code, r.out, r.err)
	}
	if strings.Contains(r.out+r.err, key) {
		t.Fatal("the key was printed")
	}
}

func TestABadKeyStopsTheRemainingRequests(t *testing.T) {
	up := &fakeUploader{respond: func(int, []plan.Entry) (client.Result, error) {
		return client.Result{}, &client.APIError{Status: 401, Code: "API_KEY_INVALID", Message: "Invalid API key."}
	}}

	r := exec(t, up, withKey, "--url", "http://x", "--concurrency", "1", files(t, 60))

	if r.code != 1 || len(up.calls) != 1 || !strings.Contains(r.out, "failed 25, skipped 0, not sent 35") {
		t.Fatalf("code=%d calls=%d out=%q", r.code, len(up.calls), r.out)
	}
}

func TestAServerThatDoesNotAccountForEveryFileCountsTheMissingOnesAsFailed(t *testing.T) {
	up := &fakeUploader{respond: func(_ int, entries []plan.Entry) (client.Result, error) {
		return client.Result{Files: []client.Uploaded{{ID: "1", Name: entries[0].Name}}}, nil
	}}

	r := exec(t, up, withKey, "--url", "http://x", files(t, 3))

	if r.code != 1 || !strings.Contains(r.out, "uploaded 1, failed 2") {
		t.Fatalf("code=%d out=%q", r.code, r.out)
	}
}

func TestAFileOverTheLimitIsSkippedWithAWarningAndMakesTheExitCodeOne(t *testing.T) {
	dir := files(t, 2)
	if err := os.WriteFile(filepath.Join(dir, "big.bin"), []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}

	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", "--max-bytes", "5", dir)

	if r.code != 1 || !strings.Contains(r.err, "big.bin") || !strings.Contains(r.out, "uploaded 2, failed 0, skipped 1") {
		t.Fatalf("code=%d out=%q err=%q", r.code, r.out, r.err)
	}
}

func TestASymlinkIsReportedButDoesNotMakeTheExitCodeOne(t *testing.T) {
	dir := files(t, 1)
	if err := os.Symlink(filepath.Join(dir, "f000.txt"), filepath.Join(dir, "link.txt")); err != nil {
		t.Skip("symlinks not available:", err)
	}

	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", dir)

	if r.code != 0 || !strings.Contains(r.err, "link.txt") || !strings.Contains(r.out, "skipped 1") {
		t.Fatalf("code=%d out=%q err=%q", r.code, r.out, r.err)
	}
}

func TestAnEmptyFileIsSkippedAndMakesTheExitCodeOne(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "empty.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	r := exec(t, &fakeUploader{}, withKey, "--url", "http://x", dir)

	if r.code != 1 || !strings.Contains(r.err, "empty.txt") {
		t.Fatalf("code=%d err=%q", r.code, r.err)
	}
}

func TestACancelledRunSendsNothingMoreAndCountsTheRestAsNotSent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	up := &fakeUploader{respond: func(call int, entries []plan.Entry) (client.Result, error) {
		cancel()
		return client.Result{Files: []client.Uploaded{{ID: "1", Name: entries[0].Name}}}, nil
	}}
	var out, errOut bytes.Buffer

	code := Run(ctx, []string{"--url", "http://x", "--concurrency", "1", files(t, 60)}, Deps{
		Stdout: &out, Stderr: &errOut, Getenv: func(string) string { return key },
		NewUploader: func(string, string) Uploader { return up },
	})

	if code != 1 || len(up.calls) != 1 || !strings.Contains(out.String(), "not sent 35") {
		t.Fatalf("code=%d calls=%d out=%q", code, len(up.calls), out.String())
	}
}

func TestHelpPrintsUsageAndExitsZero(t *testing.T) {
	r := exec(t, &fakeUploader{}, nil, "-h")

	if r.code != 0 || !strings.Contains(r.err+r.out, "Usage") {
		t.Fatalf("code=%d out=%q err=%q", r.code, r.out, r.err)
	}
}

func TestAnUnknownFlagIsAUsageError(t *testing.T) {
	r := exec(t, &fakeUploader{}, withKey, "--nope", files(t, 1))

	if r.code != 2 {
		t.Fatalf("code=%d", r.code)
	}
}

func TestTheRealClientSendsTheKeyAsABearerTokenToTheGivenUrl(t *testing.T) {
	var auth, path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"files":[{"id":"1","name":"f000.txt"}],"failed":[]}`))
	}))
	defer server.Close()
	var out, errOut bytes.Buffer

	code := Run(context.Background(), []string{"--url", server.URL, files(t, 1)}, Deps{
		Stdout: &out, Stderr: &errOut, Getenv: func(string) string { return key }, NewUploader: DefaultUploader,
	})

	if code != 0 || auth != "Bearer "+key || path != "/api/v1/uploads" {
		t.Fatalf("code=%d auth=%q path=%q out=%q err=%q", code, auth, path, out.String(), errOut.String())
	}
}
