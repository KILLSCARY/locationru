# syntax=docker/dockerfile:1

# Staging's reverse proxy needs per-route rate limiting (auth + address
# suggestions), which isn't in stock Caddy — build it in via xcaddy, the
# standard way to extend Caddy with a plugin.
FROM caddy:2.10-builder-alpine AS builder

RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2.10-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
