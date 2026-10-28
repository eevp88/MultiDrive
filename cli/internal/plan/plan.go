// Package plan decides what to upload: which files the given paths contain and how they are grouped into requests.
// It only reads file metadata; nothing here talks to the network.
package plan

import (
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
)

const (
	// MaxFilesPerRequest is the most files the server accepts in one multipart request.
	MaxFilesPerRequest = 25
	// MaxDeclarableSize is the largest size the server accepts in sizeBytes: at most 15 digits.
	MaxDeclarableSize = int64(999_999_999_999_999)

	ReasonTooLarge   = "file is larger than the size limit"
	ReasonEmpty      = "file is empty (POST /uploads rejects empty files)"
	ReasonNotRegular = "not a regular file (symlinks and special files are not followed)"
)

// Entry is one file to upload.
type Entry struct {
	Path     string
	Name     string
	MimeType string
	Size     int64
}

// Skipped is a file that was found but will not be uploaded.
type Skipped struct {
	Path   string
	Reason string
}

// Collect expands paths into files. A directory is walked recursively in lexical order. Symlinks and special files are
// skipped, and so are files over maxBytes. A path that does not exist is an error: silently skipping it would let a
// typo look like a successful upload.
func Collect(paths []string, maxBytes int64) ([]Entry, []Skipped, error) {
	if len(paths) == 0 {
		return nil, nil, errors.New("nothing to upload: give at least one file or directory")
	}
	limit := maxBytes
	if limit > MaxDeclarableSize {
		limit = MaxDeclarableSize
	}

	var entries []Entry
	var skipped []Skipped
	add := func(path string, info fs.FileInfo) {
		switch {
		case !info.Mode().IsRegular():
			skipped = append(skipped, Skipped{Path: path, Reason: ReasonNotRegular})
		case info.Size() == 0:
			skipped = append(skipped, Skipped{Path: path, Reason: ReasonEmpty})
		case info.Size() > limit:
			skipped = append(skipped, Skipped{Path: path, Reason: ReasonTooLarge})
		default:
			entries = append(entries, Entry{Path: path, Name: info.Name(), MimeType: mimeFor(info.Name()), Size: info.Size()})
		}
	}

	for _, root := range paths {
		info, err := os.Lstat(root)
		if err != nil {
			return nil, nil, fmt.Errorf("cannot read %q: %w", root, err)
		}
		if !info.IsDir() {
			add(root, info)
			continue
		}
		err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			add(path, info)
			return nil
		})
		if err != nil {
			return nil, nil, fmt.Errorf("cannot read %q: %w", root, err)
		}
	}
	return entries, skipped, nil
}

// Batches groups entries into requests of at most size files, never more than the server accepts, keeping their order.
// A size below one means one file per request.
func Batches(entries []Entry, size int) [][]Entry {
	if size < 1 {
		size = 1
	}
	if size > MaxFilesPerRequest {
		size = MaxFilesPerRequest
	}
	var batches [][]Entry
	for start := 0; start < len(entries); start += size {
		end := start + size
		if end > len(entries) {
			end = len(entries)
		}
		batches = append(batches, entries[start:end])
	}
	return batches
}

func mimeFor(name string) string {
	if t := mime.TypeByExtension(filepath.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}
