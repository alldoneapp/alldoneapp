const admin = require('firebase-admin')

const { GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')

const TOOL_SCHEMA_CACHE_VERSION_DOC_PREFIX = 'runtimeCaches/toolSchemaVersions/projects'
const TOOL_SCHEMA_GLOBAL_VERSION_DOC_PATH = 'runtimeCaches/toolSchemaVersions/global/state'
const LOCAL_VERSION_CACHE_TTL = 60 * 1000
const localVersionCache = new Map()

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' ? projectId.trim() : ''
}

function getProjectVersionDocRef(projectId) {
    return admin.firestore().doc(`${TOOL_SCHEMA_CACHE_VERSION_DOC_PREFIX}/${projectId}`)
}

function getGlobalVersionDocRef() {
    return admin.firestore().doc(TOOL_SCHEMA_GLOBAL_VERSION_DOC_PATH)
}

function getCacheKeyForProjectVersion(projectId) {
    return `project:${projectId}`
}

function getCacheKeyForGlobalVersion() {
    return 'global'
}

async function getProjectToolSchemaVersion(projectId) {
    const normalizedProjectId = normalizeProjectId(projectId)
    if (!normalizedProjectId) return 0

    const now = Date.now()
    const cacheKey = getCacheKeyForProjectVersion(normalizedProjectId)
    const cached = localVersionCache.get(cacheKey)
    if (cached && now - cached.timestamp < LOCAL_VERSION_CACHE_TTL) {
        return cached.version
    }

    let version = 0
    try {
        const snapshot = await getProjectVersionDocRef(normalizedProjectId).get()
        if (snapshot.exists) {
            version = Number(snapshot.data()?.assistantTopologyVersion || 0)
            if (!Number.isFinite(version) || version < 0) version = 0
        }
    } catch (error) {
        console.warn('🔧 TOOL SCHEMAS VERSION: READ_FAILED', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    localVersionCache.set(cacheKey, {
        timestamp: now,
        version,
    })

    return version
}

async function getGlobalToolSchemaVersion() {
    const now = Date.now()
    const cacheKey = getCacheKeyForGlobalVersion()
    const cached = localVersionCache.get(cacheKey)
    if (cached && now - cached.timestamp < LOCAL_VERSION_CACHE_TTL) {
        return cached.version
    }

    let version = 0
    try {
        const snapshot = await getGlobalVersionDocRef().get()
        if (snapshot.exists) {
            version = Number(snapshot.data()?.assistantTopologyVersion || 0)
            if (!Number.isFinite(version) || version < 0) version = 0
        }
    } catch (error) {
        console.warn('🔧 TOOL SCHEMAS VERSION: GLOBAL_READ_FAILED', {
            error: error.message,
        })
    }

    localVersionCache.set(cacheKey, {
        timestamp: now,
        version,
    })
    return version
}

async function getToolSchemasCacheContextVersion(toolRuntimeContext = null) {
    const projectId = normalizeProjectId(toolRuntimeContext?.projectId)
    if (!projectId) return 'p0:g0:x0'

    const includeGlobalVersion = projectId !== GLOBAL_PROJECT_ID
    const [projectVersion, globalProjectVersion, globalTopologyVersion] = await Promise.all([
        getProjectToolSchemaVersion(projectId),
        includeGlobalVersion ? getProjectToolSchemaVersion(GLOBAL_PROJECT_ID) : Promise.resolve(0),
        getGlobalToolSchemaVersion(),
    ])

    return `p${projectVersion}:g${globalProjectVersion}:x${globalTopologyVersion}`
}

async function bumpProjectToolSchemasCacheVersion(projectId, reason = 'assistant_change') {
    const normalizedProjectId = normalizeProjectId(projectId)
    if (!normalizedProjectId) return

    try {
        const updatePayload = {
            assistantTopologyVersion: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: Date.now(),
            lastReason: String(reason || 'assistant_change').slice(0, 80),
        }
        await Promise.all([
            getProjectVersionDocRef(normalizedProjectId).set(updatePayload, { merge: true }),
            getGlobalVersionDocRef().set(updatePayload, { merge: true }),
        ])
        console.log('📈 METRIC TOOL_SCHEMAS_VERSION', {
            eventName: 'VERSION_BUMP',
            projectId: normalizedProjectId,
            reason: String(reason || 'assistant_change').slice(0, 80),
        })
        localVersionCache.delete(getCacheKeyForProjectVersion(normalizedProjectId))
        localVersionCache.delete(getCacheKeyForGlobalVersion())
    } catch (error) {
        console.warn('🔧 TOOL SCHEMAS VERSION: BUMP_FAILED', {
            projectId: normalizedProjectId,
            reason,
            error: error.message,
        })
    }
}

module.exports = {
    getToolSchemasCacheContextVersion,
    bumpProjectToolSchemasCacheVersion,
}
