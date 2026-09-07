'use strict'

// The worker reuses three modules from `../browser` rather than carrying its own copies of them:
// the token verifier (or a rotated secret would stop meaning the same thing on the two sides) and
// the allowlist matcher (or the worker's idea of "allowlisted" would eventually diverge from the
// policy that minted its token — the failure this repo has already paid for once, with a writer and
// a reader each holding their own objectType→path map).
//
// They live in two places at runtime: `./shared/` inside the container image (the Dockerfile copies
// them there, because the image cannot reach outside its build context) and `../browser/` in the
// repository. Resolving both keeps the worker's own code testable in place — a module that can only
// be loaded inside a Docker image is a module nothing tests.

function requireShared(moduleName) {
    try {
        return require(`./shared/${moduleName}`)
    } catch (error) {
        if (error && error.code !== 'MODULE_NOT_FOUND') throw error
        return require(`../browser/${moduleName}`)
    }
}

module.exports = { requireShared }
