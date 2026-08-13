'use strict'

class DefaultProjectError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const normalizeDefaultProjectId = projectId => (typeof projectId === 'string' ? projectId.trim() : '')

async function setDefaultProjectForUser(db, userId, projectId) {
    const normalizedProjectId = normalizeDefaultProjectId(projectId)
    if (projectId !== undefined && typeof projectId !== 'string') {
        throw new DefaultProjectError('invalid-argument', 'projectId must be a string')
    }

    if (normalizedProjectId) {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        if (!projectDoc.exists || projectDoc.data()?.creatorId !== userId) {
            throw new DefaultProjectError('permission-denied', 'The default project must be owned by the user')
        }
    }

    await db.doc(`users/${userId}`).update({ defaultProjectId: normalizedProjectId })
    return { success: true, defaultProjectId: normalizedProjectId }
}

module.exports = { DefaultProjectError, normalizeDefaultProjectId, setDefaultProjectForUser }
