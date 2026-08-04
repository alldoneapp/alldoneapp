// The bundler tooling requires Node 22+ (the app root remains pinned to Node 14
// for npm-6 installs — see CLAUDE.md "Required versions"). Fail fast with a clear
// message instead of a cryptic webpack/babel crash under the wrong Node.
const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
    console.error(
        `web-bundler requires Node >= 22, but this is Node ${process.versions.node}.\n` +
            'Run "nvm use 22" inside web-bundler/ (the repo root stays on Node 14).'
    )
    process.exit(1)
}
