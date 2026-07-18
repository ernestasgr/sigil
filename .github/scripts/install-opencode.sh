#!/usr/bin/env bash
set -euo pipefail

# Update these two pins together. The digest comes from the release asset's
# `digest` field in the GitHub Releases API.
readonly OPENCODE_VERSION='1.15.11'
readonly OPENCODE_SHA256='49317253722c698394980e1921ff28e919d79bb29d5c3f4cf314a4adaf7037cd'
readonly OPENCODE_ARCHIVE='opencode-linux-x64.tar.gz'
readonly OPENCODE_URL="https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/${OPENCODE_ARCHIVE}"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

archive_path="${temporary_directory}/${OPENCODE_ARCHIVE}"
curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    "$OPENCODE_URL" \
    --output "$archive_path"

printf '%s  %s\n' "$OPENCODE_SHA256" "$archive_path" | sha256sum --check --status
tar -xzf "$archive_path" -C "$temporary_directory"

install_directory="${HOME}/.opencode/bin"
mkdir -p "$install_directory"
install -m 0755 "${temporary_directory}/opencode" "${install_directory}/opencode"
echo "$install_directory" >> "$GITHUB_PATH"

installed_version="$("${install_directory}/opencode" --version)"
if [[ "$installed_version" != "$OPENCODE_VERSION" ]]; then
    echo "Expected OpenCode ${OPENCODE_VERSION}, installed ${installed_version}." >&2
    exit 1
fi

echo "Installed checksum-verified OpenCode ${OPENCODE_VERSION}."
