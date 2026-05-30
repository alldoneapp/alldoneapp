'use strict'

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { getDefaultAssistantData, GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfidence(confidence) {
    const numericConfidence = Number(confidence)
    if (!Number.isFinite(numericConfidence) || numericConfidence < 0) return null
    if (numericConfidence <= 1) return numericConfidence
    if (numericConfidence <= 100) return numericConfidence / 100
    return null
}

function normalizeReasonClause(reasoning, fallback) {
    return (normalizeText(reasoning) || fallback)
        .replace(/\s+/g, ' ')
        .replace(/^because\s+/i, '')
        .replace(/[.!?]+$/g, '')
}

function buildProjectRoutingReasonComment({ projectName = '', reasoning = '', confidence = null, matched = true }) {
    const name = normalizeText(projectName) || 'this project'
    const normalizedConfidence = normalizeConfidence(confidence)
    const confidenceText =
        normalizedConfidence === null ? '' : ` Confidence: ${Math.round(normalizedConfidence * 100)}%.`

    if (!matched) {
        const reason = normalizeReasonClause(reasoning, 'it did not match any of your other projects')
        return `I kept this in ${name} because ${reason}.${confidenceText}`
    }

    const reason = normalizeReasonClause(reasoning, 'it matched the routing criteria')
    return `I chose ${name} because ${reason}.${confidenceText}`
}

async function getDefaultAssistantIdForProject(userData = {}, projectId = '') {
    const db = admin.firestore()
    const normalizedProjectId = normalizeText(projectId)
    const userDefaultAssistantId = normalizeText(userData?.defaultAssistantId)

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? normalizeText(projectDoc.data()?.assistantId) : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            return projectAssistantId
        }
    } catch (error) {
        console.warn('[projectRoutingComment] Could not resolve project assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('[projectRoutingComment] Could not validate user default assistant', {
                projectId: normalizedProjectId,
                error: error.message,
            })
        }
    }

    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) {
            return snapshot.docs[0].id
        }
    } catch (error) {
        console.warn('[projectRoutingComment] Could not find assistant in project', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            return defaultAssistant.uid
        }
    } catch (error) {
        console.warn('[projectRoutingComment] Could not fetch global default assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    return null
}

async function resolveRoutingCommentAssistant(userData = {}) {
    const assistantProjectId = normalizeText(userData?.defaultProjectId)
    if (!assistantProjectId) {
        console.warn('[projectRoutingComment] Skipping routing comment because user has no default project')
        return null
    }

    const assistantId = await getDefaultAssistantIdForProject(userData, assistantProjectId)
    if (!assistantId) {
        console.warn(
            '[projectRoutingComment] Skipping routing comment because no default assistant could be resolved',
            {
                assistantProjectId,
            }
        )
        return null
    }

    return { assistantProjectId, assistantId }
}

async function fetchProjectName(projectId) {
    if (!projectId) return ''

    try {
        const projectDoc = await admin.firestore().doc(`projects/${projectId}`).get()
        return projectDoc.exists ? normalizeText(projectDoc.data()?.name) : ''
    } catch (error) {
        console.warn('[projectRoutingComment] Could not fetch project name', { projectId, error: error.message })
        return ''
    }
}

async function addProjectRoutingReasonComment({
    userData = {},
    projectId,
    taskId,
    task = null,
    projectName = '',
    reasoning = '',
    confidence = null,
    matched = true,
    source = '',
    routingKey = '',
    routingData = {},
    commentId = '',
    sourceDataField = '',
}) {
    if (!projectId || !taskId) return null

    const assistantContext = await resolveRoutingCommentAssistant(userData)
    if (!assistantContext) return null

    const db = admin.firestore()
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${taskId}`)
    const resolvedCommentId = commentId || getId()
    const now = Date.now()
    const resolvedProjectName = projectName || (await fetchProjectName(projectId))
    const commentText = buildProjectRoutingReasonComment({
        projectName: resolvedProjectName,
        reasoning,
        confidence,
        matched,
    })

    let taskData = task
    if (!taskData) {
        const taskDoc = await taskRef.get()
        if (!taskDoc.exists) {
            console.warn('[projectRoutingComment] Skipping routing comment because task was not found', {
                projectId,
                taskId,
            })
            return null
        }
        taskData = taskDoc.data() || {}
    }

    const currentTaskCommentsAmount = Number(taskData?.commentsData?.amount) || 0
    const commentsData = {
        lastCommentOwnerId: assistantContext.assistantId,
        lastComment: commentText.substring(0, 200),
        lastCommentType: STAYWARD_COMMENT,
        amount: currentTaskCommentsAmount + 1,
    }
    const projectRoutingData = {
        source,
        routingKey,
        chosenProjectId: projectId,
        projectName: resolvedProjectName,
        reasoning: normalizeText(reasoning),
        confidence: normalizeConfidence(confidence),
        commentId: resolvedCommentId,
        commentedAt: now,
        ...routingData,
    }
    const taskUpdate = { commentsData }
    if (sourceDataField) {
        taskUpdate[`${sourceDataField}.projectRouting`] = projectRoutingData
    }

    await db.doc(`chatComments/${projectId}/tasks/${taskId}/comments/${resolvedCommentId}`).set({
        creatorId: assistantContext.assistantId,
        commentText,
        commentType: STAYWARD_COMMENT,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        originalContent: commentText,
        fromAssistant: true,
        projectRoutingData,
    })

    await taskRef.update(taskUpdate)

    const chatDoc = await chatRef.get()
    const currentChatCommentsAmount = chatDoc.exists ? Number(chatDoc.data()?.commentsData?.amount) || 0 : 0
    const chatData = {
        commentsData: {
            lastCommentOwnerId: assistantContext.assistantId,
            lastComment: commentText.substring(0, 200),
            lastCommentType: STAYWARD_COMMENT,
            amount: currentChatCommentsAmount + 1,
        },
        lastEditionDate: now,
        lastEditorId: assistantContext.assistantId,
        members: admin.firestore.FieldValue.arrayUnion(assistantContext.assistantId),
    }

    if (chatDoc.exists) {
        await chatRef.update(chatData)
    } else {
        await chatRef.set({
            id: taskId,
            title: taskData?.extendedName || taskData?.name || '',
            type: 'tasks',
            creatorId: taskData?.creatorId || taskData?.userId || '',
            created: taskData?.created || now,
            isPublicFor: taskData?.isPublicFor || [0, taskData?.userId].filter(Boolean),
            usersFollowing: admin.firestore.FieldValue.arrayUnion(assistantContext.assistantId),
            hasStar: taskData?.hasStar || '#ffffff',
            ...chatData,
        })
    }

    return {
        commentId: resolvedCommentId,
        commentText,
        assistantProjectId: assistantContext.assistantProjectId,
        assistantId: assistantContext.assistantId,
        projectRoutingData,
    }
}

module.exports = {
    addProjectRoutingReasonComment,
    buildProjectRoutingReasonComment,
    getDefaultAssistantIdForProject,
}
