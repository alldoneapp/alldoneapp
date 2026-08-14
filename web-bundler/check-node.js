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

// web-bundler has its OWN node_modules (separate lockfile), so it can be missing
// even when the repo root is fully installed - notably in a git worktree, which
// gets no node_modules at all. That failure is silent and dangerous: webpack's
// launcher reacts to a missing CLI by PROMPTING to install one, and on a
// non-interactive stdin the prompt takes EOF for an answer and exits 0. The npm
// script then reports success having compiled nothing, which for this pipeline
// means a deploy step that produces no artifact and never fails. Check the deps
// up front so that turns into a real error.
for (const dep of ['webpack', 'webpack-cli']) {
    try {
        require.resolve(dep)
    } catch {
        console.error(
            `web-bundler is missing its "${dep}" dependency.\n` +
                'Run "npm install" inside web-bundler/ (it has its own lockfile, separate from the repo root).'
        )
        process.exit(1)
    }
}
