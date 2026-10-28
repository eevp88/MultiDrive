package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/eevp88/MultiDrive/cli/internal/plan"
)

const testKey = "mdk_secret_value_that_must_not_leak"

type part struct {
	name, filename, contentType string
	body                        []byte
}

type seen struct {
	method, path, auth, contentType string
	chunked                         bool
	parts                           []part
}

// readParts returns the parts that arrived whole. It stops quietly at a truncated body: tests where the client aborts
// the upload on purpose assert on the client's error, not on what the server managed to read. It runs on the server's
// goroutine, so it never calls t.Fatal.
func readParts(r *http.Request) []part {
	_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		return nil
	}
	reader := multipart.NewReader(r.Body, params["boundary"])
	var parts []part
	for {
		p, err := reader.NextPart()
		if err != nil {
			return parts
		}
		body, err := io.ReadAll(p)
		if err != nil {
			return parts
		}
		parts = append(parts, part{p.FormName(), p.FileName(), p.Header.Get("Content-Type"), body})
	}
}

// fakeServer records what it received and answers with the given status and JSON body.
func fakeServer(t *testing.T, status int, response string) (*httptest.Server, *seen) {
	t.Helper()
	got := &seen{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path, got.auth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		got.contentType = r.Header.Get("Content-Type")
		got.chunked = r.ContentLength == -1
		got.parts = readParts(r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	return server, got
}

func file(t *testing.T, name, content string) plan.Entry {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return plan.Entry{Path: path, Name: name, MimeType: "text/plain", Size: int64(len(content))}
}

func newClient(server *httptest.Server) *Client {
	return &Client{BaseURL: server.URL, Key: testKey, HTTP: server.Client()}
}

func TestUploadBatchPostsToTheApiKeyEndpointWithTheBearerKey(t *testing.T) {
	server, got := fakeServer(t, 201, `{"files":[],"failed":[]}`)

	_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "a")}, "")

	if err != nil {
		t.Fatal(err)
	}
	if got.method != "POST" || got.path != "/api/v1/uploads" || got.auth != "Bearer "+testKey {
		t.Fatalf("got %+v", got)
	}
	if !strings.HasPrefix(got.contentType, "multipart/form-data") {
		t.Fatalf("content type %q", got.contentType)
	}
}

func TestUploadBatchSendsFilesMetaFirstWithExactSizesThenTheFilesInOrder(t *testing.T) {
	server, got := fakeServer(t, 201, `{"files":[],"failed":[]}`)
	entries := []plan.Entry{file(t, "a.txt", "alpha"), file(t, "b.txt", "bb")}

	_, err := newClient(server).UploadBatch(context.Background(), entries, "")

	if err != nil {
		t.Fatal(err)
	}
	if len(got.parts) != 3 || got.parts[0].name != "filesMeta" {
		t.Fatalf("filesMeta must be the first of 3 parts, got %+v", got.parts)
	}
	var meta []map[string]any
	if err := json.Unmarshal(got.parts[0].body, &meta); err != nil {
		t.Fatal(err)
	}
	if len(meta) != 2 || meta[0]["fieldName"] != "file-0" || meta[0]["fileName"] != "a.txt" || meta[0]["mimeType"] != "text/plain" || meta[0]["sizeBytes"] != "5" || meta[1]["fieldName"] != "file-1" || meta[1]["sizeBytes"] != "2" {
		t.Fatalf("meta %v", meta)
	}
	if _, has := meta[0]["folderId"]; has {
		t.Fatalf("folderId must be left out when none was given")
	}
	a, b := got.parts[1], got.parts[2]
	if a.name != "file-0" || a.filename != "a.txt" || string(a.body) != "alpha" || a.contentType != "text/plain" {
		t.Fatalf("first file part %+v", a)
	}
	if b.name != "file-1" || b.filename != "b.txt" || string(b.body) != "bb" {
		t.Fatalf("second file part %+v", b)
	}
}

func TestUploadBatchPutsTheFolderIdOnEveryFile(t *testing.T) {
	server, got := fakeServer(t, 201, `{"files":[],"failed":[]}`)
	entries := []plan.Entry{file(t, "a.txt", "a"), file(t, "b.txt", "b")}

	_, err := newClient(server).UploadBatch(context.Background(), entries, "folder-123")

	if err != nil {
		t.Fatal(err)
	}
	var meta []map[string]any
	_ = json.Unmarshal(got.parts[0].body, &meta)
	if meta[0]["folderId"] != "folder-123" || meta[1]["folderId"] != "folder-123" {
		t.Fatalf("meta %v", meta)
	}
}

func TestUploadBatchStreamsTheBodyInsteadOfBufferingIt(t *testing.T) {
	server, got := fakeServer(t, 201, `{"files":[],"failed":[]}`)
	big := strings.Repeat("x", 5<<20)

	_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "big.bin", big)}, "")

	if err != nil {
		t.Fatal(err)
	}
	if !got.chunked {
		t.Fatalf("a streamed body has no declared length")
	}
	if len(got.parts[1].body) != len(big) {
		t.Fatalf("server received %d bytes", len(got.parts[1].body))
	}
}

func TestUploadBatchReturnsUploadedFilesAndPerFileFailures(t *testing.T) {
	server, _ := fakeServer(t, 201, `{"files":[{"id":"f1","name":"a.txt","sizeBytes":"5"}],"failed":[{"fileName":"b.txt","code":"UPLOAD_SIZE_MISMATCH","message":"Streamed byte count did not match declared size."}]}`)

	res, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "alpha"), file(t, "b.txt", "bb")}, "")

	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 1 || res.Files[0].ID != "f1" || res.Files[0].Name != "a.txt" {
		t.Fatalf("files %+v", res.Files)
	}
	if len(res.Failed) != 1 || res.Failed[0].FileName != "b.txt" || res.Failed[0].Code != "UPLOAD_SIZE_MISMATCH" {
		t.Fatalf("failed %+v", res.Failed)
	}
}

func TestUploadBatchTreatsAllFilesFailingAsResultNotAsError(t *testing.T) {
	// When nothing uploads, the server answers 400 with the failures listed.
	server, _ := fakeServer(t, 400, `{"code":"NO_ACCOUNT_WITH_ENOUGH_SPACE","message":"No connected storage account has enough space for this upload.","failed":[{"fileName":"a.txt","code":"NO_ACCOUNT_WITH_ENOUGH_SPACE","message":"No connected storage account has enough space for this upload."}]}`)

	res, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "a")}, "")

	if err != nil {
		t.Fatalf("a per-file failure is a result, got error %v", err)
	}
	if len(res.Files) != 0 || len(res.Failed) != 1 || res.Failed[0].Code != "NO_ACCOUNT_WITH_ENOUGH_SPACE" {
		t.Fatalf("result %+v", res)
	}
}

func TestUploadBatchReportsRequestLevelErrorsWithStatusAndCode(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		code   string
	}{
		{401, `{"code":"API_KEY_INVALID","message":"Invalid API key."}`, "API_KEY_INVALID"},
		{403, `{"code":"API_KEY_FORBIDDEN","message":"API key does not have required scope."}`, "API_KEY_FORBIDDEN"},
		{400, `{"code":"UPLOAD_MALFORMED","message":"Malformed upload fields."}`, "UPLOAD_MALFORMED"},
		{500, `{"code":"INTERNAL_SERVER_ERROR","message":"boom"}`, "INTERNAL_SERVER_ERROR"},
	} {
		server, _ := fakeServer(t, tc.status, tc.body)

		_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "a")}, "")

		var apiErr *APIError
		if !errors.As(err, &apiErr) || apiErr.Status != tc.status || apiErr.Code != tc.code {
			t.Fatalf("status %d: got %v", tc.status, err)
		}
	}
}

func TestUploadBatchDoesNotEchoAnUnparseableResponseBody(t *testing.T) {
	server, _ := fakeServer(t, 502, `<html>upstream said: secret internal host db.internal:3306</html>`)

	_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "a")}, "")

	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 502 {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(err.Error(), "db.internal") {
		t.Fatalf("raw body leaked into the error: %v", err)
	}
}

func TestUploadBatchNeverPutsTheKeyInAnError(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	url := server.URL
	server.Close() // nothing listens any more: a transport error

	_, err := (&Client{BaseURL: url, Key: testKey, HTTP: http.DefaultClient}).UploadBatch(context.Background(), []plan.Entry{file(t, "a.txt", "a")}, "")

	if err == nil {
		t.Fatal("expected a transport error")
	}
	if strings.Contains(err.Error(), testKey) {
		t.Fatalf("the key leaked: %v", err)
	}
}

func TestUploadBatchFailsWhenAFileChangesSizeWhileBeingRead(t *testing.T) {
	server, _ := fakeServer(t, 201, `{"files":[],"failed":[]}`)
	entry := file(t, "a.txt", "alpha")
	entry.Size = 99 // declared bigger than what is on disk

	_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{entry}, "")

	if err == nil || !strings.Contains(err.Error(), "a.txt") {
		t.Fatalf("expected an error naming the file, got %v", err)
	}
}

func TestUploadBatchFailsOnAFileThatDisappeared(t *testing.T) {
	server, _ := fakeServer(t, 201, `{"files":[],"failed":[]}`)
	entry := file(t, "a.txt", "a")
	_ = os.Remove(entry.Path)

	_, err := newClient(server).UploadBatch(context.Background(), []plan.Entry{entry}, "")

	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestUploadBatchStopsWhenTheContextIsCancelled(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := newClient(server).UploadBatch(ctx, []plan.Entry{file(t, "a.txt", "a")}, "")

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
}

func TestUploadBatchRefusesMoreFilesThanTheServerAccepts(t *testing.T) {
	_, err := (&Client{BaseURL: "http://unused.invalid", Key: testKey, HTTP: http.DefaultClient}).UploadBatch(context.Background(), make([]plan.Entry, plan.MaxFilesPerRequest+1), "")

	if err == nil || !strings.Contains(err.Error(), "at most 25 files") {
		t.Fatalf("expected the file limit error, got %v", err)
	}
}
