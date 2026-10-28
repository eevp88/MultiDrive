//go:build e2e

// Package e2e runs the real multidrive-upload binary against the real backend of the isolated docker stack in
// ../../e2e (`cd e2e && npm run stack:up`). The stack has no Drive account, so no file can actually be stored: what
// these tests prove is that authentication, multipart parsing, `filesMeta`, size validation and folder lookup of the
// real server accept what the client sends. A server that accepted the request answers NO_ACCOUNT_WITH_ENOUGH_SPACE
// for each file, which is the farthest a request can get without storage.
package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func apiURL() string {
	if v := os.Getenv("E2E_API_URL"); v != "" {
		return v
	}
	return "http://localhost:14000"
}

func call(t *testing.T, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, apiURL()+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("the e2e stack is not reachable at %s (run `cd e2e && npm run stack:up`): %v", apiURL(), err)
	}
	defer res.Body.Close()
	var parsed map[string]any
	_ = json.NewDecoder(res.Body).Decode(&parsed)
	return res.StatusCode, parsed
}

type fixture struct {
	token, keyID, key, folderID string
}

var (
	userOnce sync.Once
	userData fixture
)

// newFixture gives each test its own API key. The user and the folder are created once per run, because register is rate
// limited to 10 per hour per backend process and the Playwright suite shares that budget.
func newFixture(t *testing.T) fixture {
	t.Helper()
	userOnce.Do(func() {
		email := fmt.Sprintf("cli-%d@e2e.test", time.Now().UnixNano())
		status, registered := call(t, "POST", "/auth/register", "", map[string]string{"name": "CLI e2e", "email": email, "password": "e2e-password-123"})
		if status != 201 {
			t.Fatalf("register answered %d: %v", status, registered)
		}
		userData.token, _ = registered["accessToken"].(string)
		if userData.token == "" {
			t.Fatalf("register returned no accessToken: %v", registered)
		}
		status, folder := call(t, "POST", "/folders", userData.token, map[string]string{"name": "cli target"})
		if status != 201 {
			t.Fatalf("folder creation answered %d: %v", status, folder)
		}
		userData.folderID, _ = folder["folder"].(map[string]any)["id"].(string)
	})
	if userData.token == "" {
		t.Fatal("the shared e2e user could not be created")
	}
	status, created := call(t, "POST", "/api-keys", userData.token, map[string]string{"name": "cli e2e"})
	if status != 201 {
		t.Fatalf("api key creation answered %d: %v", status, created)
	}
	f := userData
	f.key, _ = created["secret"].(string)
	f.keyID, _ = created["apiKey"].(map[string]any)["id"].(string)
	return f
}

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "multidrive-upload-e2e")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "multidrive-upload")
	build := exec.Command("go", "build", "-o", binary, "../cmd/multidrive-upload")
	if out, err := build.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "build failed: %v\n%s", err, out)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func files(t *testing.T, n int) string {
	t.Helper()
	dir := t.TempDir()
	for i := 0; i < n; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%02d.txt", i)), []byte(fmt.Sprintf("content %d", i)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func upload(t *testing.T, key string, args ...string) (string, int) {
	t.Helper()
	cmd := exec.Command(binary, append([]string{"--url", apiURL()}, args...)...)
	cmd.Env = append(os.Environ(), "MULTIDRIVE_API_KEY="+key)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	code := 0
	if exitErr, ok := err.(*exec.ExitError); ok {
		code = exitErr.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	return out.String(), code
}

func TestAValidKeyGetsItsRequestAcceptedByTheRealServer(t *testing.T) {
	f := newFixture(t)

	out, code := upload(t, f.key, files(t, 2))

	if code != 1 || strings.Count(out, "NO_ACCOUNT_WITH_ENOUGH_SPACE") != 2 {
		t.Fatalf("exit %d, output:\n%s", code, out)
	}
	for _, rejected := range []string{"API_KEY", "UPLOAD_MALFORMED", "UPLOAD_SIZE_REQUIRED", "UPLOAD_SIZE_MISMATCH", "FOLDER_NOT_FOUND"} {
		if strings.Contains(out, rejected) {
			t.Fatalf("the server rejected the request with %s:\n%s", rejected, out)
		}
	}
	if strings.Contains(out, f.key) {
		t.Fatal("the key was printed")
	}
}

func TestMoreThanOneRequestWorthOfFilesIsAccepted(t *testing.T) {
	f := newFixture(t)

	out, _ := upload(t, f.key, files(t, 30))

	if strings.Count(out, "NO_ACCOUNT_WITH_ENOUGH_SPACE") != 30 || !strings.Contains(out, "uploaded 0, failed 30, skipped 0, not sent 0") {
		t.Fatalf("output:\n%s", out)
	}
}

func TestAnExistingFolderIdIsFoundAndAMissingOneIsNot(t *testing.T) {
	f := newFixture(t)

	found, _ := upload(t, f.key, "--folder-id", f.folderID, files(t, 1))
	missing, _ := upload(t, f.key, "--folder-id", "does-not-exist", files(t, 1))

	if strings.Contains(found, "FOLDER_NOT_FOUND") || !strings.Contains(found, "NO_ACCOUNT_WITH_ENOUGH_SPACE") {
		t.Fatalf("existing folder:\n%s", found)
	}
	if !strings.Contains(missing, "FOLDER_NOT_FOUND") {
		t.Fatalf("missing folder:\n%s", missing)
	}
}

func TestAnInvalidKeyIsRefusedAndNothingIsSentAfterwards(t *testing.T) {
	newFixture(t)

	out, code := upload(t, "9d_live_not_a_real_key", "--concurrency", "1", files(t, 60))

	if code != 1 || !strings.Contains(out, "API_KEY_INVALID") || !strings.Contains(out, "not sent 35") {
		t.Fatalf("exit %d, output:\n%s", code, out)
	}
}

func TestARevokedKeyIsRefused(t *testing.T) {
	f := newFixture(t)
	if status, body := call(t, "DELETE", "/api-keys/"+f.keyID, f.token, nil); status != 200 {
		t.Fatalf("revoke answered %d: %v", status, body)
	}

	out, code := upload(t, f.key, files(t, 1))

	if code != 1 || !strings.Contains(out, "API_KEY_INVALID") {
		t.Fatalf("exit %d, output:\n%s", code, out)
	}
}
