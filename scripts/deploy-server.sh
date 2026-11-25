#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: bash scripts/deploy-server.sh <registry/namespace/image:tag>"
  echo "Application configuration is included in the image; no server .env is required."
  echo "Options via environment: IMAGE, APP_DIR, APP_PORT, DEPLOY_TIMEOUT (default: 120 seconds)."
  echo "Run docker login on the server before deploying."
  exit 0
fi
if [[ "$#" -gt 1 ]]; then
  echo "Expected one image address. Use --help for usage." >&2
  exit 1
fi

DEPLOY_IMAGE="${1:-${IMAGE:-}}"
: "${DEPLOY_IMAGE:?Pass the registry image address or set IMAGE}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-120}"
if [[ ! "${DEPLOY_TIMEOUT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "DEPLOY_TIMEOUT must be a positive number of seconds." >&2
  exit 1
fi
for required_file in compose.yaml; do
  if [[ ! -f "${APP_DIR}/${required_file}" ]]; then
    echo "Missing ${APP_DIR}/${required_file}. Prepare the deployment files first." >&2
    exit 1
  fi
done

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
if [[ -n "${DEPLOY_IMAGE}" ]]; then
  export IMAGE="${DEPLOY_IMAGE}"
fi
compose_env=/dev/null
if [[ -r "${APP_DIR}/.env" ]]; then
  compose_env="${APP_DIR}/.env"
fi
compose=(docker compose --project-directory "${APP_DIR}" --env-file "${compose_env}" -f "${APP_DIR}/compose.yaml")
"${compose[@]}" config --quiet
resolved_image="$("${compose[@]}" config --images)"
registry="${resolved_image%%/*}"
if [[ "${resolved_image}" != */* || ( "${registry}" != *.* && "${registry}" != *:* && "${registry}" != "localhost" ) ]]; then
  echo "Deployment requires a full registry image address. Pass it as an argument or set IMAGE." >&2
  exit 1
fi

echo "Pulling ${resolved_image} ..."
"${compose[@]}" pull app
echo "Starting the application and waiting for its health check ..."
if ! "${compose[@]}" up -d --no-build --force-recreate --wait --wait-timeout "${DEPLOY_TIMEOUT}" app; then
  echo "Deployment failed. Application logs and health check results:" >&2
  "${compose[@]}" ps -a || true
  "${compose[@]}" logs --no-color --tail=100 app || true
  container_id="$("${compose[@]}" ps -a -q app)" || container_id=""
  if [[ -n "${container_id}" ]]; then
    docker inspect --format '{{json .State.Health}}' "${container_id}" || true
  fi
  exit 1
fi

"${compose[@]}" ps
echo "Deployment completed: ${resolved_image}"
