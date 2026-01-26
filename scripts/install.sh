#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BIN_SRC="${BIN_SRC:-${ROOT}/dist/macbox}"
PROFILES_SRC="${PROFILES_SRC:-${ROOT}/profiles}"

PREFIX="${PREFIX:-/usr/local}"
BIN_DIR="${PREFIX}/bin"
SHARE_DIR="${PREFIX}/share/macbox"
PROFILES_DIR="${MACBOX_PROFILES_DIR:-${SHARE_DIR}/profiles}"

if [[ ! -f "${BIN_SRC}" ]]; then
  echo "macbox install: binary not found at ${BIN_SRC}" >&2
  echo "Set BIN_SRC=/path/to/macbox to override." >&2
  exit 1
fi

if [[ ! -d "${PROFILES_SRC}" ]]; then
  echo "macbox install: profiles dir not found at ${PROFILES_SRC}" >&2
  echo "Set PROFILES_SRC=/path/to/profiles to override." >&2
  exit 1
fi

install -d "${BIN_DIR}" "${PROFILES_DIR}"
install -m 755 "${BIN_SRC}" "${BIN_DIR}/macbox"
cp -R "${PROFILES_SRC}/." "${PROFILES_DIR}/"

echo "Installed macbox to ${BIN_DIR}/macbox"
echo "Installed profiles to ${PROFILES_DIR}"
