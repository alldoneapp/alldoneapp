const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

/**
 * Parse a GitHub repository URL into { host, owner, repo, slug, apiBase, normalizedUrl }.
 * Accepts https://github.com/owner/repo(.git) and GitHub Enterprise Server hosts.
 */
function parseGithubRepoUrl(rawUrl) {
    let url = (rawUrl || '').trim()
    if (!url) throw new HttpsError('invalid-argument', 'A GitHub repository URL is required.')
    url = url.replace(/\.git$/i, '').replace(/\/+$/, '')
    let parsed
    try {
        parsed = new URL(url)
    } catch (_) {
        throw new HttpsError('invalid-argument', 'That does not look like a valid GitHub repository URL.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpsError('invalid-argument', 'The repository URL must start with https://.')
    }
    const host = `${parsed.protocol}//${parsed.host}`
    const segs = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
    if (segs.length < 2) {
        throw new HttpsError('invalid-argument', 'The repository URL must include the owner/repo path.')
    }
    const owner = segs[0]
    const repo = segs[1]
    // github.com → api.github.com; GitHub Enterprise Server → https://<host>/api/v3
    const isDotCom = /(^|\.)github\.com$/i.test(parsed.host)
    const apiBase = isDotCom ? 'https://api.github.com' : `${host}/api/v3`
    return { host, owner, repo, slug: `${owner}/${repo}`, apiBase, normalizedUrl: `${host}/${owner}/${repo}` }
}

// Call the GitHub REST API; maps network failures to a clean HttpsError.
async function githubApi(apiBase, apiPath, token) {
    try {
        return await fetch(`${apiBase}/${apiPath}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Alldone-App',
            },
        })
    } catch (_) {
        throw new HttpsError('unavailable', `Could not reach GitHub at ${apiBase}.`)
    }
}

// Only project members may connect/disconnect a repo for a project.
async function assertProjectMember(projectId, userId) {
    const snap = await admin.firestore().doc(`projects/${projectId}`).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Project not found.')
    const data = snap.data() || {}
    const userIds = Array.isArray(data.userIds) ? data.userIds : []
    if (!userIds.includes(userId)) {
        throw new HttpsError('permission-denied', 'You are not a member of this project.')
    }
    return data
}

/**
 * Connect a GitHub repo to a project for the calling user.
 * - Validates the token + repo access against the GitHub API.
 * - Stores the token in the per-user private doc (server-write only).
 * - Stores the (non-secret) repo URL / base branch / host on the project doc.
 */
async function connectGithubRepo({ userId, projectId, token, repoUrl, baseBranch }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    token = (token || '').trim()
    if (!token) throw new HttpsError('invalid-argument', 'A GitHub access token is required.')

    await assertProjectMember(projectId, userId)
    const { host, owner, repo, slug, apiBase, normalizedUrl } = parseGithubRepoUrl(repoUrl)

    // 1) Validate the token identity.
    const userResp = await githubApi(apiBase, 'user', token)
    if (userResp.status === 401 || userResp.status === 403) {
        throw new HttpsError('permission-denied', 'The GitHub token is invalid, expired, or lacks the required scopes.')
    }
    if (!userResp.ok) {
        throw new HttpsError('unavailable', `GitHub returned an error validating the token (HTTP ${userResp.status}).`)
    }
    const ghUser = await userResp.json().catch(() => ({}))

    // 2) Validate repo access + read the default branch / push permission.
    const repoResp = await githubApi(apiBase, `repos/${owner}/${repo}`, token)
    if (repoResp.status === 404) {
        throw new HttpsError(
            'not-found',
            'The token cannot see that repository. Check the URL, and that the token has access to it (Contents + Pull requests read/write).'
        )
    }
    if (!repoResp.ok) {
        throw new HttpsError(
            'unavailable',
            `GitHub returned an error reading the repository (HTTP ${repoResp.status}).`
        )
    }
    const repoData = await repoResp.json().catch(() => ({}))
    const canPush = !!(repoData.permissions && repoData.permissions.push)
    const resolvedBase = (baseBranch || '').trim() || repoData.default_branch || 'main'
    const login = ghUser.login || ''
    // GitHub often hides the email; fall back to the noreply address so commits still attribute.
    const email = ghUser.email || (login ? `${login}@users.noreply.github.com` : '')

    // 3) Persist. Token → per-user private doc; repo config → project doc (shared, non-secret).
    const db = admin.firestore()
    await db.doc(`users/${userId}/private/githubAuth_${projectId}`).set(
        {
            token,
            host,
            apiBase,
            repoSlug: slug,
            username: login,
            name: ghUser.name || '',
            email,
            tokenLast4: token.slice(-4),
            canPush,
            createdAt: Date.now(),
            lastUsed: Date.now(),
        },
        { merge: true }
    )
    await db.doc(`projects/${projectId}`).set(
        {
            githubRepoUrl: normalizedUrl,
            githubBaseBranch: resolvedBase,
            githubHost: host,
            githubApiBase: apiBase,
            githubConnectedAt: Date.now(),
        },
        { merge: true }
    )

    return {
        success: true,
        username: login,
        repoName: repoData.full_name || slug,
        defaultBranch: resolvedBase,
        canPush,
        warning: canPush
            ? null
            : 'This token has read-only access to the repo. It can clone but cannot open a Pull Request — use a token with write access (Contents + Pull requests: read/write).',
    }
}

/**
 * Disconnect GitHub for the calling user. Always removes this user's token. Only clears the
 * shared repo config (unlinking it for everyone) when explicitly requested by a member.
 */
async function disconnectGithubRepo({ userId, projectId, clearProjectRepo = false }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    const db = admin.firestore()
    await db
        .doc(`users/${userId}/private/githubAuth_${projectId}`)
        .delete()
        .catch(() => {})
    if (clearProjectRepo) {
        await assertProjectMember(projectId, userId)
        await db.doc(`projects/${projectId}`).set(
            {
                githubRepoUrl: '',
                githubBaseBranch: '',
                githubHost: '',
                githubApiBase: '',
                githubConnectedAt: null,
            },
            { merge: true }
        )
    }
    return { success: true }
}

module.exports = { connectGithubRepo, disconnectGithubRepo, parseGithubRepoUrl }
