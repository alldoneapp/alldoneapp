// The whole repo runs Node 22+ since migration Stage 5 (see .nvmrc). Fail fast
// with a clear message instead of a cryptic webpack/babel crash under the wrong
// Node.
const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
    console.error(
        `web-bundler requires Node >= 22, but this is Node ${process.versions.node}.\n` +
            'Run "nvm use 22" (the repo-wide major, see .nvmrc).'
    )
    process.exit(1)
}
