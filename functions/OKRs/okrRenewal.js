'use strict'

const admin = require('firebase-admin')

const { getFirstName } = require('../Utils/HelperFunctionsCloud')
const {
    OKRS_COLLECTION,
    OKR_STATUS_ACTIVE,
    OKR_STATUS_CLOSED,
    calculateOkrProgress,
    getNextOkrPeriod,
    mapOKRData,
    resolveOkrDataForProject,
} = require('../shared/OKRHelper')
const {
    addBaseInstructions,
    getAssistantForChat,
    getCommonData,
    interactWithChatStream,
    storeBotAnswerStream,
} = require('../Assistant/assistantHelper')

const MAX_RENEWALS_PER_RUN = 200

function buildNextOKRId(okrId, nextPeriodStart) {
    return `${okrId}_${nextPeriodStart}`
}

function buildRecapChatId(projectId, ownerId, periodStart, periodEnd) {
    return `OKRRecap_${projectId}_${ownerId}_${periodStart}_${periodEnd}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

function buildRecapPrompt(projectName, userName, okrs) {
    const lines = okrs.map(okr => {
        const progress = calculateOkrProgress(okr.currentValue, okr.targetValue)
        const unit = okr.unit ? ` ${okr.unit}` : ''
        return `- ${okr.label}: ${okr.currentValue}${unit} of ${okr.targetValue}${unit} (${progress}%).`
    })

    return [
        `Write a concise OKR period recap for ${userName} in project "${projectName}".`,
        'Use only these measured OKR facts. Do not invent causes or results.',
        'Mention completed targets and missed targets plainly, then suggest one practical next step.',
        '',
        ...lines,
    ].join('\n')
}

async function createRecapTopic({ projectId, ownerId, project, user, okrs }) {
    if (!okrs.length) return null

    const periodStart = Math.min(...okrs.map(okr => okr.periodStart))
    const periodEnd = Math.max(...okrs.map(okr => okr.periodEnd))
    const chatId = buildRecapChatId(projectId, ownerId, periodStart, periodEnd)
    const db = admin.firestore()
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const existingChat = await chatRef.get()
    if (existingChat.exists && Number(existingChat.data()?.commentsData?.amount || 0) > 0) return chatId

    const assistantId = project.assistantId || user.defaultAssistantId || ''
    const assistant = await getAssistantForChat(projectId, assistantId, ownerId, { forceRefresh: true })
    const resolvedAssistantId = assistant.uid || assistantId || ''
    const now = Date.now()
    const isPublicFor = [ownerId]
    const title = `OKR Recap <> ${getFirstName(user.displayName || 'User')} ${new Date(
        periodEnd
    ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    if (!existingChat.exists) {
        await chatRef.set({
            id: chatId,
            title,
            type: 'topics',
            isPublicFor,
            assistantId: resolvedAssistantId,
            creatorId: ownerId,
            created: now,
            lastEditionDate: now,
            lastEditorId: ownerId,
            usersFollowing: [ownerId],
            members: [ownerId],
            hasStar: '#ffffff',
            stickyData: { days: 0, stickyEndDate: 0 },
            commentsData: {
                amount: 0,
                lastComment: '',
                lastCommentOwnerId: '',
                lastCommentType: '',
            },
            isAssistantEnabled: true,
        })
    }

    const { model, temperature, instructions, displayName, allowedTools } = assistant
    const messages = []
    await addBaseInstructions(messages, displayName, user.language || 'English', instructions, allowedTools, null, {
        projectId,
        assistantId: resolvedAssistantId,
        requestUserId: ownerId,
        objectType: 'topics',
        objectId: chatId,
    })
    messages.push([
        'system',
        buildRecapPrompt(project.name || projectId, getFirstName(user.displayName || 'User'), okrs),
    ])

    const toolRuntimeContext = {
        projectId,
        assistantId: resolvedAssistantId,
        requestUserId: ownerId,
        objectType: 'topics',
        objectId: chatId,
    }

    const [stream, commonData] = await Promise.all([
        interactWithChatStream(messages, model, temperature, allowedTools, toolRuntimeContext),
        getCommonData(projectId, 'topics', chatId),
    ])

    await storeBotAnswerStream(
        projectId,
        'topics',
        chatId,
        stream,
        [ownerId],
        isPublicFor,
        null,
        resolvedAssistantId,
        [ownerId],
        displayName,
        ownerId,
        null,
        messages,
        model,
        temperature,
        allowedTools,
        commonData,
        null,
        toolRuntimeContext
    )

    return chatId
}

async function renewOKRDoc(okrDoc, user, projectData = null) {
    const db = admin.firestore()
    const okr = mapOKRData(okrDoc.id, okrDoc.data())
    if (okr.status !== OKR_STATUS_ACTIVE || okr.renewalProcessedAt) return null

    const projectId = okrDoc.ref.parent.parent.id
    const project = projectData || { id: projectId }
    const resolvedOkr = await resolveOkrDataForProject(db, project, { ...okr, projectId })
    const nextPeriod = getNextOkrPeriod(okr.cadence, okr.periodEnd, user)
    const nextOkrId = buildNextOKRId(okr.id, nextPeriod.periodStart)
    const nextOkrRef = db.doc(`okrs/${projectId}/${OKRS_COLLECTION}/${nextOkrId}`)
    const now = Date.now()

    return db.runTransaction(async transaction => {
        const [freshOldDoc, nextDoc] = await Promise.all([transaction.get(okrDoc.ref), transaction.get(nextOkrRef)])
        if (!freshOldDoc.exists) return null
        const freshOld = mapOKRData(freshOldDoc.id, freshOldDoc.data())
        if (freshOld.status !== OKR_STATUS_ACTIVE || freshOld.renewalProcessedAt) return null

        transaction.update(okrDoc.ref, {
            status: OKR_STATUS_CLOSED,
            currentValue: resolvedOkr.currentValue,
            unit: resolvedOkr.unit,
            renewalProcessedAt: now,
            lastEditionDate: now,
            lastEditorId: 'system',
        })

        if (!nextDoc.exists) {
            transaction.set(nextOkrRef, {
                ...freshOldDoc.data(),
                id: nextOkrId,
                projectId,
                type: resolvedOkr.type,
                currentValue: 0,
                unit: resolvedOkr.unit,
                status: OKR_STATUS_ACTIVE,
                previousOkrId: freshOld.id,
                periodStart: nextPeriod.periodStart,
                periodEnd: nextPeriod.periodEnd,
                created: now,
                creatorId: freshOld.ownerId,
                lastEditionDate: now,
                lastEditorId: 'system',
                renewalProcessedAt: null,
            })
        }

        return { ...freshOld, ...resolvedOkr, projectId }
    })
}

async function processExpiredOKRs() {
    const db = admin.firestore()
    const now = Date.now()
    const snapshot = await db
        .collectionGroup(OKRS_COLLECTION)
        .where('objectType', '==', 'okr')
        .where('status', '==', OKR_STATUS_ACTIVE)
        .where('periodEnd', '<=', now)
        .limit(MAX_RENEWALS_PER_RUN)
        .get()

    const userIds = Array.from(new Set(snapshot.docs.map(doc => doc.data().ownerId).filter(Boolean)))
    const projectIds = Array.from(new Set(snapshot.docs.map(doc => doc.ref.parent.parent.id).filter(Boolean)))
    const [userDocs, projectDocs] = await Promise.all([
        userIds.length ? db.getAll(...userIds.map(userId => db.doc(`users/${userId}`))) : Promise.resolve([]),
        projectIds.length
            ? db.getAll(...projectIds.map(projectId => db.doc(`projects/${projectId}`)))
            : Promise.resolve([]),
    ])
    const usersById = new Map(userDocs.filter(doc => doc.exists).map(doc => [doc.id, doc.data()]))
    const projectsById = new Map(
        projectDocs.filter(doc => doc.exists).map(doc => [doc.id, { id: doc.id, ...doc.data() }])
    )
    const renewedOKRs = []

    for (const okrDoc of snapshot.docs) {
        const ownerId = okrDoc.data().ownerId
        const user = usersById.get(ownerId)
        const projectId = okrDoc.ref.parent.parent.id
        const project = projectsById.get(projectId)
        if (!user) continue
        const renewed = await renewOKRDoc(okrDoc, user, project)
        if (renewed) renewedOKRs.push(renewed)
    }

    const groups = new Map()
    renewedOKRs.forEach(okr => {
        const key = `${okr.projectId}:${okr.ownerId}:${okr.periodStart}:${okr.periodEnd}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(okr)
    })

    for (const okrs of groups.values()) {
        const first = okrs[0]
        const user = usersById.get(first.ownerId)
        const project = projectsById.get(first.projectId)
        if (user && project)
            await createRecapTopic({ projectId: first.projectId, ownerId: first.ownerId, project, user, okrs })
    }

    return {
        scanned: snapshot.docs.length,
        renewed: renewedOKRs.length,
        recapGroups: groups.size,
    }
}

module.exports = {
    buildNextOKRId,
    buildRecapChatId,
    processExpiredOKRs,
    renewOKRDoc,
}
