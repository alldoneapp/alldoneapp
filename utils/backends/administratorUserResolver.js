const getRoleUserId = roleResult => {
    const userId = roleResult?.data?.userId
    return typeof userId === 'string' && userId.length > 0 ? userId : null
}

const createUnavailableError = (message, cause) => {
    const error = new Error(message)
    error.cause = cause
    return error
}

const isPermissionDenied = error =>
    error?.code === 'permission-denied' || String(error?.message || error).includes('permission-denied')

const recoverRealtimeConnectionSafely = async (recoverRealtimeConnection, warn, reason) => {
    if (!recoverRealtimeConnection) return
    try {
        await recoverRealtimeConnection(reason)
    } catch (error) {
        // The independent read is still authoritative and safe to use. The boot
        // integrity healer can make another bounded recovery attempt later.
        warn('[GlobalData] Could not restart Firestore after recovering the Administrator role:', error)
    }
}

const readUserAuthoritatively = async (userId, readUserResult) => {
    const result = await readUserResult(userId)
    if (result?.user) return { user: result.user, missing: false }

    // roles/administrator is readable by every authenticated client, while the full
    // users/{administratorUid} profile is private unless both users share a project. The role
    // pointer is sufficient for authorization/UI identity checks, so keep that safe identity
    // instead of retrying a private-profile read that strict rules intentionally deny.
    if (result?.error && isPermissionDenied(result.error)) {
        return { user: { uid: userId, roleOnly: true }, missing: false }
    }

    if (result?.error || !result?.verified) {
        throw createUnavailableError(
            `The Administrator user document /users/${userId} could not be verified`,
            result?.error
        )
    }

    return { user: null, missing: true }
}

/**
 * Resolve the global Administrator without confusing a transient Firestore read
 * with an intentionally absent role.
 *
 * The realtime client is the fast path. If it omits the role pointer, an
 * independent authenticated REST read decides whether the role is genuinely
 * unconfigured. User-document absence is already independently verified by
 * `fetchUserDataResult`; a failed verification throws so initial loading retries
 * and an existing watcher keeps its last valid Administrator. An expected strict-rules denial
 * retains only the authenticated role uid; it never exposes or synthesizes private profile data.
 */
export const resolveAdministratorUser = async ({
    readRoleFromClient,
    readRoleDirectly,
    readUserResult,
    recoverRealtimeConnection,
    warn = console.warn,
}) => {
    let clientRoleResult
    let clientRoleError
    let directRoleResult

    try {
        clientRoleResult = await readRoleFromClient()
    } catch (error) {
        clientRoleError = error
    }

    let userId = getRoleUserId(clientRoleResult)
    if (!userId) {
        try {
            directRoleResult = await readRoleDirectly()
        } catch (error) {
            throw createUnavailableError('The Administrator role could not be verified', error || clientRoleError)
        }

        userId = getRoleUserId(directRoleResult)
        if (!userId) return {}

        const clientFailure = clientRoleError ? 'failed' : 'reported no configured Administrator'
        warn(
            `[GlobalData] The realtime Firestore client ${clientFailure}, but a direct server read found ` +
                `roles/administrator -> ${userId}. Using the server result and reconnecting the streams.`
        )
        await recoverRealtimeConnectionSafely(
            recoverRealtimeConnection,
            warn,
            'recover the Administrator role omitted during initial load'
        )
    }

    let userResult = await readUserAuthoritatively(userId, readUserResult)
    if (userResult.user) return userResult.user

    // The user really is absent. Re-read the role independently before accepting
    // that answer: the client may have supplied an old pointer while the role was
    // moved to another user.
    if (!directRoleResult) {
        try {
            directRoleResult = await readRoleDirectly()
        } catch (error) {
            throw createUnavailableError('The Administrator role could not be re-verified', error)
        }
    }

    const directUserId = getRoleUserId(directRoleResult)
    if (!directUserId) {
        warn(`[GlobalData] roles/administrator no longer names a user; ignoring stale pointer ${userId}.`)
        return {}
    }

    if (directUserId !== userId) {
        warn(
            `[GlobalData] The realtime Firestore client returned stale Administrator ${userId}; ` +
                `the server now names ${directUserId}.`
        )
        await recoverRealtimeConnectionSafely(
            recoverRealtimeConnection,
            warn,
            'recover a stale Administrator role pointer'
        )
        userId = directUserId
        userResult = await readUserAuthoritatively(userId, readUserResult)
        if (userResult.user) return userResult.user
    }

    warn(`[GlobalData] roles/administrator points to missing user document /users/${userId}.`)
    return {}
}
