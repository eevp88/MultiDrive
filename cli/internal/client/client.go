// Package client sends batches of files to the MultiDrive upload endpoint that accepts an API key.
package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"strconv"
	"strings"

	"github.com/eevp88/MultiDrive/cli/internal/plan"
)

// uploadPath is where the API key endpoint lives, relative to the base URL. The frontend's nginx and the API itself both serve it.
const uploadPath = "/api/v1/uploads"

// maxResponseBytes caps how much of a response is read; a well behaved answer is a few hundred bytes per file.
const maxResponseBytes = 1 << 20

// Client uploads files with an API key.
type Client struct {
	BaseURL string
	Key     string
	HTTP    *http.Client
}

// Uploaded is a file the server stored.
type Uploaded struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SizeBytes string `json:"sizeBytes"`
}

// Failure is a file the server did not store, with the reason it gave.
type Failure struct {
	FileName string `json:"fileName"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// Result is the outcome of one request: some files may have been stored and others not.
type Result struct {
	Files  []Uploaded
	Failed []Failure
}

// APIError is a request-level refusal: a bad key, a missing scope, a malformed request or a server fault.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("server answered %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("server answered %d %s: %s", e.Status, e.Code, e.Message)
}

type metaItem struct {
	FieldName string `json:"fieldName"`
	FileName  string `json:"fileName"`
	MimeType  string `json:"mimeType"`
	SizeBytes string `json:"sizeBytes"`
	FolderID  string `json:"folderId,omitempty"`
}

type response struct {
	Code    string     `json:"code"`
	Message string     `json:"message"`
	Files   []Uploaded `json:"files"`
	Failed  []Failure  `json:"failed"`
}

// UploadBatch sends up to plan.MaxFilesPerRequest files in one request. The body is streamed from disk, so memory does
// not grow with file size. `filesMeta` goes first and declares every size, because the server needs them before the
// bytes arrive. A file that fails on the server side is reported in the Result, not as an error; an error means the
// request itself did not work.
func (c *Client) UploadBatch(ctx context.Context, entries []plan.Entry, folderID string) (Result, error) {
	if len(entries) == 0 {
		return Result{}, errors.New("no files to upload")
	}
	if len(entries) > plan.MaxFilesPerRequest {
		return Result{}, fmt.Errorf("a request carries at most %d files, got %d", plan.MaxFilesPerRequest, len(entries))
	}

	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	go func() { pw.CloseWithError(writeBody(writer, entries, folderID)) }()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+uploadPath, pr)
	if err != nil {
		pr.CloseWithError(err)
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Key)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer res.Body.Close()
	return readResponse(res)
}

func writeBody(writer *multipart.Writer, entries []plan.Entry, folderID string) error {
	meta := make([]metaItem, len(entries))
	for i, e := range entries {
		meta[i] = metaItem{FieldName: fieldName(i), FileName: e.Name, MimeType: e.MimeType, SizeBytes: strconv.FormatInt(e.Size, 10), FolderID: folderID}
	}
	encoded, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	field, err := writer.CreateFormField("filesMeta")
	if err != nil {
		return err
	}
	if _, err := field.Write(encoded); err != nil {
		return err
	}
	for i, e := range entries {
		if err := writeFile(writer, fieldName(i), e); err != nil {
			return err
		}
	}
	return writer.Close()
}

func writeFile(writer *multipart.Writer, field string, e plan.Entry) error {
	f, err := os.Open(e.Path)
	if err != nil {
		return fmt.Errorf("cannot open %q: %w", e.Path, err)
	}
	defer f.Close()

	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, field, escapeQuotes(e.Name)))
	header.Set("Content-Type", e.MimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	// Reading one byte past the declared size catches a file that grew after it was measured; the server would reject
	// the mismatch anyway, but failing here names the file.
	n, err := io.Copy(part, io.LimitReader(f, e.Size+1))
	if err != nil {
		return fmt.Errorf("cannot read %q: %w", e.Path, err)
	}
	if n != e.Size {
		return fmt.Errorf("%q changed while being read: expected %d bytes, read %d", e.Path, e.Size, n)
	}
	return nil
}

func readResponse(res *http.Response) (Result, error) {
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return Result{}, fmt.Errorf("cannot read the server response: %w", err)
	}
	var parsed response
	parseErr := json.Unmarshal(body, &parsed)

	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		if parseErr != nil {
			return Result{}, &APIError{Status: res.StatusCode, Message: "the response was not understood"}
		}
		return Result{Files: parsed.Files, Failed: parsed.Failed}, nil
	case res.StatusCode == http.StatusBadRequest && parseErr == nil && len(parsed.Failed) > 0:
		// Nothing was stored: the server lists why for each file.
		return Result{Failed: parsed.Failed}, nil
	case parseErr == nil && parsed.Code != "":
		return Result{}, &APIError{Status: res.StatusCode, Code: parsed.Code, Message: parsed.Message}
	default:
		// The body is not echoed: an error page from a proxy can carry internal details.
		return Result{}, &APIError{Status: res.StatusCode, Message: http.StatusText(res.StatusCode)}
	}
}

func fieldName(i int) string { return "file-" + strconv.Itoa(i) }

var quoteEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

func escapeQuotes(s string) string { return quoteEscaper.Replace(s) }
