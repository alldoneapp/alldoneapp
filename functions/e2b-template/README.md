# E2B template — `alldone-claude`

Sandbox image for the `execute_task_in_vm` assistant tool. The worker
([../Assistant/vmJobRunner.js](../Assistant/vmJobRunner.js)) spins up a sandbox from this
template, writes the objective + context into it, and runs Claude Code headless.

> **Optional optimization.** If `E2B_CLAUDE_TEMPLATE` is unset, the worker uses E2B's base
> image and `npm i -g @anthropic-ai/claude-code` at the start of each run (~30–60s slower cold
> start, but fully functional). Build this template to remove that per-run install.

This is a **Docker-free** build using E2B's Build System 2.0 — it runs remotely on E2B's
builders. No Docker, no Dockerfile, no `e2b` CLI login.

## Why this dir is isolated (and ESM)

The functions runtime pins **`e2b@^1.x`** because e2b **v2 cannot be loaded in our Node 20
CommonJS functions runtime** (its CJS bundle `require()`s ESM-only deps → `ERR_REQUIRE_ESM`;
its ESM bundle hits `Dynamic require of node:url` under raw `node`). The v2 **build** API only
runs cleanly under **`tsx`**, so the build tooling lives here as a separate `"type": "module"`
package with its own `e2b@^2.x` + `tsx` devDependencies. It never touches the runtime, and the
whole dir is excluded from the functions deploy (see `functions.ignore` in `firebase.json`).

## Build (no Docker)

```bash
cd functions/e2b-template
npm install

# Build remotely. Auth via your E2B API key (from https://e2b.dev/dashboard).
E2B_API_KEY=e2b_*** npm run build
# …or put E2B_API_KEY in functions/e2b-template/.env and just: npm run build
```

On success it prints the template name/ID. Edit the image steps in
[build.ts](build.ts) (it replaces what a Dockerfile would do).

## Wire it up

Set the template name so the worker uses it:

-   **Local:** `E2B_CLAUDE_TEMPLATE=alldone-claude` in `functions/.env`
    (or `"E2B_CLAUDE_TEMPLATE": "alldone-claude"` in `functions/env_functions.json`).
-   **Staging/prod:** add `E2B_CLAUDE_TEMPLATE` as a GitLab CI variable.

Also set the real `E2B_API_KEY` in the functions env — the worker uses it at runtime to spawn
sandboxes (the same key builds the template here).

## Verify

```bash
npx e2b sandbox spawn alldone-claude   # opens a shell in the sandbox
claude --version                       # should print a version
```

> The runtime `ANTHROPIC_API_KEY` is injected per-run by the worker as a sandbox env var —
> do **not** bake it into the image.
