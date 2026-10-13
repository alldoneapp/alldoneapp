'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { __private__: menubar } = require('./menubarApp')
const { findUniqueProjectByTitle, resolveMenubarNoteProject } = require('./menubarNoteProjectResolver')
const { runWritingAssistant } = require('./writingAssistant')

const RUNS = 'menubarWritingRuns'
const MAX_REVISIONS = 20
const CHUNK_CHARACTERS = 600000
const MAX_IMAGE_BYTES = 5000000

function error(status, message) {
    return Object.assign(new Error(message), { status })
}
function id(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw error(400, `${name} is invalid`)
    return value
}
function sessionsRef(db, userId) {
    return db.collection(`users/${userId}/private/writing/sessions`)
}
function revisionRef(db, userId, sessionId, runId) {
    return sessionsRef(db, userId).doc(sessionId).collection('revisions').doc(runId)
}
function runIdFor(userId, requestId) {
    return crypto.createHash('sha256').update(`${userId}:${requestId}`).digest('hex')
}

function validateImage(raw) {
    const decoded = menubar.decodeAssistantMessageImage(raw)
    if (!decoded) throw error(400, 'A screenshot is required')
    const signature =
        decoded.mimeType === 'image/png'
            ? decoded.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : decoded.data.length >= 3 && decoded.data[0] === 255 && decoded.data[1] === 216 && decoded.data[2] === 255
    if (!signature) throw error(400, 'The screenshot does not match its image type')
    if (![raw.width, raw.height].every(n => Number.isInteger(n) && n > 0 && n <= 10000)) {
        throw error(400, 'Screenshot dimensions are invalid')
    }
    return {
        mimeType: decoded.mimeType,
        dataBase64: decoded.data.toString('base64'),
        width: raw.width,
        height: raw.height,
    }
}

function normalizeInput(body) {
    const requestId = id(body.requestId, 'requestId')
    if (body.instructions != null && typeof body.instructions !== 'string')
        throw error(400, 'Instructions must be text')
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
    if (instructions.length > 4000) throw error(400, 'Instructions must contain at most 4000 characters')
    const image = validateImage(body.image)
    const raw = body.textbox
    if (!raw || typeof raw !== 'object') throw error(400, 'Textbox context is required')
    const textbox = {}
    for (const [name, max] of Object.entries({
        appName: 200,
        windowTitle: 500,
        label: 500,
        text: 20000,
        selectedText: 20000,
    })) {
        if (typeof raw[name] !== 'string' || raw[name].length > max) throw error(400, `Textbox ${name} is invalid`)
        textbox[name] = raw[name]
    }
    for (const name of ['selectionLocation', 'selectionLength']) {
        if (!Number.isSafeInteger(raw[name]) || raw[name] < 0) throw error(400, `Textbox ${name} is invalid`)
        textbox[name] = raw[name]
    }
    const projectId = body.projectId == null ? null : body.projectId
    if (projectId !== null && (typeof projectId !== 'string' || !/^[^/]{1,160}$/.test(projectId)))
        throw error(400, 'projectId is invalid')
    const sessionId = body.sessionId == null ? null : id(body.sessionId, 'sessionId')
    return { requestId, instructions, image, textbox, projectId, sessionId }
}

async function authenticate(req, res, namespace) {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'POST') throw error(405, 'Method not allowed')
    const key = typeof req.body?.token === 'string' ? runIdFor('', req.body.token).slice(0, 16) : 'invalid'
    if (
        menubar.isRateLimited(`${namespace}:${key}`, namespace === 'writing-start' ? 15 : 180, 60000) ||
        menubar.isRateLimited(`${namespace}:ip:${req.ip || 'unknown'}`, 300, 60000)
    )
        throw error(429, 'Rate limit exceeded')
    const user = await menubar.resolveTokenUser(req.body?.token)
    if (!user) throw error(401, 'Invalid token')
    return user
}

function respondError(res, failure) {
    const status = failure.status || (failure.code === 'IMAGE_TOO_LARGE' ? 413 : 500)
    if (status === 500) console.error('menubarWriting failed', { code: failure.code || null, message: failure.message })
    res.status(status).json({
        success: false,
        error: status === 500 ? 'Writing request failed. Try again.' : failure.message,
    })
}

async function handleMenubarWritingStart(req, res) {
    try {
        const { userId, userData } = await authenticate(req, res, 'writing-start')
        let input
        try {
            input = normalizeInput(req.body || {})
        } catch (failure) {
            throw Object.assign(failure, { status: failure.status || (failure.code === 'IMAGE_TOO_LARGE' ? 413 : 400) })
        }
        const db = admin.firestore()
        const runId = runIdFor(userId, input.requestId)
        const sessionId = input.sessionId || runId
        const session = sessionsRef(db, userId).doc(sessionId)
        const run = db.collection(RUNS).doc(runId)
        const revision = revisionRef(db, userId, sessionId, runId)
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
        const now = Date.now()
        const existing = await db.runTransaction(async transaction => {
            const [runDoc, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
            if (runDoc.exists) {
                const data = runDoc.data()
                if (data.userId !== userId || data.fingerprint !== fingerprint)
                    throw error(409, 'This requestId belongs to a different writing request')
                return data.status !== 'preparing'
            }
            if (Number(userData.gold) <= 0) throw error(402, 'You need Gold to generate text')
            if (input.sessionId && !sessionDoc.exists) throw error(404, 'Writing session not found')
            if (sessionDoc.exists && sessionDoc.data().deleting) throw error(404, 'Writing session not found')
            if ((sessionDoc.data()?.revisionCount || 0) >= MAX_REVISIONS)
                throw error(400, 'This session has 20 revisions. Start a new session.')
            transaction.set(run, { userId, sessionId, runId, fingerprint, status: 'preparing', createdAt: now })
            transaction.set(
                session,
                {
                    title:
                        sessionDoc.data()?.title ||
                        input.instructions.slice(0, 100) ||
                        (input.textbox.appName
                            ? `Writing in ${input.textbox.appName}`
                            : 'Writing from screenshot'
                        ).slice(0, 100),
                    updatedAt: now,
                    createdAt: sessionDoc.data()?.createdAt || now,
                    revisionCount: (sessionDoc.data()?.revisionCount || 0) + 1,
                    status: 'pending',
                    latestRunId: runId,
                },
                { merge: true }
            )
            transaction.set(revision, {
                id: runId,
                instructions: input.instructions,
                textbox: input.textbox,
                requestedProjectId: input.projectId,
                createdAt: now,
                status: 'preparing',
                imageMetadata: {
                    mimeType: input.image.mimeType,
                    width: input.image.width,
                    height: input.image.height,
                    chunks: Math.ceil(input.image.dataBase64.length / CHUNK_CHARACTERS),
                },
            })
            return false
        })
        if (!existing) {
            try {
                // Screenshots live inside the existing owner-only Firestore subtree. There is
                // no public download token, bucket-rule dependency or expiring history link.
                await db.runTransaction(async transaction => {
                    const [runDoc, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
                    if (runDoc.data()?.status !== 'preparing' || !sessionDoc.exists || sessionDoc.data().deleting)
                        return
                    for (
                        let offset = 0, index = 0;
                        offset < input.image.dataBase64.length;
                        offset += CHUNK_CHARACTERS, index++
                    ) {
                        transaction.set(revision.collection('imageChunks').doc(String(index)), {
                            data: input.image.dataBase64.slice(offset, offset + CHUNK_CHARACTERS),
                        })
                    }
                    transaction.update(run, { status: 'pending', updatedAt: Date.now() })
                    transaction.update(revision, { status: 'pending' })
                })
            } catch (failure) {
                await db.runTransaction(async transaction => {
                    const [runDoc, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
                    if (runDoc.data()?.status !== 'preparing' || !sessionDoc.exists || sessionDoc.data().deleting)
                        return
                    transaction.update(run, {
                        status: 'failed',
                        error: 'Could not save the screenshot',
                        updatedAt: Date.now(),
                    })
                    transaction.update(revision, { status: 'failed', error: 'Could not save the screenshot' })
                    transaction.update(session, { status: 'failed' })
                })
                throw failure
            }
        }
        res.status(200).json({ success: true, sessionId, runId })
    } catch (failure) {
        respondError(res, failure)
    }
}

function publicRevision(doc) {
    const data = doc.data()
    return {
        id: doc.id,
        instructions: data.instructions,
        status: data.status,
        createdAt: data.createdAt,
        draftText: data.draftText || null,
        projectId: data.projectId || null,
        projectName: data.projectName || null,
        assistantName: data.assistantName || null,
        reasoning: data.reasoning || null,
        error: data.error || null,
    }
}

async function readImage(ref, metadata) {
    if (!metadata) return null
    if (!Number.isInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > 12)
        throw error(500, 'Invalid saved screenshot')
    const docs = await Promise.all(
        Array.from({ length: metadata.chunks }, (_, n) => ref.collection('imageChunks').doc(String(n)).get())
    )
    if (docs.some(doc => !doc.exists || typeof doc.data().data !== 'string'))
        throw error(500, 'Saved screenshot is incomplete')
    const dataBase64 = docs.map(doc => doc.data().data).join('')
    if (dataBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw error(500, 'Saved screenshot is too large')
    return { mimeType: metadata.mimeType, width: metadata.width, height: metadata.height, dataBase64 }
}

async function handleMenubarWritingSession(req, res) {
    try {
        const { userId } = await authenticate(req, res, 'writing-session')
        const db = admin.firestore()
        const action = req.body?.action || 'list'
        if (action === 'list') {
            let query = sessionsRef(db, userId).orderBy('updatedAt', 'desc').limit(21)
            if (req.body.cursor) {
                const cursor = await sessionsRef(db, userId).doc(id(req.body.cursor, 'cursor')).get()
                if (!cursor.exists) throw error(400, 'Refresh writing history to load more sessions')
                query = query.startAfter(cursor)
            }
            const page = await query.get()
            const docs = page.docs.slice(0, 20)
            res.status(200).json({
                success: true,
                sessions: docs
                    .filter(doc => !doc.data().deleting)
                    .map(doc => ({
                        id: doc.id,
                        title: doc.data().title,
                        updatedAt: doc.data().updatedAt,
                        status: doc.data().status,
                        projectName: doc.data().projectName || null,
                        assistantName: doc.data().assistantName || null,
                    })),
                nextCursor: page.size > 20 ? docs.at(-1).id : null,
            })
            return
        }
        const sessionId = id(req.body?.sessionId, 'sessionId')
        const session = sessionsRef(db, userId).doc(sessionId)
        const sessionDoc = await session.get()
        if (!sessionDoc.exists && action === 'delete') {
            res.status(200).json({ success: true })
            return
        }
        if (!sessionDoc.exists || (sessionDoc.data().deleting && action !== 'delete'))
            throw error(404, 'Writing session not found')
        if (action === 'read') {
            const revisions = await session
                .collection('revisions')
                .orderBy('createdAt', 'desc')
                .limit(MAX_REVISIONS)
                .get()
            res.status(200).json({ success: true, sessionId, revisions: revisions.docs.map(publicRevision) })
        } else if (action === 'revision' || action === 'cancel') {
            const runId = id(req.body?.runId, 'runId')
            const revision = revisionRef(db, userId, sessionId, runId)
            const doc = await revision.get()
            if (!doc.exists) throw error(404, 'Writing revision not found')
            if (action === 'cancel') {
                const run = db.collection(RUNS).doc(runId)
                await db.runTransaction(async transaction => {
                    const [canonical, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
                    if (canonical.data()?.userId !== userId || canonical.data()?.sessionId !== sessionId)
                        throw error(404, 'Writing revision not found')
                    if (['preparing', 'pending', 'processing'].includes(canonical.data().status)) {
                        transaction.update(run, { status: 'cancelled', updatedAt: Date.now() })
                        transaction.update(revision, { status: 'cancelled' })
                        if (sessionDoc.data()?.latestRunId === runId)
                            transaction.update(session, { status: 'cancelled' })
                    }
                })
                res.status(200).json({ success: true })
            } else {
                const revisionData = publicRevision(doc)
                // Polls omit image bytes; the detail view explicitly requests them.
                if (req.body.includeImage === true)
                    revisionData.image = await readImage(revision, doc.data().imageMetadata)
                res.status(200).json({ success: true, revision: revisionData })
            }
        } else if (action === 'delete') {
            await db.runTransaction(async transaction => {
                const doc = await transaction.get(session)
                if (doc.exists) transaction.update(session, { deleting: true })
            })
            const runs = await db
                .collection(RUNS)
                .where('userId', '==', userId)
                .where('sessionId', '==', sessionId)
                .get()
            const ownedRuns = runs.docs.filter(doc => doc.data().sessionId === sessionId)
            // Tombstone before deleting: a queued or in-flight worker cannot recreate the session.
            await Promise.all(ownedRuns.map(doc => doc.ref.set({ status: 'cancelled' }, { merge: true })))
            await db.recursiveDelete(session)
            await Promise.all(ownedRuns.map(doc => doc.ref.delete()))
            res.status(200).json({ success: true })
        } else throw error(400, 'Unknown writing action')
    } catch (failure) {
        respondError(res, failure)
    }
}

async function accessibleProjects(db, userId) {
    const { ProjectService } = require('../shared/ProjectService')
    const service = new ProjectService({ database: db })
    await service.initialize()
    const projects = await service.getUserProjects(userId, { includeArchived: false, includeCommunity: false })
    // Recheck membership: route only into real member projects, never discovery/community entries.
    return projects.filter(project => Array.isArray(project.userIds) && project.userIds.includes(userId))
}

function parseRouting(text, projects) {
    try {
        const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
        const chosen = projects.find(project => project.id === parsed.projectId)
        return {
            project: chosen && typeof parsed.confidence === 'number' && parsed.confidence >= 0.75 ? chosen : null,
            reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : '',
            emails: Array.isArray(parsed.recipientEmails)
                ? parsed.recipientEmails.filter(value => typeof value === 'string').slice(0, 30)
                : [],
        }
    } catch (_) {
        return { project: null, reasoning: '', emails: [] }
    }
}

async function resolveWritingProject(
    db,
    userId,
    userData,
    revision,
    image,
    projects,
    generate = runWritingAssistant,
    assertActive = async () => {}
) {
    if (revision.requestedProjectId) {
        const project = projects.find(project => project.id === revision.requestedProjectId)
        if (!project) throw error(403, 'The selected project is no longer accessible')
        return { project, reasoning: 'You selected this project.' }
    }
    const referenced = findUniqueProjectByTitle(projects, revision.instructions)
    if (referenced) return { project: referenced, reasoning: 'Your instructions name this project.' }
    const fallback = projects.find(project => project.id === userData.defaultProjectId)
    if (!fallback) throw error(400, 'Choose a project or configure a default project in Alldone')
    if (projects.length === 1) return { project: fallback, reasoning: 'This is your accessible project.' }
    if (projects.length <= 100) {
        const actor = await menubar.getMenubarAssistantActor(db, userData)
        const result = await generate({
            userId,
            userData,
            projectId: fallback.id,
            assistantId: actor.assistantId,
            instructions: revision.instructions,
            textbox: revision.textbox,
            image,
            routing: true,
            assertActive,
            candidates: projects.map(project => ({
                id: project.id,
                name: project.name,
                description: String(project.description || '').slice(0, 400),
            })),
        })
        const routing = parseRouting(result.draftText, projects)
        if (routing.emails.length) {
            const matched = await resolveMenubarNoteProject(db, { userId, userData, attendeeEmails: routing.emails })
            const project = projects.find(project => project.id === matched.projectId)
            if (project && matched.source === 'attendeeEmailMatch') return { project, reasoning: matched.reasoning }
        }
        if (routing.project)
            return {
                project: routing.project,
                reasoning: routing.reasoning || 'Matched the screen and writing instructions.',
            }
    }
    return { project: fallback, reasoning: 'No clear project match; using your default project.' }
}

async function processMenubarWritingRun(event) {
    const snapshot = event.data?.after
    if (!snapshot?.exists || snapshot.data().status !== 'pending') return
    const db = admin.firestore()
    const run = snapshot.ref
    const claimed = await db.runTransaction(async transaction => {
        const doc = await transaction.get(run)
        if (doc.data()?.status !== 'pending') return false
        transaction.update(run, { status: 'processing', updatedAt: Date.now() })
        return doc.data()
    })
    if (!claimed) return
    const { userId, sessionId, runId } = claimed
    const session = sessionsRef(db, userId).doc(sessionId)
    const revision = revisionRef(db, userId, sessionId, runId)
    const assertActive = async () => {
        const [runDoc, sessionDoc] = await Promise.all([run.get(), session.get()])
        if (runDoc.data()?.status !== 'processing' || !sessionDoc.exists || sessionDoc.data().deleting)
            throw error(409, 'Writing was cancelled')
    }
    try {
        await assertActive()
        const [revisionDoc, userDoc] = await Promise.all([revision.get(), db.doc(`users/${userId}`).get()])
        if (!revisionDoc.exists || !userDoc.exists) throw error(404, 'Writing session not found')
        const data = revisionDoc.data()
        const userData = userDoc.data()
        if (Number(userData.gold) <= 0) throw error(402, 'You need Gold to generate text')
        const image = await readImage(revision, data.imageMetadata)
        const projects = await accessibleProjects(db, userId)
        const resolution = await resolveWritingProject(
            db,
            userId,
            userData,
            data,
            image,
            projects,
            runWritingAssistant,
            assertActive
        )
        await assertActive()
        const currentProject = await db.doc(`projects/${resolution.project.id}`).get()
        if (!currentProject.exists || !currentProject.data().userIds?.includes(userId)) {
            throw error(403, 'The selected project is no longer accessible')
        }
        // The selected project's configured assistant wins; otherwise use the normal defaults.
        const actor = await menubar.getMenubarAssistantActor(db, {
            ...userData,
            defaultProjectId: resolution.project.id,
        })
        if (!actor.assistantId) throw error(400, 'No assistant is configured for this project')
        const context = {
            projectId: resolution.project.id,
            projectName: resolution.project.name || '',
            assistantId: actor.assistantId,
            assistantName: actor.feedUser.displayName || 'Anna',
            reasoning: resolution.reasoning,
        }
        await revision.update({ status: 'processing', ...context })
        const prior = await session.collection('revisions').orderBy('createdAt', 'desc').limit(MAX_REVISIONS).get()
        const previousDrafts = prior.docs
            .filter(doc => doc.id !== runId && doc.data().status === 'completed')
            .slice(0, 4)
            .reverse()
            .map(doc => ({ instructions: doc.data().instructions, draftText: doc.data().draftText }))
        const freshUser = (await db.doc(`users/${userId}`).get()).data()
        if (Number(freshUser.gold) <= 0) throw error(402, 'You need Gold to generate text')
        const result = await runWritingAssistant({
            userId,
            userData: freshUser,
            projectId: resolution.project.id,
            assistantId: actor.assistantId,
            instructions: data.instructions,
            textbox: data.textbox,
            image,
            previousDrafts,
            assertActive,
        })
        await db.runTransaction(async transaction => {
            const [runDoc, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
            if (runDoc.data()?.status !== 'processing' || !sessionDoc.exists || sessionDoc.data().deleting) return
            transaction.update(revision, { ...context, ...result, status: 'completed', completedAt: Date.now() })
            transaction.update(run, { status: 'completed', updatedAt: Date.now() })
            if (sessionDoc.data().latestRunId === runId)
                transaction.update(session, {
                    ...context,
                    status: 'completed',
                    updatedAt: Date.now(),
                })
        })
    } catch (failure) {
        console.error('Writing generation failed', {
            runId,
            code: failure.code || failure.status || null,
            errorType: failure.name,
        })
        await db.runTransaction(async transaction => {
            const [runDoc, sessionDoc] = await Promise.all([transaction.get(run), transaction.get(session)])
            if (runDoc.data()?.status !== 'processing' || !sessionDoc.exists || sessionDoc.data().deleting) return
            const message = failure.status ? failure.message : 'The assistant could not generate this draft. Try again.'
            transaction.update(run, { status: 'failed', error: message, updatedAt: Date.now() })
            transaction.update(revision, { status: 'failed', error: message })
            if (sessionDoc.data().latestRunId === runId)
                transaction.update(session, { status: 'failed', updatedAt: Date.now() })
        })
    }
}

module.exports = {
    handleMenubarWritingStart,
    handleMenubarWritingSession,
    processMenubarWritingRun,
    __private__: { normalizeInput, validateImage, parseRouting, runIdFor, resolveWritingProject, readImage },
}
