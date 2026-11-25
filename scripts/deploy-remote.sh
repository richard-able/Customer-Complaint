#!/usr/bin/env bash
set -Eeuo pipefail
: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${IMAGE:?IMAGE must name the registry image to deploy}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/customer-complaint}"
# Keep the SCP destination and remote shell path unambiguous.
if [[ ! "${REMOTE_APP_DIR}" =~ ^/[a-zA-Z0-9_./-]+$ ]]; then
  echo "REMOTE_APP_DIR must be an absolute path without spaces or shell characters." >&2
  exit 1
fi
SSH_OPTIONS=(-p "${SSH_PORT}" -o StrictHostKeyChecking=accept-new)
SCP_OPTIONS=(-P "${SSH_PORT}" -o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTIONS+=(-i "${SSH_KEY}")
  SCP_OPTIONS+=(-i "${SSH_KEY}")
fi
remote="${SSH_USER}@${SSH_HOST}"
ssh "${SSH_OPTIONS[@]}" "${remote}" \
  "mkdir -p '${REMOTE_APP_DIR}/scripts'" || {
  echo "Check SSH access and write permission for ${REMOTE_APP_DIR}." >&2
  exit 1
}
scp "${SCP_OPTIONS[@]}" "${ROOT_DIR}/compose.yaml" "${remote}:${REMOTE_APP_DIR}/compose.yaml"
scp "${SCP_OPTIONS[@]}" "${ROOT_DIR}/scripts/deploy-server.sh" "${remote}:${REMOTE_APP_DIR}/scripts/deploy-server.sh"
printf -v remote_command '%q ' bash "${REMOTE_APP_DIR}/scripts/deploy-server.sh" "${IMAGE}"
ssh "${SSH_OPTIONS[@]}" "${remote}" "${remote_command}"
echo "Docker deployment completed: ${remote}:${REMOTE_APP_DIR} (${IMAGE})"
