'use strict'

/**
 * Automatic project selection for new tasks (AT-2306).
 *
 * The add-task popup offers "Automatic" instead of a project. A task cannot
 * exist without a project — the project is its Firestore path — so the client
 * creates it in the user's default project and stamps
 * `projectRouting: { status: 'pending' }` on it (see
 * `utils/automaticProjectRouting.js`). This module is the other half: it picks
 * the best-fitting project and moves the task there.
 *
 * Deliberately modelled on `taskGoalRouting.js` — same claim/settle transaction
 * shape, same Gold accounting, same "one shot per task, never re-entered"
 * discipline — because it runs from the same `onCreateTask` fan-out and has the
 * same failure modes. The move itself reuses the assistant's existing
 * `moveTaskToDifferentProject`, so chat, comments and Updates feed travel with
 * the task exactly as they do when the assistant's `update_task` moves one.
 *
 * Two things that are specific to routing a PROJECT rather than a goal:
 *
 * 1. A move is a create-in-target + delete-from-source, so the moved task fires
 *    `onCreateTask` AGAIN in the target project. Re-entry is prevented by the
 *    status itself: the settled `projectRouting` is written to the source task
 *    BEFORE the move, so the copy that lands in the target already reads
 *    `routed` and is skipped. Never settle after the move.
 * 2. Goal routing must not run in the source project for a task that is about
 *    to leave it (its goals are project-local and the move would null the
 *    assignment straight away), which is why `onCreateTask` sequences this
 *    router first and only runs goal routing when the task stayed put.
 */

const admin = require('firebase-admin')
const crypto = require('crypto')

const { getDelegationScopeProjectIdsFromUserData } = require('../Assistant/projectScope')

const PROJECT_ROUTING_STATUS_PENDING = 'pending'
const PROJECT_ROUTING_STATUS_CLASSIFYING = 'classifying'
const PROJECT_ROUTING_STATUS_ROUTED = 'routed'
const PROJECT_ROUTING_STATUS_KEPT = 'kept'
const PROJECT_ROUTING_STATUS_FAILED = 'failed'

// Default only — the routing user can override the model in Settings → Customizations
// (featureModelPreferences.taskProjectRouting; OpenAI models only, this runs on the Responses API).
const TASK_PROJECT_ROUTING_MODEL = 'gpt-5.6-luna'
const TASK_PROJECT_ROUTING_MODEL_KEY = 'MODEL_GPT5_6_LUNA'

// Lower than goal routing's auto-assign bar (0.9) on purpose: the user explicitly
// asked for the project to be chosen for them, and the alternative to acting is
// leaving the task in a default project that was never a considered choice. The
// margin still protects against a coin-flip between two plausible projects.
const MOVE_CONFIDENCE_THRESHOLD = 0.7
const MOVE_MARGIN_THRESHOLD = 0.1
const MINIMUM_GOLD_COST = 1
const MAX_CANDIDATE_PROJECTS = 40

const normalizeRoutingText = value =>
    String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()

const tokenizeRoutingText = value =>
    normalizeRoutingText(value)
        .split(' ')
        .filter(token => token.length >= 2 && !/^\d+$/.test(token))

const countTokens = tokens => {
    const counts = new Map()
    tokens.forEach(token => counts.set(token, (counts.get(token) || 0) + 1))
    return counts
}

const buildProjectRelevanceScore = (project, taskTokenCounts, documentFrequency, projectCount) => {
    const nameTokenCounts = countTokens(tokenizeRoutingText(project.name))
    const descriptionTokenCounts = countTokens(tokenizeRoutingText(project.description))
    let score = 0

    taskTokenCounts.forEach((taskFrequency, token) => {
        const projectFrequency = (nameTokenCounts.get(token) || 0) * 3 + (descriptionTokenCounts.get(token) || 0)
        if (!projectFrequency) return

        const inverseDocumentFrequency = Math.log((projectCount + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1
        score += taskFrequency * projectFrequency * inverseDocumentFrequency
    })

    return score
}

/**
 * Trims the candidate list for accounts with many projects (the reporting
 * account has 78). The host project is always kept — "stay where you are" must
 * remain a choice the classifier can make.
 */
const selectCandidateProjects = (task, projects, hostProjectId, limit = MAX_CANDIDATE_PROJECTS) => {
    if (projects.length <= limit) return projects

    const taskText = `${task.extendedName || task.name || ''} ${task.description || ''}`
    const taskTokenCounts = countTokens(tokenizeRoutingText(taskText))
    const documentFrequency = new Map()

    projects.forEach(project => {
        const tokens = new Set([...tokenizeRoutingText(project.name), ...tokenizeRoutingText(project.description)])
        tokens.forEach(token => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1))
    })

    const ranked = projects
        .map(project => ({
            project,
            relevance: buildProjectRelevanceScore(project, taskTokenCounts, documentFrequency, projects.length),
        }))
        .sort((a, b) => b.relevance - a.relevance || String(a.project.id).localeCompare(String(b.project.id)))
        .slice(0, limit)
        .map(candidate => candidate.project)

    if (hostProjectId && !ranked.some(project => project.id === hostProjectId)) {
        const hostProject = projects.find(project => project.id === hostProjectId)
        if (hostProject) ranked[ranked.length - 1] = hostProject
    }
    return ranked
}

const normalizeConfidence = value => {
    const confidence = Number(value)
    return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
}

const normalizeClassificationResult = (result, candidateProjectIds) => {
    const allowedProjectIds = new Set(candidateProjectIds)
    const projectId = allowedProjectIds.has(result?.projectId) ? result.projectId : null
    const alternativeProjectId = allowedProjectIds.has(result?.alternativeProjectId)
        ? result.alternativeProjectId
        : null

    return {
        projectId,
        confidence: projectId ? normalizeConfidence(result?.confidence) : 0,
        alternativeProjectId: alternativeProjectId && alternativeProjectId !== projectId ? alternativeProjectId : null,
        alternativeConfidence:
            alternativeProjectId && alternativeProjectId !== projectId
                ? normalizeConfidence(result?.alternativeConfidence)
                : 0,
        reason: typeof result?.reason === 'string' ? result.reason.trim().slice(0, 300) : '',
    }
}

/**
 * 'move' | 'keep'. Anything uncertain keeps the task where it is: the host
 * project is a real, working answer, so a low-confidence move is strictly worse
 * than doing nothing.
 */
const chooseRoutingAction = (classification, hostProjectId) => {
    if (!classification.projectId || classification.projectId === hostProjectId) return 'keep'
    if (classification.confidence < MOVE_CONFIDENCE_THRESHOLD) return 'keep'
    if (classification.confidence - classification.alternativeConfidence < MOVE_MARGIN_THRESHOLD) return 'keep'
    return 'move'
}

const buildClassifierInput = (task, projects) => ({
    task: {
        title: String(task.extendedName || task.name || '').slice(0, 500),
        description: String(task.description || '').slice(0, 1500),
    },
    projects: projects.map(project => ({
        projectId: project.id,
        name: String(project.name || '').slice(0, 200),
        description: String(project.description || '').slice(0, 1000),
    })),
})

async function classifyTaskAgainstProjects({ task, projects, userId, model = TASK_PROJECT_ROUTING_MODEL }) {
    const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')
    const { OPEN_AI_KEY } = getCachedEnvFunctions()
    if (!OPEN_AI_KEY) throw new Error('OPEN_AI_KEY is not configured')

    const openai = getOpenAIClient(OPEN_AI_KEY)
    const response = await openai.responses.create({
        model,
        instructions:
            'Choose the single project this task belongs in, based on what the project is about. Return no project when nothing fits clearly. Never invent IDs. Keep the reason short, user-facing, and in the same language as the task.',
        input: JSON.stringify(buildClassifierInput(task, projects)),
        reasoning: { effort: 'low' },
        text: {
            verbosity: 'low',
            format: {
                type: 'json_schema',
                name: 'task_project_routing',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        projectId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                        alternativeProjectId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        alternativeConfidence: { type: 'number', minimum: 0, maximum: 1 },
                        reason: { type: 'string' },
                    },
                    required: ['projectId', 'confidence', 'alternativeProjectId', 'alternativeConfidence', 'reason'],
                },
            },
        },
        max_output_tokens: 300,
        store: false,
        safety_identifier: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32),
    })

    return {
        result: JSON.parse(response.output_text),
        totalTokens: Number(response.usage?.total_tokens) || 0,
    }
}

const isPendingProjectRouting = task => task?.projectRouting?.status === PROJECT_ROUTING_STATUS_PENDING

async function loadCandidateProjects(db, userData, task, hostProjectId) {
    const projectIds = getDelegationScopeProjectIdsFromUserData(userData)
    if (!projectIds.includes(hostProjectId)) projectIds.push(hostProjectId)

    const snapshots = await Promise.all(projectIds.map(projectId => db.doc(`projects/${projectId}`).get()))
    const projects = snapshots
        .filter(snapshot => snapshot.exists)
        .map(snapshot => ({
            id: snapshot.id,
            name: snapshot.data()?.name || '',
            description: snapshot.data()?.description || '',
            // A guide/template copy is not a place the user files their own work.
            isGuide: !!snapshot.data()?.parentTemplateId,
        }))
        .filter(project => !project.isGuide || project.id === hostProjectId)

    return selectCandidateProjects(task, projects, hostProjectId)
}

const buildSettledRouting = ({ previous, status, classification = null, extra = {} }) => ({
    ...previous,
    status,
    resolvedAt: Date.now(),
    ...(classification
        ? {
              chosenProjectId: classification.projectId || null,
              confidence: classification.confidence,
              reason: classification.reason,
          }
        : {}),
    ...extra,
})

/**
 * @returns {Promise<{action: 'skipped'|'kept'|'moved'|'failed'|'insufficient_gold'|'no_candidates', targetProjectId?: string}>}
 */
async function routeNewTaskToProject({
    task,
    projectId,
    db = admin.firestore(),
    classify = classifyTaskAgainstProjects,
    move = null,
    now = Date.now(),
}) {
    if (!task?.id || !isPendingProjectRouting(task)) return { action: 'skipped' }
    if (task.parentId || task.isSubtask || task.done || task.inDone) return { action: 'skipped' }
    if (!String(task.extendedName || task.name || task.description || '').trim()) return { action: 'skipped' }

    const userId = task.creatorId || task.userId
    if (!userId) return { action: 'skipped' }

    const taskRef = db.doc(`items/${projectId}/tasks/${task.id}`)
    const userSnapshot = await db.doc(`users/${userId}`).get()
    if (!userSnapshot.exists) return { action: 'skipped' }
    const userData = userSnapshot.data() || {}

    const settle = async (status, payload) => {
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(taskRef)
            if (!snapshot.exists) return
            const currentRouting = snapshot.data()?.projectRouting
            // Only ever settle our own claim: a retry or a redelivery that lost
            // the race must not overwrite the decision that already landed.
            if (currentRouting?.claimId && payload.claimId && currentRouting.claimId !== payload.claimId) return
            transaction.update(taskRef, { projectRouting: { ...payload, status } })
        })
    }

    if ((Number(userData.gold) || 0) < MINIMUM_GOLD_COST) {
        await settle(PROJECT_ROUTING_STATUS_FAILED, {
            ...task.projectRouting,
            reason: 'insufficient_gold',
            resolvedAt: now,
        })
        return { action: 'insufficient_gold' }
    }

    const projects = await loadCandidateProjects(db, userData, task, projectId)
    if (projects.length < 2) {
        await settle(PROJECT_ROUTING_STATUS_KEPT, {
            ...task.projectRouting,
            reason: 'no_candidate_projects',
            resolvedAt: now,
        })
        return { action: 'no_candidates' }
    }

    const claimId = db.collection('_taskProjectRoutingClaims').doc().id
    const claimed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists || !isPendingProjectRouting({ projectRouting: snapshot.data()?.projectRouting })) {
            return false
        }
        transaction.update(taskRef, {
            projectRouting: {
                ...snapshot.data().projectRouting,
                status: PROJECT_ROUTING_STATUS_CLASSIFYING,
                claimId,
                startedAt: now,
            },
        })
        return true
    })
    if (!claimed) return { action: 'skipped' }

    const baseRouting = { ...task.projectRouting, claimId, startedAt: now }
    const { resolveFeatureModelKey } = require('../Assistant/featureModelPreferences')
    const { getModel } = require('../Assistant/assistantHelper')
    const routingModelKey = resolveFeatureModelKey('taskProjectRouting', userData)
    const routingModel = getModel(routingModelKey)

    let classification = null
    let totalTokens = 0
    try {
        const classified = await classify({ task, projects, userId, model: routingModel })
        classification = normalizeClassificationResult(
            classified.result,
            projects.map(project => project.id)
        )
        totalTokens = classified.totalTokens
    } catch (error) {
        console.error('[taskProjectRouting] Failed to classify task', { projectId, taskId: task.id, error })
        await settle(
            PROJECT_ROUTING_STATUS_FAILED,
            buildSettledRouting({
                previous: baseRouting,
                status: PROJECT_ROUTING_STATUS_FAILED,
                extra: { reason: 'classification_failed' },
            })
        )
        return { action: 'failed' }
    }

    const action = chooseRoutingAction(classification, projectId)
    const targetProject = projects.find(project => project.id === classification.projectId) || null

    // Settle BEFORE the move: the moved document is a fresh create in the target
    // project and would otherwise come back through onCreateTask still pending.
    await settle(
        action === 'move' ? PROJECT_ROUTING_STATUS_ROUTED : PROJECT_ROUTING_STATUS_KEPT,
        buildSettledRouting({
            previous: baseRouting,
            status: action === 'move' ? PROJECT_ROUTING_STATUS_ROUTED : PROJECT_ROUTING_STATUS_KEPT,
            classification,
            extra: { model: routingModel, movedFromProjectId: action === 'move' ? projectId : null },
        })
    )

    let movedProjectId = projectId
    if (action === 'move' && targetProject) {
        try {
            const moveTask = move || require('../Assistant/assistantHelper').moveTaskToDifferentProject
            const moveResult = await moveTask({
                database: db,
                sourceProjectId: projectId,
                targetProjectId: targetProject.id,
                taskId: task.id,
                editorId: userId,
                editorName: userData.displayName || '',
            })
            if (moveResult?.moved) movedProjectId = targetProject.id
        } catch (error) {
            // The task keeps working where it is; only the re-homing failed.
            console.error('[taskProjectRouting] Failed to move task to routed project', {
                projectId,
                targetProjectId: targetProject.id,
                taskId: task.id,
                error,
            })
        }
    }

    // Charged after the move so the Gold entry (and the "Open task" link in the
    // Gold history) names the project the task actually ended up in.
    try {
        const { calculateGoldCostFromTokens } = require('../Assistant/assistantHelper')
        const { deductGold } = require('../Gold/goldHelper')
        const goldSpent = Math.max(MINIMUM_GOLD_COST, calculateGoldCostFromTokens(totalTokens, routingModelKey))
        await deductGold(userId, goldSpent, {
            source: 'task_project_routing',
            projectId: movedProjectId,
            objectId: task.id,
            objectType: 'tasks',
            channel: 'tasks',
            model: routingModelKey || '',
        })
    } catch (error) {
        console.error('[taskProjectRouting] Could not charge routing gold', { taskId: task.id, error })
    }

    if (movedProjectId !== projectId) {
        try {
            const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')
            await addProjectRoutingReasonComment({
                userData,
                projectId: movedProjectId,
                taskId: task.id,
                projectName: targetProject.name,
                reasoning: classification.reason,
                confidence: classification.confidence,
                source: 'task_project_routing',
                routingKey: claimId,
                routingData: { automatic: true, model: routingModel, movedFromProjectId: projectId },
                commentId: `project-routing-${claimId}`,
            })
        } catch (error) {
            console.error('[taskProjectRouting] Could not write routing comment', { taskId: task.id, error })
        }
        return { action: 'moved', targetProjectId: movedProjectId }
    }

    return { action: 'kept', targetProjectId: projectId }
}

module.exports = {
    MOVE_CONFIDENCE_THRESHOLD,
    MOVE_MARGIN_THRESHOLD,
    PROJECT_ROUTING_STATUS_KEPT,
    PROJECT_ROUTING_STATUS_PENDING,
    PROJECT_ROUTING_STATUS_ROUTED,
    TASK_PROJECT_ROUTING_MODEL,
    TASK_PROJECT_ROUTING_MODEL_KEY,
    chooseRoutingAction,
    classifyTaskAgainstProjects,
    isPendingProjectRouting,
    normalizeClassificationResult,
    routeNewTaskToProject,
    selectCandidateProjects,
}
