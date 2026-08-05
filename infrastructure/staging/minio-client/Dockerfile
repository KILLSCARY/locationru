FROM golang:1.24-alpine AS build

ARG MINIO_CLIENT_VERSION=RELEASE.2025-08-13T08-35-41Z

RUN GOBIN=/out go install "github.com/minio/mc@${MINIO_CLIENT_VERSION}"

FROM alpine:3.22

RUN apk add --no-cache ca-certificates

COPY --from=build /out/mc /usr/local/bin/mc

ENTRYPOINT ["mc"]
