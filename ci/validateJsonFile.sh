#!/bin/sh
# Validate that a file holds a JSON object, without ever printing its content.
#
# Usage: sh ci/validateJsonFile.sh <file> <ci-variable-name>
#
# Used by the runner image jobs, which write a secret CI variable (the functions env blob)
# to disk before baking it into an image. A malformed blob would bake an image whose
# getEnvFunctions() silently returns empty secrets, so the check must stay strict - but it
# must also be able to RUN in the job's image. Those jobs use the upstream
# google/cloud-sdk:slim, which since SDK 592.0.0 (2026-11-03) ships no python3 on PATH at
# all (its Dockerfile asserts `! command -v python3`; gcloud carries its own bundled
# Python). The previous inline `python3 -c ... 2>/dev/null || echo "not valid JSON"` then
# reported "command not found" as an invalid secret. So: find an interpreter, and report
# a missing one as exactly that.
#
# Exit codes: 0 valid object, 1 invalid content, 2 no usable JSON interpreter / bad usage.
#
# Diagnostics are sanitized: Python's json error messages are fixed templates plus a
# position, which is printed; Node's JSON.parse quotes a slice of the input, so for Node
# only the position is extracted. Nothing derived from the content is ever echoed.

file="$1"
variable="${2:-the CI variable}"

if [ -z "$file" ]; then
    echo "validateJsonFile: usage: validateJsonFile.sh <file> <ci-variable-name>" >&2
    exit 2
fi

fail() {
    echo "$file is not valid: $1 - check $variable" >&2
    exit 1
}

[ -f "$file" ] || fail "file does not exist"

# Size only, never content.
bytes=$(wc -c < "$file" | tr -d ' ')
# `echo "$EMPTY" > file` writes a single newline.
if [ "$bytes" -le 1 ] && [ -z "$(tr -d ' \t\r\n' < "$file")" ]; then
    fail "file is empty (${bytes} byte(s)); is the variable set and available to this branch/environment?"
fi

PYTHON_CHECK='
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        value = json.load(handle)
except json.JSONDecodeError as error:
    print("%s at line %d column %d (char %d)" % (error.msg, error.lineno, error.colno, error.pos))
    sys.exit(1)
except UnicodeDecodeError as error:
    print("not UTF-8 (byte offset %d)" % error.start)
    sys.exit(1)
if not isinstance(value, dict):
    print("top-level value is a JSON %s, expected an object" % type(value).__name__)
    sys.exit(1)
print("ok: JSON object with %d top-level key(s)" % len(value))
'

NODE_CHECK='
const fs = require("fs")
let value
try {
    value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
} catch (error) {
    // V8 messages quote a slice of the input; keep only the position.
    const match = /position (\d+)/.exec(String(error && error.message))
    console.log("JSON syntax error" + (match ? " at char " + match[1] : ""))
    process.exit(1)
}
if (value === null || typeof value !== "object" || Array.isArray(value)) {
    console.log("top-level value is " + (Array.isArray(value) ? "an array" : value === null ? "null" : "a " + typeof value) + ", expected an object")
    process.exit(1)
}
console.log("ok: JSON object with " + Object.keys(value).length + " top-level key(s)")
'

run_check() {
    # $1 = interpreter kind, $2 = interpreter path. Prints the sanitized result line.
    if [ "$1" = python ]; then
        result=$("$2" -I -c "$PYTHON_CHECK" "$file" 2>/dev/null)
    else
        result=$("$2" -e "$NODE_CHECK" "$file" 2>/dev/null)
    fi
    status=$?
    if [ "$status" -eq 0 ]; then
        echo "$file: $result (validated with $2)"
        exit 0
    fi
    if [ "$status" -eq 1 ] && [ -n "$result" ]; then
        fail "$result"
    fi
    # Anything else (crash, unexpected exit) is an interpreter problem, not a verdict.
    echo "validateJsonFile: $2 could not run the check (exit $status); trying the next interpreter" >&2
}

# Candidates in order. The bundled Python is what gcloud itself runs on in cloud-sdk
# images; CLOUDSDK_PYTHON is gcloud's own override for it.
GCLOUD_BUNDLED_PYTHON="${VALIDATE_JSON_BUNDLED_PYTHON:-/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3}"

for candidate in "$(command -v python3 2>/dev/null)" "${CLOUDSDK_PYTHON:-}" "$GCLOUD_BUNDLED_PYTHON"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        run_check python "$candidate"
    fi
done

node_path="$(command -v node 2>/dev/null)"
if [ -n "$node_path" ]; then
    run_check node "$node_path"
fi

echo "validateJsonFile: no usable JSON interpreter in this image (looked for python3 on PATH, \$CLOUDSDK_PYTHON, $GCLOUD_BUNDLED_PYTHON and node). This is an image problem, not a problem with $variable." >&2
exit 2
