'use strict'

const admin = require('firebase-admin')

const TASK_PRIORITY_LEARNING_DOC = 'taskPriorityLearning'
const TASK_PRIORITY_LEARNING_SCHEMA_VERSION = 1
const MAX_LEARNED_RULES_LENGTH = 2500
const ACTIVE_DECISION_WINDOW_MS = 72 * 60 * 60 * 1000
const WEAK_SIGNAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const WEAK_SIGNAL_RULE_THRESHOLD = 3

const PRIORITY_VALUES = new Set(['must_do', 'should_do', 'could_do', 'do_later', 'none'])
const NON_EMPTY_PRIORITIES = new Set(['must_do', 'should_do', 'could_do', 'do_later'])

function getLearningRef(db, userId) {
    return db.collection('users').doc(userId).collection('private').doc(TASK_PRIORITY_LEARNING_DOC)
}

function getActiveDecisionId(projectId, taskId) {
    return `${projectId || 'unknown'}__${taskId || 'unknown'}`.replace(/[\/#?]/g, '_')
}

function normalizePriority(priority) {
    return PRIORITY_VALUES.has(priority) ? priority : 'none'
}

function trimRuleText(text) {
    return String(text || '').trim().slice(0, MAX_LEARNED_RULES_LENGTH)
}

function normalizeLearningState(data = {}) {
    return {
        enabled: data.enabled !== false,
        learnedRules: typeof data.learnedRules === 'string' ? data.learnedRules : '',
        learnedRulesUpdatedAt: data.learnedRulesUpdatedAt || null,
        schemaVersion: data.schemaVersion || TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }
}

async function getTaskPriorityLearningState({ db = admin.firestore(), userId }) {
    if (!userId) return normalizeLearningState()
    const snapshot = await getLearningRef(db, userId).get()
    return normalizeLearningState(snapshot.exists ? snapshot.data() || {} : {})
}

async function getTaskPriorityLearningContextMessage({ db = admin.firestore(), userId }) {
    const state = await getTaskPriorityLearningState({ db, userId })
    const rules = trimRuleText(state.learnedRules)
    if (!state.enabled || !rules) return ''
    return `User-specific prioritization rules:\n${rules}`
}

function appendTaskPriorityLearningToInstructions(instructions = '', rulesMessage = '') {
    const rules = String(rulesMessage || '').trim()
    if (!rules) return instructions || ''
    return [instructions || '', rules].filter(Boolean).join('\n\n')
}

function buildDecisionSnapshot(task = {}, projectName = '') {
    return {
        dueDate: Number.isFinite(Number(task.dueDate)) ? Number(task.dueDate) : null,
        estimation: task.estimations || null,
        projectName: projectName || task.projectName || '',
        parentGoalId: task.parentGoalId || null,
        hasCalendarData: !!task.calendarData,
        userId: task.userId || '',
    }
}

async function recordAssistantPriorityDecision({
    db = admin.firestore(),
    userId,
    projectId,
    projectName,
    task,
    previousPriority,
    aiPriority,
    aiReason,
    assistantId,
    assistantRunId,
    messageId,
    priorityConfidence,
    priorityReasonCodes,
    commentWriteStatus,
}) {
    if (!userId || !projectId || !task?.id) return null
    const normalizedAiPriority = normalizePriority(aiPriority)
    if (!NON_EMPTY_PRIORITIES.has(normalizedAiPriority)) return null

    const learningRef = getLearningRef(db, userId)
    const decisionRef = learningRef.collection('decisions').doc()
    const activeDecisionRef = learningRef.collection('activeTaskDecisions').doc(getActiveDecisionId(projectId, task.id))
    const now = Date.now()
    const decision = {
        userId,
        projectId,
        taskId: task.id,
        taskName: task.extendedName || task.name || '',
        assistantId: assistantId || '',
        assistantRunId: assistantRunId || null,
        messageId: messageId || null,
        previousPriority: normalizePriority(previousPriority),
        aiPriority: normalizedAiPriority,
        aiReason: typeof aiReason === 'string' ? aiReason.trim().slice(0, 5000) : '',
        priorityConfidence: Number.isFinite(Number(priorityConfidence)) ? Number(priorityConfidence) : null,
        priorityReasonCodes: Array.isArray(priorityReasonCodes)
            ? priorityReasonCodes.filter(code => typeof code === 'string' && code.trim()).slice(0, 12)
            : [],
        taskSnapshot: buildDecisionSnapshot(task, projectName),
        commentWriteStatus: commentWriteStatus || null,
        decidedAt: now,
        status: 'active',
        schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }

    await db.runTransaction(async transaction => {
        transaction.set(learningRef, { enabled: true, schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION }, { merge: true })
        transaction.set(decisionRef, decision)
        transaction.set(activeDecisionRef, {
            ...decision,
            decisionId: decisionRef.id,
        })
    })

    return { decisionId: decisionRef.id, ...decision }
}

function buildManualCorrectionRule(event = {}) {
    const taskName = String(event.taskName || '').trim()
    const namePart = taskName ? ` for tasks like "${taskName.slice(0, 80)}"` : ''
    return `- Prefer ${event.userPriority} instead of ${event.aiPriority}${namePart} when the same context appears again.`
}

function buildCommentRule(event = {}) {
    const comment = String(event.commentText || '').trim().replace(/\s+/g, ' ')
    if (!comment) return ''
    return `- Consider this task-priority feedback in similar situations: "${comment.slice(0, 180)}".`
}

function buildWeakSignalRule(event = {}) {
    if (event.type === 'completed_after_ai_priority') {
        return `- Repeated completions after AI prioritization suggest similar ${event.aiPriority} decisions are useful.`
    }
    if (event.type === 'postponed_after_ai_priority') {
        return `- Repeated postpones after AI prioritization suggest downgrading similar tasks unless there is a clear deadline or commitment.`
    }
    return ''
}

function appendRule(existingRules, nextRule) {
    const rule = String(nextRule || '').trim()
    if (!rule) return trimRuleText(existingRules)
    const existing = String(existingRules || '').trim()
    if (existing.toLowerCase().includes(rule.toLowerCase())) return trimRuleText(existing)
    return trimRuleText([existing, rule].filter(Boolean).join('\n'))
}

async function recordLearningEvent({ db = admin.firestore(), userId, event }) {
    if (!userId || !event) return null
    const learningRef = getLearningRef(db, userId)
    const eventRef = learningRef.collection('events').doc()
    const eventData = {
        ...event,
        userId,
        createdAt: Date.now(),
        schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }
    await eventRef.set(eventData)
    return { eventId: eventRef.id, ...eventData }
}

async function countRecentWeakEvents({ db, userId, type, aiPriority }) {
    const since = Date.now() - WEAK_SIGNAL_WINDOW_MS
    const snapshot = await getLearningRef(db, userId)
        .collection('events')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    return snapshot.docs.filter(doc => {
        const data = doc.data() || {}
        return data.type === type && data.aiPriority === (aiPriority || '') && Number(data.createdAt) >= since
    }).length
}

async function maybeReviseLearnedRules({ db = admin.firestore(), userId, event, force = false }) {
    if (!userId || !event) return null
    const learningRef = getLearningRef(db, userId)
    const state = await getTaskPriorityLearningState({ db, userId })
    if (!state.enabled) return null

    let candidateRule = event.ruleCandidate || ''
    if (!candidateRule && event.type === 'manual_priority_change') candidateRule = buildManualCorrectionRule(event)
    if (!candidateRule && event.type === 'classified_comment_feedback') candidateRule = buildCommentRule(event)

    if (!force && event.signalStrength === 'weak') {
        const count = await countRecentWeakEvents({ db, userId, type: event.type, aiPriority: event.aiPriority })
        if (count < WEAK_SIGNAL_RULE_THRESHOLD) return null
        candidateRule = candidateRule || buildWeakSignalRule(event)
    }

    if (!candidateRule) return null

    const learnedRules = appendRule(state.learnedRules, candidateRule)
    await learningRef.set(
        {
            enabled: true,
            learnedRules,
            learnedRulesUpdatedAt: Date.now(),
            schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
        },
        { merge: true }
    )
    return learnedRules
}

async function loadActiveDecisionForActor({ db, actorId, projectId, taskId }) {
    if (!actorId || !projectId || !taskId) return null
    const activeRef = getLearningRef(db, actorId).collection('activeTaskDecisions').doc(getActiveDecisionId(projectId, taskId))
    const activeDoc = await activeRef.get()
    if (!activeDoc.exists) return null
    const activeDecision = activeDoc.data() || {}
    if (!activeDecision.decidedAt || Date.now() - Number(activeDecision.decidedAt) > ACTIVE_DECISION_WINDOW_MS) return null
    return activeDecision
}

async function captureTaskPriorityTaskUpdateFeedback({ db = admin.firestore(), projectId, taskId, oldTask = {}, newTask = {} }) {
    const actorId = newTask.lastEditorId || ''
    if (!actorId || !projectId || !taskId) return

    const activeDecision = await loadActiveDecisionForActor({ db, actorId, projectId, taskId })
    if (!activeDecision) return
    if (activeDecision.assistantId && activeDecision.assistantId === actorId) return

    const oldPriority = normalizePriority(oldTask.priority)
    const newPriority = normalizePriority(newTask.priority)
    const taskName = newTask.extendedName || newTask.name || activeDecision.taskName || ''

    if (oldPriority !== newPriority) {
        const event = {
            type: 'manual_priority_change',
            signalStrength: 'strong',
            decisionId: activeDecision.decisionId || null,
            projectId,
            taskId,
            taskName,
            aiPriority: activeDecision.aiPriority,
            previousPriority: oldPriority,
            userPriority: newPriority,
            changedAt: Date.now(),
        }
        await recordLearningEvent({ db, userId: actorId, event })
        await maybeReviseLearnedRules({ db, userId: actorId, event, force: true })
        if (activeDecision.decisionId) {
            await getLearningRef(db, actorId)
                .collection('decisions')
                .doc(activeDecision.decisionId)
                .set(
                    {
                        status: newPriority === activeDecision.aiPriority ? 'confirmed' : 'corrected',
                        correctedAt: Date.now(),
                    },
                    { merge: true }
                )
        }
    }

    if (!oldTask.done && newTask.done) {
        const event = {
            type: 'completed_after_ai_priority',
            signalStrength: 'weak',
            decisionId: activeDecision.decisionId || null,
            projectId,
            taskId,
            taskName,
            aiPriority: activeDecision.aiPriority,
        }
        await recordLearningEvent({ db, userId: actorId, event })
        await maybeReviseLearnedRules({ db, userId: actorId, event })
    }

    const oldDueDate = Number(oldTask.dueDate)
    const newDueDate = Number(newTask.dueDate)
    if (Number.isFinite(oldDueDate) && Number.isFinite(newDueDate) && newDueDate > oldDueDate && !newTask.done) {
        const event = {
            type: 'postponed_after_ai_priority',
            signalStrength: 'weak',
            decisionId: activeDecision.decisionId || null,
            projectId,
            taskId,
            taskName,
            aiPriority: activeDecision.aiPriority,
            oldDueDate,
            newDueDate,
        }
        await recordLearningEvent({ db, userId: actorId, event })
        await maybeReviseLearnedRules({ db, userId: actorId, event })
    }
}

function classifyComment(commentText = '') {
    const text = String(commentText || '').trim()
    const lower = text.toLowerCase()
    if (!text) return { classification: 'unrelated' }
    const priorityTerms = ['priority', 'must', 'should', 'could', 'later', 'urgent', 'important', 'deadline', 'not today']
    if (!priorityTerms.some(term => lower.includes(term))) return { classification: 'unrelated' }
    if (lower.includes('not') || lower.includes('instead') || lower.includes('wrong') || lower.includes('lower')) {
        return { classification: 'correction', ruleCandidate: buildCommentRule({ commentText: text }) }
    }
    return { classification: 'context', ruleCandidate: buildCommentRule({ commentText: text }) }
}

async function captureTaskPriorityCommentFeedback({
    db = admin.firestore(),
    projectId,
    taskId,
    commentId,
    commentData = {},
}) {
    if (!projectId || !taskId || !commentId || commentData.fromAssistant) return
    const actorId = commentData.creatorId || ''
    const activeDecision = await loadActiveDecisionForActor({ db, actorId, projectId, taskId })
    if (!activeDecision) return

    const commentText = typeof commentData.commentText === 'string' ? commentData.commentText.trim() : ''
    const classified = classifyComment(commentText)
    const event = {
        type: 'classified_comment_feedback',
        signalStrength: classified.classification === 'correction' ? 'strong' : 'medium',
        classification: classified.classification,
        decisionId: activeDecision.decisionId || null,
        projectId,
        taskId,
        taskName: activeDecision.taskName || '',
        commentId,
        commentText: commentText.slice(0, 1000),
        aiPriority: activeDecision.aiPriority,
        ruleCandidate: classified.ruleCandidate || '',
    }
    await recordLearningEvent({ db, userId: actorId, event })
    if (classified.classification !== 'unrelated') {
        await maybeReviseLearnedRules({
            db,
            userId: actorId,
            event,
            force: classified.classification === 'correction',
        })
    }
}

module.exports = {
    TASK_PRIORITY_LEARNING_DOC,
    TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    MAX_LEARNED_RULES_LENGTH,
    getTaskPriorityLearningContextMessage,
    appendTaskPriorityLearningToInstructions,
    recordAssistantPriorityDecision,
    recordLearningEvent,
    maybeReviseLearnedRules,
    captureTaskPriorityTaskUpdateFeedback,
    captureTaskPriorityCommentFeedback,
    classifyComment,
}
