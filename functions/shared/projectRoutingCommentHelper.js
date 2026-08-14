'use strict'

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { getDefaultAssistantData, GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null || confidence === '') return null
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

function buildProjectRoutingReasonComment({
    projectName = '',
    reasoning = '',
    confidence = null,
    matched = true,
    secondPassUsed = null,
    secondPassModel = '',
}) {
    const name = normalizeText(projectName) || 'this project'
    const normalizedConfidence = normalizeConfidence(confidence)
    const confidenceText =
        normalizedConfidence === null ? '' : ` Confidence: ${Math.round(normalizedConfidence * 100)}%.`
    const normalizedSecondPassModel = normalizeText(secondPassModel)
    const secondPassText =
        typeof secondPassUsed !== 'boolean'
            ? ''
            : secondPassUsed
              ? ` Second pass: used${normalizedSecondPassModel ? ` (${normalizedSecondPassModel})` : ''}.`
              : ' Second pass: not used.'

    if (!matched) {
        const reason = normalizeReasonClause(reasoning, 'it did not match any of your other projects')
        return `I kept this in ${name} because ${reason}.${confidenceText}${secondPassText}`
    }

    const reason = normalizeReasonClause(reasoning, 'it matched the routing criteria')
    return `I chose ${name} because ${reason}.${confidenceText}${secondPassText}`
}

function buildGoalRoutingReasonComment({ goalName = '', reasoning = '', confidence = null }) {
    const name = normalizeText(goalName) || 'this goal'
    const normalizedConfidence = normalizeConfidence(confidence)
    const confidenceText =
        normalizedConfidence === null ? '' : ` Confidence: ${Math.round(normalizedConfidence * 100)}%.`
    const reason = normalizeReasonClause(reasoning, 'it directly advances this goal')

    return `I automatically assigned this task to the goal “${name}” because ${reason}.${confidenceText}`
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
    secondPassUsed = null,
    secondPassModel = '',
    source = '',
    routingKey = '',
    routingData = {},
    commentId = '',
    sourceDataField = '',
    destinationType = 'project',
    destinationId = '',
    destinationName = '',
    sourceDataRoutingKey = '',
}) {
    if (!projectId || !taskId) return null

    const assistantContext = await resolveRoutingCommentAssistant(userData)
    if (!assistantContext) return null

    const db = admin.firestore()
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${taskId}`)
    const resolvedCommentId = commentId || getId()
    const now = Date.now()
    const isGoalRouting = destinationType === 'goal'
    const resolvedProjectName = isGoalRouting ? '' : projectName || (await fetchProjectName(projectId))
    const commentText = isGoalRouting
        ? buildGoalRoutingReasonComment({
              goalName: destinationName,
              reasoning,
              confidence,
          })
        : buildProjectRoutingReasonComment({
              projectName: resolvedProjectName,
              reasoning,
              confidence,
              matched,
              secondPassUsed,
              secondPassModel,
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

    const routingDataKey = sourceDataRoutingKey || (isGoalRouting ? 'goalRouting' : 'projectRouting')
    const existingSourceData = sourceDataField ? taskData?.[sourceDataField] : null
    const existingRoutingData = existingSourceData?.[routingDataKey]
    if (existingRoutingData?.commentId === resolvedCommentId) {
        return {
            commentId: resolvedCommentId,
            commentText,
            assistantProjectId: assistantContext.assistantProjectId,
            assistantId: assistantContext.assistantId,
            alreadyExists: true,
            ...(isGoalRouting ? { goalRoutingData: existingRoutingData } : { projectRoutingData: existingRoutingData }),
        }
    }

    const currentTaskCommentsAmount = Number(taskData?.commentsData?.amount) || 0
    const commentsData = {
        lastCommentOwnerId: assistantContext.assistantId,
        lastComment: commentText.substring(0, 200),
        lastCommentType: STAYWARD_COMMENT,
        amount: currentTaskCommentsAmount + 1,
    }
    const routingMetadata = {
        source,
        routingKey,
        reasoning: normalizeText(reasoning),
        confidence: normalizeConfidence(confidence),
        commentId: resolvedCommentId,
        commentedAt: now,
        ...(isGoalRouting
            ? {
                  chosenGoalId: normalizeText(destinationId),
                  goalName: normalizeText(destinationName),
                  projectId,
              }
            : {
                  chosenProjectId: projectId,
                  projectName: resolvedProjectName,
              }),
        ...routingData,
    }
    const taskUpdate = { commentsData }
    if (sourceDataField) {
        taskUpdate[`${sourceDataField}.${routingDataKey}`] = routingMetadata
    }

    await db.doc(`chatComments/${projectId}/tasks/${taskId}/comments/${resolvedCommentId}`).set({
        creatorId: assistantContext.assistantId,
        commentText,
        commentType: STAYWARD_COMMENT,
        lastChangeDate: Timestamp.now(),
        created: now,
        originalContent: commentText,
        fromAssistant: true,
        [isGoalRouting ? 'goalRoutingData' : 'projectRoutingData']: routingMetadata,
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
        members: FieldValue.arrayUnion(assistantContext.assistantId),
    }

    if (chatDoc.exists) {
        await chatRef.update(chatData)
    } else {
        // This helper is often the FIRST writer to create the task's chat object (the task
        // itself doesn't pre-create one). The chat list query in hooks/Chats/useGetChats.js
        // requires `stickyData.days == 0` and the logged user in `usersFollowing`, so we must
        // set both here — otherwise the topic never shows up in the chat list view even though
        // the comment exists inside the task. Mirrors createChat() in chatsComments.js.
        const taskOwnerId = taskData?.userId || taskData?.creatorId || ''
        const followingIds = [assistantContext.assistantId, taskOwnerId].filter(Boolean)
        await chatRef.set({
            id: taskId,
            title: taskData?.extendedName || taskData?.name || '',
            type: 'tasks',
            creatorId: taskData?.creatorId || taskData?.userId || '',
            created: taskData?.created || now,
            isPublicFor: taskData?.isPublicFor || [0, taskData?.userId].filter(Boolean),
            usersFollowing: FieldValue.arrayUnion(...followingIds),
            hasStar: taskData?.hasStar || '#ffffff',
            stickyData: { days: 0, stickyEndDate: 0 },
            ...chatData,
        })
    }

    return {
        commentId: resolvedCommentId,
        commentText,
        assistantProjectId: assistantContext.assistantProjectId,
        assistantId: assistantContext.assistantId,
        ...(isGoalRouting ? { goalRoutingData: routingMetadata } : { projectRoutingData: routingMetadata }),
    }
}

async function addGoalRoutingReasonComment({
    userData = {},
    projectId,
    taskId,
    task = null,
    goalId,
    goalName = '',
    reasoning = '',
    confidence = null,
    source = 'task_goal_routing',
    routingKey = '',
    routingData = {},
    commentId = '',
}) {
    if (!goalId) return null

    return await addProjectRoutingReasonComment({
        userData: {
            ...userData,
            defaultProjectId: userData.defaultProjectId || projectId,
        },
        projectId,
        taskId,
        task,
        reasoning,
        confidence,
        source,
        routingKey,
        routingData,
        commentId,
        sourceDataField: 'goalSuggestion',
        sourceDataRoutingKey: 'goalRouting',
        destinationType: 'goal',
        destinationId: goalId,
        destinationName: goalName,
    })
}

module.exports = {
    addGoalRoutingReasonComment,
    addProjectRoutingReasonComment,
    buildGoalRoutingReasonComment,
    buildProjectRoutingReasonComment,
    getDefaultAssistantIdForProject,
}
