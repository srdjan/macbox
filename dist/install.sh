#!/usr/bin/env bash
set -euo pipefail

# macbox installer - downloads from GitHub releases

REPO="srdjan/macbox"
PREFIX="${PREFIX:-/usr/local}"
BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/macbox"

echo "Installing macbox to $PREFIX..."

# Create temp directory
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Download latest release
echo "Downloading macbox binary..."
curl -fsSL -o "$TMP_DIR/macbox" "https://github.com/$REPO/releases/latest/download/macbox"
chmod +x "$TMP_DIR/macbox"

echo "Downloading profiles..."
curl -fsSL -o "$TMP_DIR/profiles.tar.gz" "https://github.com/$REPO/releases/latest/download/profiles.tar.gz"

# Install
if [[ -w "$BIN_DIR" ]]; then
    install -m 755 "$TMP_DIR/macbox" "$BIN_DIR/macbox"
    mkdir -p "$SHARE_DIR"
    tar -xzf "$TMP_DIR/profiles.tar.gz" -C "$SHARE_DIR" --strip-components=1
else
    echo "Installing to $PREFIX requires sudo..."
    sudo install -m 755 "$TMP_DIR/macbox" "$BIN_DIR/macbox"
    sudo mkdir -p "$SHARE_DIR"
    sudo tar -xzf "$TMP_DIR/profiles.tar.gz" -C "$SHARE_DIR" --strip-components=1
fi

echo "Installed macbox to $BIN_DIR/macbox"
echo "Installed profiles to $SHARE_DIR/"
echo ""
echo "Run 'macbox --help' to get started."
