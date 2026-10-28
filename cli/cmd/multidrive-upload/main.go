// Command multidrive-upload uploads files to MultiDrive through the API key endpoint.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/eevp88/MultiDrive/cli/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := app.Run(ctx, os.Args[1:], app.Deps{Stdout: os.Stdout, Stderr: os.Stderr, Getenv: os.Getenv, NewUploader: app.DefaultUploader})
	stop()
	os.Exit(code)
}
