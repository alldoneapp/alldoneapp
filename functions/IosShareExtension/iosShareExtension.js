'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')

const TOKEN_PREFIX = 'adshare_'
const TOKENS_COLLECTION = 'iosShareExtensionTokens'
const INSTALLATIONS_COLLECTION = 'iosShareExtensionInstallations'
const REQUESTS_COLLECTION = 'iosShareTaskRequests'
const MAX_TASK_NAME_LENGTH = 500
const REQUEST_CLAIM_TIMEOUT_MS = 5 * 60 * 1000

const rateBuckets = new Map()

function hashValue(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function isRateLimited(key, limit, windowMs, now = Date.now()) {
    const windowStart = Math.floor(now / windowMs)
    const bucketKey = `${key}:${windowStart}`
    const count = (rateBuckets.get(bucketKey) || 0) + 1
    rateBuckets.set(bucketKey, count)

    if (rateBuckets.size > 10000) {
        for (const existingKey of rateBuckets.keys()) {
            if (!existingKey.endsWith(`:${windowStart}`)) rateBuckets.delete(existingKey)
        }
    }
    return count > limit
}

function getRequestIp(req) {
    const forwarded = req.headers?.['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
    return req.ip || req.connection?.remoteAddress || 'unknown'
}

function normalizeInstallationId(value) {
    const id = String(value || '').trim()
    return /^[A-Za-z0-9._-]{16,128}$/.test(id) ? id : ''
}

function normalizeRequestId(value) {
    const id = String(value || '').trim()
    return /^[A-Za-z0-9._-]{8,128}$/.test(id) ? id : ''
}

function normalizeTaskName(value) {
    const name = String(value || '')
        .replace(/\r\n/g, '\n')
        .trim()
    if (!name || name.length > MAX_TASK_NAME_LENGTH) return ''
    return name
}

function resolveRuntimeProjectId() {
    if (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT) {
        return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    }
    try {
        const config = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
        if (config?.projectId) return config.projectId
    } catch (error) {
        // Fall through to the initialized Admin app when FIREBASE_CONFIG is malformed.
    }
    try {
        return admin.app().options.projectId || ''
    } catch (error) {
        return ''
    }
}

function buildTaskEndpointUrl(projectId = resolveRuntimeProjectId()) {
    if (process.env.FUNCTIONS_EMULATOR) {
        return `http://localhost:5001/${projectId || 'alldonestaging'}/europe-west1/iosShareTask`
    }
    return projectId ? `https://europe-west1-${projectId}.cloudfunctions.net/iosShareTask` : ''
}

async function mintIosShareExtensionToken(userId, rawInstallationId, deps = {}) {
    const installationId = normalizeInstallationId(rawInstallationId)
    if (!userId || !installationId) throw new Error('A valid installation ID is required')

    const db = deps.db || admin.firestore()
    const now = deps.now || Date.now()
    const userDoc = await db.doc(`users/${userId}`).get()
    if (!userDoc.exists) throw new Error('User not found')

    const token = `${TOKEN_PREFIX}${(deps.randomBytes || crypto.randomBytes)(32).toString('hex')}`
    const tokenHash = hashValue(token)
    const installationHash = hashValue(installationId)
    const installationRef = db.doc(`${INSTALLATIONS_COLLECTION}/${installationHash}`)
    const tokenRef = db.doc(`${TOKENS_COLLECTION}/${tokenHash}`)

    await db.runTransaction(async transaction => {
        const installationDoc = await transaction.get(installationRef)
        const previousTokenHash = installationDoc.exists ? installationDoc.data()?.tokenHash : null

        if (previousTokenHash && previousTokenHash !== tokenHash) {
            transaction.set(
                db.doc(`${TOKENS_COLLECTION}/${previousTokenHash}`),
                { revoked: true, revokedAt: now },
                { merge: true }
            )
        }

        transaction.set(tokenRef, {
            userId,
            installationHash,
            appId: 'ios-share-extension',
            tokenSuffix: token.slice(-4),
            revoked: false,
            createdAt: now,
            lastUsedAt: null,
        })
        transaction.set(installationRef, { userId, tokenHash, updatedAt: now })
    })

    return { token, endpointUrl: buildTaskEndpointUrl(deps.projectId) }
}

async function revokeIosShareExtensionToken(userId, rawInstallationId, deps = {}) {
    const installationId = normalizeInstallationId(rawInstallationId)
    if (!userId || !installationId) return { success: false }

    const db = deps.db || admin.firestore()
    const now = deps.now || Date.now()
    const installationRef = db.doc(`${INSTALLATIONS_COLLECTION}/${hashValue(installationId)}`)

    return db.runTransaction(async transaction => {
        const installationDoc = await transaction.get(installationRef)
        if (!installationDoc.exists || installationDoc.data()?.userId !== userId) return { success: false }

        const tokenHash = installationDoc.data()?.tokenHash
        if (tokenHash) {
            transaction.set(
                db.doc(`${TOKENS_COLLECTION}/${tokenHash}`),
                { revoked: true, revokedAt: now },
                { merge: true }
            )
        }
        transaction.delete(installationRef)
        return { success: true }
    })
}

async function resolveIosShareToken(token, deps = {}) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null

    const db = deps.db || admin.firestore()
    const tokenRef = db.doc(`${TOKENS_COLLECTION}/${hashValue(token)}`)
    const tokenDoc = await tokenRef.get()
    if (!tokenDoc.exists) return null

    const tokenData = tokenDoc.data() || {}
    if (tokenData.revoked || tokenData.appId !== 'ios-share-extension' || !tokenData.userId) return null

    const userDoc = await db.doc(`users/${tokenData.userId}`).get()
    if (!userDoc.exists) return null

    const now = deps.now || Date.now()
    if (!tokenData.lastUsedAt || now - tokenData.lastUsedAt > 5 * 60 * 1000) {
        tokenRef.set({ lastUsedAt: now }, { merge: true }).catch(() => null)
    }

    return { userId: tokenData.userId, userData: userDoc.data() || {} }
}

async function resolveHostProject(db, userId, userData) {
    const { ProjectService } = require('../shared/ProjectService')
    const projectService = new ProjectService({ database: db })
    await projectService.initialize()
    const projects = await projectService.getUserProjects(userId, {
        includeArchived: false,
        includeCommunity: false,
    })
    const writableProjects = projects.filter(project => project.userIds.includes(userId))
    if (writableProjects.length === 0) return null

    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId : ''
    return writableProjects.find(project => project.id === defaultProjectId) || writableProjects[0]
}

async function persistSharedTask({ db, userId, userData, taskName, now }) {
    const hostProject = await resolveHostProject(db, userId, userData)
    if (!hostProject) throw new Error('No writable project is available')

    const { TaskService } = require('../shared/TaskService')
    const moment = require('moment')
    const taskService = new TaskService({
        database: db,
        moment,
        idGenerator: () => db.collection('_').doc().id,
        enableFeeds: true,
        enableValidation: true,
        isCloudFunction: true,
    })
    await taskService.initialize()

    const feedUser = {
        uid: userId,
        id: userId,
        name: userData.displayName || userData.name || '',
        displayName: userData.displayName || userData.name || '',
        email: userData.email || '',
    }
    const result = await taskService.createAndPersistTask(
        {
            name: taskName,
            description: '',
            userId,
            projectId: hostProject.id,
            isPrivate: false,
            feedUser,
            now,
            projectRouting: {
                status: 'pending',
                source: 'ios_share_extension',
                hostProjectId: hostProject.id,
                requestedAt: now,
            },
        },
        {
            userId,
            projectId: hostProject.id,
            projectUserIds: hostProject.userIds,
        }
    )

    const taskId = result?.taskId || result?.task?.id
    if (result?.success === false || !taskId) throw new Error(result?.message || 'Task creation failed')
    return { taskId, projectId: hostProject.id }
}

async function createIosShareTask({ token, taskName: rawTaskName, requestId: rawRequestId }, deps = {}) {
    const taskName = normalizeTaskName(rawTaskName)
    const requestId = normalizeRequestId(rawRequestId)
    if (!taskName) throw Object.assign(new Error('Task name must contain 1 to 500 characters'), { status: 400 })
    if (!requestId) throw Object.assign(new Error('A valid request ID is required'), { status: 400 })

    const tokenUser = await (deps.resolveToken || resolveIosShareToken)(token, deps)
    if (!tokenUser) throw Object.assign(new Error('Open Alldone to reconnect sharing'), { status: 401 })

    const db = deps.db || admin.firestore()
    const now = deps.now || Date.now()
    const requestRef = db.doc(`${REQUESTS_COLLECTION}/${hashValue(`${tokenUser.userId}:${requestId}`)}`)
    const claim = await db.runTransaction(async transaction => {
        const requestDoc = await transaction.get(requestRef)
        const existing = requestDoc.exists ? requestDoc.data() || {} : null
        if (existing?.status === 'complete') return { complete: true, result: existing.result }
        if (existing?.status === 'processing' && now - Number(existing.startedAt || 0) < REQUEST_CLAIM_TIMEOUT_MS) {
            return { processing: true }
        }
        transaction.set(requestRef, {
            userId: tokenUser.userId,
            status: 'processing',
            startedAt: now,
            updatedAt: now,
        })
        return { claimed: true }
    })

    if (claim.complete) return claim.result
    if (claim.processing) throw Object.assign(new Error('This task is already being added'), { status: 409 })

    try {
        const result = await (deps.persistTask || persistSharedTask)({
            db,
            userId: tokenUser.userId,
            userData: tokenUser.userData,
            taskName,
            now,
        })
        await requestRef.set({ status: 'complete', result, updatedAt: Date.now() }, { merge: true })
        return result
    } catch (error) {
        await requestRef.set(
            { status: 'failed', error: String(error.message || error).slice(0, 200), updatedAt: Date.now() },
            { merge: true }
        )
        throw error
    }
}

async function handleIosShareTask(req, res) {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' })
        return
    }

    const token = req.body?.token
    const tokenKey = typeof token === 'string' ? hashValue(token).slice(0, 16) : 'invalid'
    const ip = getRequestIp(req)
    if (
        isRateLimited(`ios-share:ip:${ip}`, 120, 60 * 1000) ||
        isRateLimited(`ios-share:token:${tokenKey}`, 60, 60 * 1000)
    ) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded' })
        return
    }

    try {
        const result = await createIosShareTask(req.body || {})
        res.status(200).json({ success: true, ...result })
    } catch (error) {
        console.error('iosShareTask: error', { status: error.status || 500, error: error.message })
        res.status(error.status || 500).json({
            success: false,
            error: error.status ? error.message : 'Could not add task',
        })
    }
}

module.exports = {
    buildTaskEndpointUrl,
    createIosShareTask,
    handleIosShareTask,
    mintIosShareExtensionToken,
    normalizeInstallationId,
    normalizeRequestId,
    normalizeTaskName,
    resolveIosShareToken,
    revokeIosShareExtensionToken,
    __private__: {
        hashValue,
        persistSharedTask,
        resolveHostProject,
    },
}
