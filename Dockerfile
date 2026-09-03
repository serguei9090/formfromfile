# syntax=docker/dockerfile:1

# ---- 1. build the SPA -------------------------------------------------------
FROM oven/bun:1 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build          # -> /app/web/dist

# ---- 2. build the Go binary with the SPA embedded -------------------------
FROM golang:1.26 AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# the real SPA replaces the placeholder that //go:embed all:dist bundles
COPY --from=web /app/web/dist/ ./cmd/formfromfile/dist/
RUN mkdir -p /data && chown 65532:65532 /data
RUN CGO_ENABLED=0 GOFLAGS=-trimpath go build -ldflags='-s -w' \
    -o /formfromfile ./cmd/formfromfile

# ---- 3. minimal runtime --------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /formfromfile /formfromfile
COPY --from=server --chown=65532:65532 /data /data
ENV FFF_ADDR=0.0.0.0:8787 \
    FFF_DB=/data/formfromfile.db \
    FFF_ALLOW_REGISTER=true
EXPOSE 8787
VOLUME ["/data"]
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/formfromfile", "--healthcheck"]
ENTRYPOINT ["/formfromfile"]
