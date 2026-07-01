const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')
const { JWT } = require('google-auth-library')

// Read-only OAuth scopes. cloud-platform.read-only grants read across the GCP services that honor
// it (Firestore, Cloud Logging, Resource Manager, …); logging.read is added explicitly so log
// reads still work for a service account scoped only to logging. Minting the VM's token with these
// scopes means it can NEVER mutate anything through it, independent of the service account's own
// IAM roles — a second read-only layer on top of whatever roles the user granted the SA.
const GCP_READONLY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform.read-only',
    'https://www.googleapis.com/auth/logging.read',
]

// Parse + sanity-check a pasted service-account key JSON. Returns the parsed object.
function parseServiceAccountKey(rawKey) {
    const text = (rawKey || '').trim()
    if (!text) throw new HttpsError('invalid-argument', 'A Google Cloud service account key (JSON) is required.')
    let sa
    try {
        sa = JSON.parse(text)
    } catch (_) {
        throw new HttpsError('invalid-argument', 'That does not look like a valid service account key JSON.')
    }
    if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
        throw new HttpsError(
            'invalid-argument',
            'The JSON must be a Google Cloud service account key with client_email and private_key.'
        )
    }
    return sa
}

// Mint a short-lived, read-only access token from a service account key. We hold the private key,
// so this signs a JWT and exchanges it for an access token directly — no impersonation or
// iam.serviceAccountTokenCreator role needed. Returns { accessToken, expiresAtMs }.
async function mintGcpAccessToken(serviceAccount, scopes = GCP_READONLY_SCOPES) {
    const client = new JWT({
        email: serviceAccount.client_email,
        key: serviceAccount.private_key,
        scopes,
    })
    let creds
    try {
        creds = await client.authorize() // { access_token, expiry_date, ... }
    } catch (error) {
        throw new HttpsError(
            'permission-denied',
            `The service account key could not be used to obtain an access token: ${error.message}`
        )
    }
    if (!creds || !creds.access_token) {
        throw new HttpsError('permission-denied', 'The service account key did not return an access token.')
    }
    return { accessToken: creds.access_token, expiresAtMs: creds.expiry_date || Date.now() + 55 * 60 * 1000 }
}

// Probe: can this token list Firestore collection ids? (needs datastore.viewer / Viewer)
async function probeFirestoreRead(gcpProjectId, accessToken) {
    try {
        const resp = await fetch(
            `https://firestore.googleapis.com/v1/projects/${gcpProjectId}/databases/(default)/documents:listCollectionIds`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageSize: 1 }),
            }
        )
        return resp.ok
    } catch (_) {
        return false
    }
}

// Probe: can this token read Cloud Logging entries? (needs logging.viewer / Viewer)
async function probeLoggingRead(gcpProjectId, accessToken) {
    try {
        const resp = await fetch('https://logging.googleapis.com/v2/entries:list', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ resourceNames: [`projects/${gcpProjectId}`], pageSize: 1 }),
        })
        return resp.ok
    } catch (_) {
        return false
    }
}

// Only project members may connect/disconnect a Google Cloud project for a project.
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
 * Connect a Google Cloud project to a project for the calling user.
 * - Validates the service-account key by minting a read-only token from it.
 * - Probes which reads (Firestore / Cloud Logging) the key actually has, and refuses a key that
 *   can read neither.
 * - Stores the key in the per-user private doc (server-write only; never returned to the client).
 *
 * The connection is purely per-user: the VM reads the requesting user's own Google Cloud project,
 * so nothing is written to the shared project doc.
 */
async function connectGcpProject({ userId, projectId, serviceAccountKey, gcpProjectId }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    await assertProjectMember(projectId, userId)

    const sa = parseServiceAccountKey(serviceAccountKey)
    const resolvedGcpProjectId = (gcpProjectId || '').trim() || sa.project_id
    if (!resolvedGcpProjectId) {
        throw new HttpsError(
            'invalid-argument',
            'Could not determine the Google Cloud project id. Include it in the key or enter it manually.'
        )
    }

    // 1) Validate the key can mint a token (proves the private key is valid + the SA is active).
    const { accessToken } = await mintGcpAccessToken(sa)

    // 2) Probe the read capabilities we support, so the UI can show what's available and we can
    //    reject a key that can read nothing useful.
    const [firestoreRead, loggingRead] = await Promise.all([
        probeFirestoreRead(resolvedGcpProjectId, accessToken),
        probeLoggingRead(resolvedGcpProjectId, accessToken),
    ])
    const capabilities = []
    if (firestoreRead) capabilities.push('firestore.read')
    if (loggingRead) capabilities.push('logging.read')
    if (!capabilities.length) {
        throw new HttpsError(
            'permission-denied',
            'The service account authenticated, but it has no read access to Firestore or Cloud Logging in that ' +
                'project. Grant it Viewer (or datastore.viewer + logging.viewer) and try again.'
        )
    }

    // 3) Persist. The key → per-user private doc (secret, server-write only).
    await admin
        .firestore()
        .doc(`users/${userId}/private/gcpAuth_${projectId}`)
        .set(
            {
                serviceAccountKey: JSON.stringify(sa),
                gcpProjectId: resolvedGcpProjectId,
                clientEmail: sa.client_email,
                privateKeyId: sa.private_key_id || '',
                keyLast4: (sa.private_key_id || '').slice(-4),
                capabilities,
                createdAt: Date.now(),
                lastUsed: Date.now(),
            },
            { merge: true }
        )

    return {
        success: true,
        gcpProjectId: resolvedGcpProjectId,
        clientEmail: sa.client_email,
        capabilities,
    }
}

/**
 * Disconnect Google Cloud for the calling user. Removes this user's stored key. Nothing is shared
 * at the project level, so there is no project-wide state to clear.
 */
async function disconnectGcpProject({ userId, projectId }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')
    await admin
        .firestore()
        .doc(`users/${userId}/private/gcpAuth_${projectId}`)
        .delete()
        .catch(() => {})
    return { success: true }
}

module.exports = {
    connectGcpProject,
    disconnectGcpProject,
    parseServiceAccountKey,
    mintGcpAccessToken,
    GCP_READONLY_SCOPES,
}
