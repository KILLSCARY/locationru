#!/usr/bin/env bash
# Orchestrates a staging deploy end-to-end: pre-flight checks, backup,
# build + migrate + start, readiness wait, smoke test. If the smoke test
# fails, this script prints rollback instructions and exits non-zero
# rather than claiming success — it never marks a deploy "done" on a
# guess. See docs/staging/deployment.md and docs/staging/rollback.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step() { echo; echo "==> $*"; }

step "Checking git status"
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Working tree has uncommitted changes:" >&2
  git -C "$ROOT_DIR" status --short >&2
  echo "Refusing to deploy from a dirty working tree. Commit, stash, or pass FORCE=1." >&2
  if [[ "${FORCE:-}" != "1" ]]; then
    exit 1
  fi
  echo "FORCE=1 set — continuing anyway."
fi
current_branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
echo "Deploying from branch: $current_branch"

step "Lint"
(cd "$ROOT_DIR" && pnpm lint)

step "Typecheck"
(cd "$ROOT_DIR" && pnpm typecheck)

step "Tests"
(cd "$ROOT_DIR" && pnpm test)

step "Building images"
compose build

if [[ -n "$(compose ps -q postgres 2>/dev/null)" ]]; then
  step "Backing up the current database before deploying over it"
  bash "$(dirname "${BASH_SOURCE[0]}")/backup.sh"
else
  echo "No running postgres container found — skipping backup (first deploy)."
fi

step "Starting services (build + migrate + start, waiting for healthy)"
if ! compose up -d --wait; then
  echo "FAILED: 'docker compose up' did not reach a healthy state." >&2
  echo "Rollback: see docs/staging/rollback.md — restore the pre-deploy backup with" >&2
  echo "  pnpm staging:restore --yes" >&2
  exit 1
fi

step "Waiting for /health/ready"
ready=false
for _ in $(seq 1 30); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "FAILED: /health/ready did not report ok in time." >&2
  echo "Rollback: see docs/staging/rollback.md — restore the pre-deploy backup with" >&2
  echo "  pnpm staging:restore --yes" >&2
  exit 1
fi

step "Running the smoke test"
if ! bash "$(dirname "${BASH_SOURCE[0]}")/smoke.sh"; then
  echo >&2
  echo "DEPLOY FAILED: the smoke test did not pass." >&2
  echo "The new images are running but are NOT verified — do not treat this as a" >&2
  echo "successful deploy. Rollback: see docs/staging/rollback.md —" >&2
  echo "  pnpm staging:restore --yes" >&2
  echo "restores the pre-deploy database backup; re-deploy the previous commit's" >&2
  echo "images afterwards (docker compose does not roll back application code by" >&2
  echo "itself — see the documented limitation in docs/staging/rollback.md)." >&2
  exit 1
fi

step "Deploy summary"
echo "Branch:    $current_branch"
echo "Commit:    $(git -C "$ROOT_DIR" rev-parse HEAD)"
echo "Status:    SUCCESS — smoke test passed"
echo "Services:"
compose ps
