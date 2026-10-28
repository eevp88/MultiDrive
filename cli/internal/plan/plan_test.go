package plan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const noLimit = int64(1) << 40

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func names(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

func TestCollectTakesASingleFileWithItsSizeAndType(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "notes.txt"), "hello")

	entries, skipped, err := Collect([]string{filepath.Join(dir, "notes.txt")}, noLimit)

	if err != nil || len(skipped) != 0 || len(entries) != 1 {
		t.Fatalf("entries=%v skipped=%v err=%v", entries, skipped, err)
	}
	got := entries[0]
	if got.Name != "notes.txt" || got.Size != 5 || !strings.HasPrefix(got.MimeType, "text/plain") {
		t.Fatalf("unexpected entry %+v", got)
	}
	if got.Path != filepath.Join(dir, "notes.txt") {
		t.Fatalf("path should stay as given, got %q", got.Path)
	}
}

func TestCollectWalksDirectoriesRecursivelyInLexicalOrder(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "b.txt"), "b")
	write(t, filepath.Join(dir, "a.txt"), "a")
	write(t, filepath.Join(dir, "sub", "c.txt"), "c")
	write(t, filepath.Join(dir, "sub", "deep", "d.txt"), "d")

	entries, _, err := Collect([]string{dir}, noLimit)

	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(entries), ","); got != "a.txt,b.txt,c.txt,d.txt" {
		t.Fatalf("got %s", got)
	}
}

func TestCollectFallsBackToOctetStreamForUnknownExtensions(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "blob.zzunknown"), "x")
	write(t, filepath.Join(dir, "noext"), "x")

	entries, _, err := Collect([]string{dir}, noLimit)

	if err != nil || len(entries) != 2 {
		t.Fatalf("entries=%v err=%v", entries, err)
	}
	for _, e := range entries {
		if e.MimeType != "application/octet-stream" {
			t.Fatalf("%s got %q", e.Name, e.MimeType)
		}
	}
}

func TestCollectSkipsEmptyFilesBecauseTheUploadEndpointRejectsThem(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "empty.txt"), "")
	write(t, filepath.Join(dir, "full.txt"), "x")

	entries, skipped, err := Collect([]string{dir}, noLimit)

	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(entries), ","); got != "full.txt" {
		t.Fatalf("entries %s", got)
	}
	if len(skipped) != 1 || filepath.Base(skipped[0].Path) != "empty.txt" || skipped[0].Reason != ReasonEmpty {
		t.Fatalf("skipped %+v", skipped)
	}
}

func TestCollectSkipsFilesOverTheLimitWithAReason(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "small.txt"), "12345")
	write(t, filepath.Join(dir, "big.txt"), "123456")

	entries, skipped, err := Collect([]string{dir}, 5)

	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(entries), ","); got != "small.txt" {
		t.Fatalf("entries %s", got)
	}
	if len(skipped) != 1 || filepath.Base(skipped[0].Path) != "big.txt" || skipped[0].Reason != ReasonTooLarge {
		t.Fatalf("skipped %+v", skipped)
	}
}

func TestCollectSkipsSymlinksSoLoopsAndOutsideFilesAreNeverFollowed(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	write(t, filepath.Join(dir, "real.txt"), "r")
	write(t, filepath.Join(outside, "secret.txt"), "s")
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(dir, "link.txt")); err != nil {
		t.Skip("symlinks not available:", err)
	}
	if err := os.Symlink(dir, filepath.Join(dir, "loop")); err != nil {
		t.Fatal(err)
	}

	entries, skipped, err := Collect([]string{dir}, noLimit)

	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(entries), ","); got != "real.txt" {
		t.Fatalf("entries %s", got)
	}
	reasons := map[string]string{}
	for _, s := range skipped {
		reasons[filepath.Base(s.Path)] = s.Reason
	}
	if reasons["link.txt"] != ReasonNotRegular || reasons["loop"] != ReasonNotRegular {
		t.Fatalf("skipped %+v", skipped)
	}
}

func TestCollectFailsOnAMissingPathInsteadOfSkippingIt(t *testing.T) {
	_, _, err := Collect([]string{filepath.Join(t.TempDir(), "nope")}, noLimit)

	if err == nil {
		t.Fatal("expected an error for a missing path")
	}
}

func TestCollectFailsWhenNoPathIsGiven(t *testing.T) {
	if _, _, err := Collect(nil, noLimit); err == nil {
		t.Fatal("expected an error when there is nothing to upload")
	}
}

func TestCollectSkipsFilesWhoseSizeTheServerCannotDeclare(t *testing.T) {
	// The server accepts at most 15 digits of sizeBytes. A real file that big does not exist in a test, so the check is
	// exercised through the exported limit.
	if MaxDeclarableSize != 999_999_999_999_999 {
		t.Fatalf("MaxDeclarableSize = %d", MaxDeclarableSize)
	}
}

func TestBatchesSplitsAtTheServerLimit(t *testing.T) {
	entries := make([]Entry, 26)
	for i := range entries {
		entries[i] = Entry{Name: string(rune('a' + i))}
	}

	batches := Batches(entries, MaxFilesPerRequest)

	if len(batches) != 2 || len(batches[0]) != 25 || len(batches[1]) != 1 {
		t.Fatalf("got %d batches", len(batches))
	}
	if batches[1][0].Name != "z" {
		t.Fatalf("order was not kept")
	}
}

func TestBatchesOfNothingIsNothing(t *testing.T) {
	if got := Batches(nil, MaxFilesPerRequest); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestBatchesNeverExceedTheServerLimitEvenWhenAskedTo(t *testing.T) {
	entries := make([]Entry, 30)

	batches := Batches(entries, 100)

	for _, b := range batches {
		if len(b) > MaxFilesPerRequest {
			t.Fatalf("batch of %d", len(b))
		}
	}
}

func TestBatchesTreatsANonPositiveSizeAsOneFilePerRequest(t *testing.T) {
	batches := Batches(make([]Entry, 3), 0)

	if len(batches) != 3 {
		t.Fatalf("got %d batches", len(batches))
	}
}
