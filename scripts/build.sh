#!/usr/bin/env bash
set -Eeuo pipefail

PUSH_IMAGE="${PUSH_IMAGE:-false}"
BUILD_IMAGE=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h)
      echo "Usage: bash scripts/build.sh [registry/namespace/image:tag] [--push]"
      echo "Builds and packages the project .env file into the image."
      echo "Image priority: argument > IMAGE environment variable > .env."
      echo "Run docker login before using --push."
      exit 0
      ;;
    --push) PUSH_IMAGE=true ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      if [[ -n "${BUILD_IMAGE}" ]]; then
        echo "Expected only one image address." >&2
        exit 1
      fi
      BUILD_IMAGE="$1"
      ;;
  esac
  shift
done
if [[ "${PUSH_IMAGE}" != "true" && "${PUSH_IMAGE}" != "false" ]]; then
  echo "PUSH_IMAGE must be true or false." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Missing ${ROOT_DIR}/.env. Create it from .env.example first." >&2
  exit 1
fi
if [[ -n "${BUILD_IMAGE}" ]]; then
  export IMAGE="${BUILD_IMAGE}"
fi
if command -v sha256sum >/dev/null; then
  env_checksum="$(sha256sum "${ROOT_DIR}/.env")"
elif command -v shasum >/dev/null; then
  env_checksum="$(shasum -a 256 "${ROOT_DIR}/.env")"
else
  echo "sha256sum or shasum is required to track .env changes." >&2
  exit 1
fi
export APP_ENV_HASH="${env_checksum%% *}"
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
compose=(docker compose --project-directory "${ROOT_DIR}" --env-file "${ROOT_DIR}/.env" -f "${ROOT_DIR}/compose.yaml" -f "${ROOT_DIR}/compose.override.yaml")
"${compose[@]}" config --quiet
resolved_image="$("${compose[@]}" config --images)"
if [[ "${PUSH_IMAGE:-false}" == "true" ]]; then
  registry="${resolved_image%%/*}"
  if [[ "${resolved_image}" != */* || ( "${registry}" != *.* && "${registry}" != *:* && "${registry}" != "localhost" ) ]]; then
    echo "Pushing requires a full registry image address, for example mate-docker-register-cn-north-1.jcr.service.jdcloud.com/mate-customer-complaint:v4." >&2
    exit 1
  fi
fi

echo "Building ${resolved_image} ..."
BUILDX_NO_DEFAULT_ATTESTATIONS=1 "${compose[@]}" build app
if [[ "${PUSH_IMAGE}" == "true" ]]; then
  "${compose[@]}" push app
  echo "Image pushed: ${resolved_image}"
else
  echo "Image built locally: ${resolved_image}"
fi
