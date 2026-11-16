// Keep in sync with .nvmrc. This lives inside functions/ so deployed workers and
// the isolated E2B template builder can use the same pin and bootstrap script.
const VM_NODE_VERSION = '22.23.5'
const VM_NODE_PREFIX = '/home/user/.local'

const VM_NODE_RUNTIME_SCRIPT = String.raw`#!/usr/bin/env bash
set -euo pipefail

alldone_node_version="$1"
alldone_node_prefix="$2"
alldone_user_home="$3"
alldone_node_root="$alldone_node_prefix/share/alldone-node"
alldone_node_dir="$alldone_node_root/v$alldone_node_version"
mkdir -p "$alldone_node_root" "$alldone_node_prefix/bin"
exec 9>"$alldone_node_root/install.lock"
flock -w 240 9

export PATH="$alldone_node_prefix/bin:$PATH"
if [ "$("$alldone_node_dir/bin/node" --version 2>/dev/null || true)" != "v$alldone_node_version" ]; then
    case "$(uname -m)" in
        x86_64) alldone_node_arch=x64 ;;
        aarch64|arm64) alldone_node_arch=arm64 ;;
        *) printf 'Unsupported VM Node architecture.\n' >&2; exit 1 ;;
    esac
    alldone_node_archive="node-v$alldone_node_version-linux-$alldone_node_arch.tar.gz"
    alldone_node_url="https://nodejs.org/dist/v$alldone_node_version"
    # Home is disk-backed; E2B's small /tmp tmpfs is unsuitable for runtime downloads.
    alldone_node_staging="$(mktemp -d "$alldone_node_root/.install.XXXXXX")"
    trap 'rm -rf -- "$alldone_node_staging"' EXIT
    printf 'VM_NODE_INSTALLING %s\n' "$alldone_node_version"
    for alldone_node_file in "$alldone_node_archive" SHASUMS256.txt; do
        curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
            --connect-timeout 10 --max-time 120 --retry 2 \
            "$alldone_node_url/$alldone_node_file" -o "$alldone_node_staging/$alldone_node_file"
    done
    alldone_node_checksum="$(awk -v name="$alldone_node_archive" '$2 == name { print $1 }' "$alldone_node_staging/SHASUMS256.txt")"
    [[ "$alldone_node_checksum" =~ ^[a-fA-F0-9]{64}$ ]] || { printf 'Missing Node archive checksum.\n' >&2; exit 1; }
    (cd "$alldone_node_staging" && printf '%s  %s\n' "$alldone_node_checksum" "$alldone_node_archive" | sha256sum -c - >/dev/null)
    mkdir "$alldone_node_staging/runtime"
    tar -xzf "$alldone_node_staging/$alldone_node_archive" -C "$alldone_node_staging/runtime" --strip-components=1
    [ "$("$alldone_node_staging/runtime/bin/node" --version)" = "v$alldone_node_version" ]
    # A previous interrupted/invalid install must not leave a nested runtime directory.
    rm -rf -- "$alldone_node_dir"
    mv "$alldone_node_staging/runtime" "$alldone_node_dir"
fi

for alldone_node_binary in node npm npx corepack; do
    if [ -e "$alldone_node_dir/bin/$alldone_node_binary" ]; then
        ln -sfn "$alldone_node_dir/bin/$alldone_node_binary" "$alldone_node_prefix/bin/$alldone_node_binary"
    fi
done
hash -r
[ "$(node --version)" = "v$alldone_node_version" ]
case "$(npm --version)" in
    10.*) ;;
    *) printf 'The VM Node distribution must include npm 10.\n' >&2; exit 1 ;;
esac

# Agent tools can start login/interactive shells, which may restore the managed
# template's nvm PATH. Put our runtime first after those shell initializers too.
alldone_node_path_line="export PATH=\"$alldone_node_prefix/bin:\$PATH\""
alldone_node_profile="$alldone_user_home/.profile"
for alldone_node_candidate in .bash_profile .bash_login; do
    if [ -f "$alldone_user_home/$alldone_node_candidate" ]; then
        alldone_node_profile="$alldone_user_home/$alldone_node_candidate"
        break
    fi
done
for alldone_node_shell_file in "$alldone_node_profile" "$alldone_user_home/.bashrc"; do
    if ! grep -qxF "$alldone_node_path_line" "$alldone_node_shell_file" 2>/dev/null; then
        printf '\n%s\n' "$alldone_node_path_line" >> "$alldone_node_shell_file"
    fi
done
printf 'VM_NODE_READY %s\n' "$(node --version)"
`

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`

function buildVmNodeRuntimeCommand({ prefix = VM_NODE_PREFIX, userHome = '/home/user' } = {}) {
    return `bash -c ${shellQuote(VM_NODE_RUNTIME_SCRIPT)} -- ${shellQuote(VM_NODE_VERSION)} ${shellQuote(prefix)} ${shellQuote(userHome)}`
}

async function ensureVmNodeRuntime(sandbox) {
    // Never continue on the template's old Node when a download or verification fails.
    await sandbox.commands.run(buildVmNodeRuntimeCommand(), { timeoutMs: 5 * 60 * 1000 })
}

module.exports = { VM_NODE_VERSION, VM_NODE_PREFIX, buildVmNodeRuntimeCommand, ensureVmNodeRuntime }
