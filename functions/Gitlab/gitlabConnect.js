const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

// Minimum GitLab access level that can push branches / open MRs (Developer = 30).
const GITLAB_DEVELOPER_ACCESS = 30

/**
 * Parse a GitLab repository URL into { host, path, normalizedUrl }.
 * Accepts forms like https://gitlab.com/group/sub/repo(.git) and self-managed hosts.
 */
function parseGitlabRepoUrl(rawUrl) {
    let url = (rawUrl || '').trim()
    if (!url) throw new HttpsError('invalid-argument', 'A GitLab repository URL is required.')
    url = url.replace(/\.git$/i, '').replace(/\/+$/, '')
    let parsed
    try {
        parsed = new URL(url)
    } catch (_) {
        throw new HttpsError('invalid-argument', 'That does not look like a valid GitLab repository URL.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpsError('invalid-argument', 'The repository URL must start with https://.')
    }
    const host = `${parsed.protocol}//${parsed.host}`
    const path = parsed.pathname.replace(/^\/+/, '')
    if (!path || !path.includes('/')) {
        throw new HttpsError('invalid-argument', 'The repository URL must include the group/repo path.')
    }
    return { host, path, normalizedUrl: `${host}/${path}` }
}

// Call the GitLab REST API; maps network failures to a clean HttpsError.
async function gitlabApi(host, apiPath, token) {
    try {
        return await fetch(`${host}/api/v4/${apiPath}`, { headers: { 'PRIVATE-TOKEN': token } })
    } catch (_) {
        throw new HttpsError('unavailable', `Could not reach GitLab at ${host}.`)
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
 * Connect a GitLab repo to a project for the calling user.
 * - Validates the token + repo access against the GitLab API.
 * - Stores the token in the per-user private doc (server-write only).
 * - Stores the (non-secret) repo URL / base branch / host on the project doc.
 */
async function connectGitlabRepo({ userId, projectId, token, repoUrl, baseBranch }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    token = (token || '').trim()
    if (!token) throw new HttpsError('invalid-argument', 'A GitLab access token is required.')

    await assertProjectMember(projectId, userId)
    const { host, path, normalizedUrl } = parseGitlabRepoUrl(repoUrl)

    // 1) Validate the token identity.
    const userResp = await gitlabApi(host, 'user', token)
    if (userResp.status === 401 || userResp.status === 403) {
        throw new HttpsError('permission-denied', 'The GitLab token is invalid, expired, or lacks the "api" scope.')
    }
    if (!userResp.ok) {
        throw new HttpsError('unavailable', `GitLab returned an error validating the token (HTTP ${userResp.status}).`)
    }
    const gitlabUser = await userResp.json().catch(() => ({}))

    // 2) Validate repo access + read the default branch / permissions.
    const projResp = await gitlabApi(host, `projects/${encodeURIComponent(path)}`, token)
    if (projResp.status === 404) {
        throw new HttpsError(
            'not-found',
            'The token cannot see that repository. Check the URL, and that the token has "api" + "write_repository" scope and access to the project.'
        )
    }
    if (!projResp.ok) {
        throw new HttpsError(
            'unavailable',
            `GitLab returned an error reading the repository (HTTP ${projResp.status}).`
        )
    }
    const repo = await projResp.json().catch(() => ({}))
    const accessLevel = Math.max(
        (repo.permissions && repo.permissions.project_access && repo.permissions.project_access.access_level) || 0,
        (repo.permissions && repo.permissions.group_access && repo.permissions.group_access.access_level) || 0
    )
    const canPush = accessLevel >= GITLAB_DEVELOPER_ACCESS
    const resolvedBase = (baseBranch || '').trim() || repo.default_branch || 'main'

    // 3) Persist. Token → per-user private doc; repo config → project doc (shared, non-secret).
    const db = admin.firestore()
    await db.doc(`users/${userId}/private/gitlabAuth_${projectId}`).set(
        {
            token,
            host,
            repoPath: path,
            username: gitlabUser.username || '',
            name: gitlabUser.name || '',
            email: gitlabUser.email || gitlabUser.public_email || '',
            tokenLast4: token.slice(-4),
            canPush,
            createdAt: Date.now(),
            lastUsed: Date.now(),
        },
        { merge: true }
    )
    await db.doc(`projects/${projectId}`).set(
        {
            gitlabRepoUrl: normalizedUrl,
            gitlabBaseBranch: resolvedBase,
            gitlabHost: host,
            gitlabConnectedAt: Date.now(),
        },
        { merge: true }
    )

    return {
        success: true,
        username: gitlabUser.username || '',
        repoName: repo.path_with_namespace || path,
        defaultBranch: resolvedBase,
        canPush,
        warning: canPush
            ? null
            : 'This token has read-only access to the repo. It can clone but cannot push a Merge Request — use a token with Developer access (or higher) and the write_repository scope.',
    }
}

/**
 * Disconnect GitLab for the calling user. Always removes this user's token. Only clears the
 * shared repo config (unlinking it for everyone) when explicitly requested by a member.
 */
async function disconnectGitlabRepo({ userId, projectId, clearProjectRepo = false }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    const db = admin.firestore()
    await db
        .doc(`users/${userId}/private/gitlabAuth_${projectId}`)
        .delete()
        .catch(() => {})
    if (clearProjectRepo) {
        await assertProjectMember(projectId, userId)
        await db
            .doc(`projects/${projectId}`)
            .set({ gitlabRepoUrl: '', gitlabBaseBranch: '', gitlabHost: '', gitlabConnectedAt: null }, { merge: true })
    }
    return { success: true }
}

module.exports = { connectGitlabRepo, disconnectGitlabRepo, parseGitlabRepoUrl }
