package main

import "embed"

// distFS holds the built SPA in the release build. The `dist` directory is a
// symlink/copy of ../../web/dist created by the build; in dev it's just the
// placeholder below so `go build` succeeds without the frontend.
//
//go:embed all:dist
var distFS embed.FS
