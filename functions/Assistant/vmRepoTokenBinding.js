// Binds a member's GitHub/GitLab token to the repository it was validated for.
//
// security audit 2026-11 (vmJobRunner:loadRepoContext-token-bound-to-member-writable-repo-url):
// the repo URL, API base and base branch on `projects/{projectId}` are shared fields any project
// member can write through the client SDK. A VM coding job used to pair them with the REQUESTING
// user's token, so a member who pointed `githubRepoUrl` / `githubApiBase` at a server of their own
// received the next member's token (clone credential helper, `curl $GH_API … $GITHUB_TOKEN`).
//
// The invariant: a token is only ever presented to the host, API base and repository recorded in
// the token owner's own `users/{uid}/private/{provider}Auth_{projectId}` document when
// `connectGithubRepo` / `connectGitlabRepo` validated it. The project doc only says WHICH repo the
// project uses; when it disagrees with what the token was validated for, the job gets no token.

const { parseGithubRepoUrl } = require('../Github/githubConnect')
const { parseGitlabRepoUrl } = require('../Gitlab/gitlabConnect')

// A branch name we are willing to hand to git and to quote in the agent prompt. The base branch is
// also a member-writable project field, so anything that looks like an option or carries
// whitespace/quotes falls back to `main`.
const SAFE_BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/

function sanitizeBaseBranch(value) {
    const branch = typeof value === 'string' ? value.trim() : ''
    return SAFE_BRANCH_PATTERN.test(branch) ? branch : 'main'
}

function safeParse(parse, url) {
    try {
        return parse(url)
    } catch (_) {
        return null
    }
}

function sameRepository(a, b) {
    if (!a || !b) return false
    // URL parsing already lower-cases the host; providers treat the repository path
    // case-insensitively, and both sides are on the SAME origin, so the token never leaves it.
    return a.host === b.host && a.path.toLowerCase() === b.path.toLowerCase()
}

/**
 * The repository a token doc was validated for, or null when the doc carries no usable binding.
 * Returns { repoUrl, origin, apiBase?, repoSlug?, repoPath? } in the provider's normalized form.
 */
function resolveTokenBoundRepository(provider, tokenData = {}) {
    const host = typeof tokenData.host === 'string' ? tokenData.host.trim() : ''
    if (!host) return null
    if (provider === 'github') {
        const slug = typeof tokenData.repoSlug === 'string' ? tokenData.repoSlug.trim() : ''
        if (!slug) return null
        const parsed = safeParse(parseGithubRepoUrl, `${host}/${slug}`)
        if (!parsed) return null
        return {
            repoUrl: parsed.normalizedUrl,
            origin: parsed.host,
            // Derived from the validated host exactly as githubConnect derives it — never read from
            // the shared project doc's `githubApiBase`.
            apiBase: parsed.apiBase,
            repoSlug: parsed.slug,
            compare: { host: parsed.host, path: parsed.slug },
        }
    }
    if (provider === 'gitlab') {
        const repoPath = typeof tokenData.repoPath === 'string' ? tokenData.repoPath.trim() : ''
        if (!repoPath) return null
        const parsed = safeParse(parseGitlabRepoUrl, `${host}/${repoPath}`)
        if (!parsed) return null
        return {
            repoUrl: parsed.normalizedUrl,
            origin: parsed.host,
            repoPath: parsed.path,
            compare: { host: parsed.host, path: parsed.path },
        }
    }
    return null
}

/**
 * Decide whether `tokenData` may be used for the project's configured repo URL.
 * Returns { allowed: true, bound } or { allowed: false, reason }.
 */
function bindTokenToProjectRepository(provider, projectRepoUrl, tokenData = {}) {
    const bound = resolveTokenBoundRepository(provider, tokenData)
    if (!bound) return { allowed: false, reason: 'token_unbound' }
    const parse = provider === 'github' ? parseGithubRepoUrl : parseGitlabRepoUrl
    const configured = safeParse(parse, projectRepoUrl)
    if (!configured) return { allowed: false, reason: 'project_repo_invalid' }
    const configuredCompare =
        provider === 'github'
            ? { host: configured.host, path: configured.slug }
            : { host: configured.host, path: configured.path }
    if (!sameRepository(configuredCompare, bound.compare)) {
        return { allowed: false, reason: 'repo_mismatch' }
    }
    return { allowed: true, bound }
}

module.exports = {
    SAFE_BRANCH_PATTERN,
    sanitizeBaseBranch,
    resolveTokenBoundRepository,
    bindTokenToProjectRepository,
}
