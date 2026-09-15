'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')

const { ALL_USERS, DYNAMIC_PERCENT, getTaskNameWithoutMeta } = require('../Utils/HelperFunctionsCloud')
const { isGoalCompleted } = require('../Goals/linearGoalMilestones')
const { goalIsVisibleInOpenMilestone } = require('../shared/goalMilestonesHelper')
const { PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const {
    appendCalendarGoalLearnedRulesToPrompt,
    findLearnedCalendarGoalSeriesRoute,
    loadCalendarProjectRoutingConfig,
} = require('../GoogleCalendar/calendarProjectRoutingConfig')

const TASK_GOAL_ROUTING_OFF = 'off'
const TASK_GOAL_ROUTING_SUGGESTIONS = 'suggestions'
const TASK_GOAL_ROUTING_AUTOMATIC = 'automatic'
// Default only — the routing user can override the model in Settings → Customizations
// (featureModelPreferences.taskGoalRouting; OpenAI models only, this runs on the Responses API).
const TASK_GOAL_ROUTING_MODEL = 'gpt-5.6-luna'
const TASK_GOAL_ROUTING_MODEL_KEY = 'MODEL_GPT5_6_LUNA'
const SUGGESTION_CONFIDENCE_THRESHOLD = 0.65
const AUTO_ASSIGN_CONFIDENCE_THRESHOLD = 0.9
const AUTO_ASSIGN_MARGIN_THRESHOLD = 0.15
const MINIMUM_GOLD_COST = 1
const MAX_CANDIDATE_GOALS = 30

const VALID_MODES = new Set([TASK_GOAL_ROUTING_OFF, TASK_GOAL_ROUTING_SUGGESTIONS, TASK_GOAL_ROUTING_AUTOMATIC])

const normalizeTaskGoalRoutingMode = mode => (VALID_MODES.has(mode) ? mode : TASK_GOAL_ROUTING_AUTOMATIC)

const isVisibleToUser = (goal, userId) => {
    const isPublicFor = Array.isArray(goal?.isPublicFor) ? goal.isPublicFor : [0]
    return isPublicFor.includes(0) || isPublicFor.includes(userId)
}

const isGoalEligibleForTaskRouting = (goal, currentMilestone) => {
    if (!isGoalCompleted(goal)) return true

    return (
        goal.progress === DYNAMIC_PERCENT && !!currentMilestone && goalIsVisibleInOpenMilestone(goal, currentMilestone)
    )
}

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

const buildGoalRelevanceScore = (goal, taskTokenCounts, documentFrequency, goalCount, normalizedTaskTitle) => {
    const goalTitle = normalizeRoutingText(goal.extendedName || goal.name)
    const titleTokenCounts = countTokens(tokenizeRoutingText(goalTitle))
    const descriptionTokenCounts = countTokens(tokenizeRoutingText(goal.description))
    let score = 0

    taskTokenCounts.forEach((taskFrequency, token) => {
        const goalFrequency = (titleTokenCounts.get(token) || 0) * 3 + (descriptionTokenCounts.get(token) || 0)
        if (!goalFrequency) return

        const inverseDocumentFrequency = Math.log((goalCount + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1
        score += taskFrequency * goalFrequency * inverseDocumentFrequency
    })

    if (normalizedTaskTitle.length >= 4 && goalTitle.includes(normalizedTaskTitle)) score += 10
    if (goalTitle.length >= 4 && normalizedTaskTitle.includes(goalTitle)) score += 8
    return score
}

const selectCandidateGoals = (task, goals, currentMilestone, limit = MAX_CANDIDATE_GOALS) => {
    if (goals.length <= limit) return goals

    const taskTitle = task.extendedName || task.name || ''
    const normalizedTaskTitle = normalizeRoutingText(taskTitle)
    const taskTokenCounts = countTokens([
        ...tokenizeRoutingText(taskTitle),
        ...tokenizeRoutingText(taskTitle),
        ...tokenizeRoutingText(task.description),
    ])
    const documentFrequency = new Map()

    goals.forEach(goal => {
        const tokens = new Set([
            ...tokenizeRoutingText(goal.extendedName || goal.name),
            ...tokenizeRoutingText(goal.description),
        ])
        tokens.forEach(token => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1))
    })

    return goals
        .map(goal => ({
            goal,
            relevance: buildGoalRelevanceScore(
                goal,
                taskTokenCounts,
                documentFrequency,
                goals.length,
                normalizedTaskTitle
            ),
            isCurrent: goalIsVisibleInOpenMilestone(goal, currentMilestone),
            recency: Number(goal.lastEditionDate || goal.created) || 0,
        }))
        .sort(
            (a, b) =>
                b.relevance - a.relevance ||
                Number(b.isCurrent) - Number(a.isCurrent) ||
                b.recency - a.recency ||
                String(a.goal.id).localeCompare(String(b.goal.id))
        )
        .slice(0, limit)
        .map(candidate => candidate.goal)
}

const normalizeConfidence = value => {
    const confidence = Number(value)
    return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
}

const normalizeClassificationResult = (result, candidateGoalIds) => {
    const allowedGoalIds = new Set(candidateGoalIds)
    const goalId = allowedGoalIds.has(result?.goalId) ? result.goalId : null
    const alternativeGoalId = allowedGoalIds.has(result?.alternativeGoalId) ? result.alternativeGoalId : null

    return {
        goalId,
        confidence: goalId ? normalizeConfidence(result?.confidence) : 0,
        alternativeGoalId: alternativeGoalId && alternativeGoalId !== goalId ? alternativeGoalId : null,
        alternativeConfidence:
            alternativeGoalId && alternativeGoalId !== goalId ? normalizeConfidence(result?.alternativeConfidence) : 0,
        reason: typeof result?.reason === 'string' ? result.reason.trim().slice(0, 300) : '',
    }
}

const chooseRoutingAction = (mode, classification) => {
    if (!classification.goalId || classification.confidence < SUGGESTION_CONFIDENCE_THRESHOLD) return 'none'

    const confidenceMargin = classification.confidence - classification.alternativeConfidence
    if (
        mode === TASK_GOAL_ROUTING_AUTOMATIC &&
        classification.confidence >= AUTO_ASSIGN_CONFIDENCE_THRESHOLD &&
        confidenceMargin >= AUTO_ASSIGN_MARGIN_THRESHOLD
    ) {
        return 'auto_assign'
    }
    return 'suggest'
}

const buildClassifierInput = (task, goals) => ({
    task: {
        title: String(task.extendedName || task.name || '').slice(0, 500),
        description: String(task.description || '').slice(0, 1500),
    },
    calendarEvent: task.calendarData
        ? {
              provider: String(task.calendarData.provider || 'google').slice(0, 50),
              recurringEventId: String(task.calendarData.recurringEventId || '').slice(0, 500),
              start: task.calendarData.start || null,
              end: task.calendarData.end || null,
          }
        : null,
    goals: goals.map(goal => ({
        goalId: goal.id,
        title: String(goal.extendedName || goal.name || '').slice(0, 500),
        description: String(goal.description || '').slice(0, 1000),
    })),
})

async function classifyTaskAgainstGoals({ task, goals, userId, model = TASK_GOAL_ROUTING_MODEL, learnedRules = '' }) {
    const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')
    const { OPEN_AI_KEY } = getCachedEnvFunctions()
    if (!OPEN_AI_KEY) throw new Error('OPEN_AI_KEY is not configured')

    const openai = getOpenAIClient(OPEN_AI_KEY)
    const response = await openai.responses.create({
        model,
        instructions: appendCalendarGoalLearnedRulesToPrompt(
            'Choose the single active goal that this task most directly advances. Return no goal when the match is weak or merely topical. Never invent IDs. Keep the reason short, user-facing, and in the same language as the task.',
            learnedRules
        ),
        input: JSON.stringify(buildClassifierInput(task, goals)),
        reasoning: { effort: 'low' },
        text: {
            verbosity: 'low',
            format: {
                type: 'json_schema',
                name: 'task_goal_routing',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        goalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                        alternativeGoalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        alternativeConfidence: { type: 'number', minimum: 0, maximum: 1 },
                        reason: { type: 'string' },
                    },
                    required: ['goalId', 'confidence', 'alternativeGoalId', 'alternativeConfidence', 'reason'],
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

const getRoutingUserId = (task, project) => {
    const projectUserIds = Array.isArray(project?.userIds) ? project.userIds : []
    return [task.creatorId, task.lastEditorId].find(userId => userId && projectUserIds.includes(userId)) || null
}

const buildCurrentMilestoneQuery = (db, projectId, ownerId) =>
    db
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('done', '==', false)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .limit(1)

const getFirstMilestone = snapshot => {
    const doc = snapshot?.docs?.[0]
    return doc ? { id: doc.id, ...doc.data() } : null
}

async function loadCandidateGoals(
    db,
    projectId,
    project,
    userId,
    task,
    { preferredGoalIds = [], learnedRules = '' } = {}
) {
    const ownerId = project.parentTemplateId ? userId : ALL_USERS
    const [goalsSnapshot, milestoneSnapshot] = await Promise.all([
        db.collection(`goals/${projectId}/items`).where('ownerId', '==', ownerId).get(),
        buildCurrentMilestoneQuery(db, projectId, ownerId).get(),
    ])
    const currentMilestone = getFirstMilestone(milestoneSnapshot)
    const eligibleGoals = goalsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(goal => isGoalEligibleForTaskRouting(goal, currentMilestone) && isVisibleToUser(goal, userId))

    const candidates = selectCandidateGoals(task, eligibleGoals, currentMilestone)
    const preferredGoalIdSet = new Set((Array.isArray(preferredGoalIds) ? preferredGoalIds : []).filter(Boolean))
    const normalizedLearnedRules = typeof learnedRules === 'string' ? learnedRules : ''
    const preferredGoals = eligibleGoals.filter(
        goal => preferredGoalIdSet.has(goal.id) || (normalizedLearnedRules && normalizedLearnedRules.includes(goal.id))
    )
    if (preferredGoals.length === 0) return candidates

    return [
        ...preferredGoals,
        ...candidates.filter(candidate => !preferredGoals.some(preferred => preferred.id === candidate.id)),
    ].slice(0, MAX_CANDIDATE_GOALS)
}

const createSuggestion = ({
    classification,
    action,
    claimId,
    projectId,
    now,
    goldSpent,
    model,
    source = 'task_goal_router',
}) => ({
    goalId: classification.goalId,
    status: action === 'auto_assign' ? 'auto_assigned' : action === 'suggest' ? 'pending' : 'none',
    confidence: classification.confidence,
    alternativeGoalId: classification.alternativeGoalId,
    alternativeConfidence: classification.alternativeConfidence,
    reason: classification.reason,
    projectId,
    model: model || TASK_GOAL_ROUTING_MODEL,
    source,
    claimId,
    goldSpent,
    createdAt: now,
})

async function loadCalendarGoalLearning({ task, projectId, userId, loadConfig }) {
    const calendarData = task?.calendarData
    if (!calendarData || typeof calendarData !== 'object') return { learnedGoalRules: '', exactSeriesRoute: null }

    const syncProjectId = String(
        calendarData.originalProjectId || calendarData.projectRouting?.syncProjectId || projectId
    ).trim()
    if (!syncProjectId) return { learnedGoalRules: '', exactSeriesRoute: null }

    const configContext = await loadConfig(userId, syncProjectId, calendarData.email || '')
    if (!configContext?.exists || !configContext.config?.enabled) {
        return { learnedGoalRules: '', exactSeriesRoute: null }
    }

    return {
        learnedGoalRules: configContext.config.learnedGoalRules || '',
        exactSeriesRoute: findLearnedCalendarGoalSeriesRoute(configContext.config, calendarData, projectId),
    }
}

const isStaleUnresolvedGoalSuggestion = (task, projectId) => {
    const suggestion = task?.goalSuggestion
    return (
        (suggestion?.status === 'pending' || suggestion?.status === 'classifying') && suggestion.projectId !== projectId
    )
}

async function resetStaleGoalSuggestion(db, projectId, task) {
    if (!isStaleUnresolvedGoalSuggestion(task, projectId)) {
        return { task, canRoute: true }
    }

    const taskRef = db.doc(`items/${projectId}/tasks/${task.id}`)
    const resetResult = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return 'missing'

        const currentTask = snapshot.data()
        if (isStaleUnresolvedGoalSuggestion(currentTask, projectId)) {
            transaction.update(taskRef, { goalSuggestion: null })
            return 'reset'
        }
        return currentTask.goalSuggestion ? 'already_routed' : 'already_reset'
    })

    return {
        task: resetResult === 'reset' || resetResult === 'already_reset' ? { ...task, goalSuggestion: null } : task,
        canRoute: resetResult === 'reset' || resetResult === 'already_reset',
    }
}

async function writeAutomaticGoalRoutingArtifacts({
    db,
    projectId,
    project,
    taskId,
    userId,
    userData,
    goal,
    suggestion,
}) {
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const currentTaskSnapshot = await taskRef.get()
    const currentTask = currentTaskSnapshot.data()
    if (
        !currentTaskSnapshot.exists ||
        currentTask.parentGoalId !== goal.id ||
        currentTask.goalSuggestion?.status !== 'auto_assigned' ||
        currentTask.goalSuggestion?.claimId !== suggestion.claimId
    ) {
        return
    }

    let commentResult = null
    try {
        const { addGoalRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')
        commentResult = await addGoalRoutingReasonComment({
            userData,
            projectId,
            taskId,
            goalId: goal.id,
            goalName: getTaskNameWithoutMeta(goal.extendedName || goal.name || ''),
            reasoning: suggestion.reason,
            confidence: suggestion.confidence,
            source: suggestion.source === 'calendar_goal_learning' ? 'calendar_goal_learning' : 'task_goal_routing',
            routingKey: suggestion.claimId,
            routingData: {
                automatic: true,
                model: suggestion.model,
            },
            commentId: `goal-routing-${suggestion.claimId}`,
        })
    } catch (error) {
        console.error('[taskGoalRouting] Could not write automatic routing comment', {
            projectId,
            taskId,
            error: error.message,
        })
    }

    try {
        const latestTaskSnapshot = await taskRef.get()
        const latestTask = latestTaskSnapshot.data()
        if (
            !latestTaskSnapshot.exists ||
            latestTask.parentGoalId !== goal.id ||
            latestTask.goalSuggestion?.claimId !== suggestion.claimId ||
            latestTask.goalSuggestion?.feedCreatedAt
        ) {
            return
        }

        const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
        const { createTaskParentGoalChangedFeed } = require('../Feeds/tasksFeeds')
        const { generateTaskObjectModel } = require('../Feeds/tasksFeedsHelper')
        const { loadFeedsGlobalState } = require('../GlobalState/globalState')
        const feedCreatorId = commentResult?.assistantId || userId
        const feedUser = {
            uid: feedCreatorId,
            displayName: commentResult?.assistantId ? '' : userData.displayName || '',
            photoURL: commentResult?.assistantId ? '' : userData.photoURL || '',
        }

        loadFeedsGlobalState(admin, admin, feedUser, { ...project, id: projectId }, [], null)
        const batch = new BatchWrapper(db)
        batch.setProjectContext(projectId)
        batch.feedObjects = {
            [taskId]: generateTaskObjectModel(Date.now(), latestTask, taskId),
        }
        await createTaskParentGoalChangedFeed(projectId, goal.id, null, taskId, true, batch, feedUser, true, {
            feedId: `goal-routing-${suggestion.claimId}`,
        })
        await batch.commit()
        await taskRef.update({
            'goalSuggestion.feedCreatedAt': Date.now(),
            'goalSuggestion.feedCreatorId': feedCreatorId,
        })
    } catch (error) {
        console.error('[taskGoalRouting] Could not write automatic goal feed', {
            projectId,
            taskId,
            error: error.message,
        })
    }
}

async function routeNewTaskToGoal({
    task,
    projectId,
    db = admin.firestore(),
    classify = classifyTaskAgainstGoals,
    loadCalendarRoutingConfig = loadCalendarProjectRoutingConfig,
    now = Date.now(),
}) {
    const resetResult = task?.id ? await resetStaleGoalSuggestion(db, projectId, task) : { task, canRoute: true }
    task = resetResult.task

    if (!resetResult.canRoute) return { action: 'skipped' }
    if (
        !task?.id ||
        task.parentId ||
        task.isSubtask ||
        task.parentGoalId ||
        task.done ||
        task.inDone ||
        task.goalSuggestion
    ) {
        return { action: 'skipped' }
    }
    if (!String(task.extendedName || task.name || task.description || '').trim()) return { action: 'skipped' }

    const projectRef = db.doc(`projects/${projectId}`)
    const projectSnapshot = await projectRef.get()
    if (!projectSnapshot.exists) return { action: 'skipped' }

    const project = projectSnapshot.data()
    const mode = normalizeTaskGoalRoutingMode(project.taskGoalRoutingMode)
    if (mode === TASK_GOAL_ROUTING_OFF) return { action: 'skipped' }

    const userId = getRoutingUserId(task, project)
    if (!userId) return { action: 'skipped' }

    const userSnapshot = await db.doc(`users/${userId}`).get()
    if (!userSnapshot.exists) return { action: 'skipped' }

    let calendarGoalLearning = { learnedGoalRules: '', exactSeriesRoute: null }
    if (userSnapshot.data()?.premium?.status === PLAN_STATUS_PREMIUM) {
        try {
            calendarGoalLearning = await loadCalendarGoalLearning({
                task,
                projectId,
                userId,
                loadConfig: loadCalendarRoutingConfig,
            })
        } catch (error) {
            console.warn('[taskGoalRouting] Could not load calendar Goal learning', {
                projectId,
                taskId: task.id,
                error: error.message,
            })
        }
    }

    if (calendarGoalLearning.exactSeriesRoute?.routeToNoGoal) {
        return { action: 'learned_no_goal', learnedFromFeedback: true }
    }

    const goals = await loadCandidateGoals(db, projectId, project, userId, task, {
        preferredGoalIds: [calendarGoalLearning.exactSeriesRoute?.targetGoalId],
        learnedRules: calendarGoalLearning.learnedGoalRules,
    })
    if (goals.length === 0) return { action: 'no_goals' }

    const exactGoal = calendarGoalLearning.exactSeriesRoute?.targetGoalId
        ? goals.find(goal => goal.id === calendarGoalLearning.exactSeriesRoute.targetGoalId) || null
        : null
    const usesExactCalendarGoalRoute = !!exactGoal
    if (!usesExactCalendarGoalRoute && (Number(userSnapshot.data()?.gold) || 0) < MINIMUM_GOLD_COST) {
        return { action: 'insufficient_gold' }
    }

    // The routing user's model preference; upstream id for the API, key for Gold metering.
    const { resolveFeatureModelKey } = require('../Assistant/featureModelPreferences')
    const { getModel } = require('../Assistant/assistantHelper')
    const routingModelKey = resolveFeatureModelKey('taskGoalRouting', userSnapshot.data() || {})
    const routingModel = getModel(routingModelKey)

    const taskRef = db.doc(`items/${projectId}/tasks/${task.id}`)
    const claimId = db.collection('_taskGoalRoutingClaims').doc().id
    const claimed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        const currentTask = snapshot.data()
        if (
            !snapshot.exists ||
            currentTask.parentGoalId ||
            currentTask.parentId ||
            currentTask.isSubtask ||
            currentTask.goalSuggestion
        ) {
            return false
        }
        transaction.update(taskRef, {
            goalSuggestion: {
                status: 'classifying',
                claimId,
                projectId,
                source: 'task_goal_router',
                createdAt: now,
            },
        })
        return true
    })
    if (!claimed) return { action: 'skipped' }

    const markClaimFinished = async goalSuggestion => {
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(taskRef)
            if (snapshot.exists && snapshot.data()?.goalSuggestion?.claimId === claimId) {
                transaction.update(taskRef, { goalSuggestion })
            }
        })
    }

    try {
        const classified = usesExactCalendarGoalRoute
            ? {
                  result: {
                      goalId: exactGoal.id,
                      confidence: 1,
                      alternativeGoalId: null,
                      alternativeConfidence: 0,
                      reason: 'Remembered from your calendar Goal choice for this recurring event.',
                  },
                  totalTokens: 0,
              }
            : await classify({
                  task,
                  goals,
                  userId,
                  model: routingModel,
                  learnedRules: calendarGoalLearning.learnedGoalRules,
              })
        const classification = normalizeClassificationResult(
            classified.result,
            goals.map(goal => goal.id)
        )
        const action = chooseRoutingAction(mode, classification)
        let goldSpent = 0
        let charge = { success: true }
        if (!usesExactCalendarGoalRoute) {
            const { calculateGoldCostFromTokens } = require('../Assistant/assistantHelper')
            const { deductGold } = require('../Gold/goldHelper')
            const estimatedGold = calculateGoldCostFromTokens(classified.totalTokens, routingModelKey)
            goldSpent = Math.max(MINIMUM_GOLD_COST, estimatedGold)
            charge = await deductGold(userId, goldSpent, {
                source: 'task_goal_routing',
                projectId,
                objectId: task.id,
                channel: 'tasks',
                model: routingModelKey || '',
            })
        }

        if (!charge?.success) {
            await markClaimFinished({
                status: 'failed',
                claimId,
                projectId,
                source: 'task_goal_router',
                reason: 'insufficient_gold',
                createdAt: now,
            })
            return { action: 'insufficient_gold' }
        }

        const selectedGoal = goals.find(goal => goal.id === classification.goalId) || null
        let appliedAction = action
        let appliedGoal = null
        let appliedSuggestion = null

        const applied = await db.runTransaction(async transaction => {
            const selectedGoalRef = selectedGoal ? db.doc(`goals/${projectId}/items/${selectedGoal.id}`) : null
            const currentMilestoneQuery = buildCurrentMilestoneQuery(
                db,
                projectId,
                project.parentTemplateId ? userId : ALL_USERS
            )
            const [snapshot, currentProjectSnapshot, currentGoalSnapshot, currentMilestoneSnapshot] = await Promise.all(
                [
                    transaction.get(taskRef),
                    transaction.get(projectRef),
                    selectedGoalRef ? transaction.get(selectedGoalRef) : Promise.resolve(null),
                    selectedGoalRef ? transaction.get(currentMilestoneQuery) : Promise.resolve(null),
                ]
            )
            const currentTask = snapshot.data()
            if (!snapshot.exists || currentTask.goalSuggestion?.claimId !== claimId) return false

            const currentMode = normalizeTaskGoalRoutingMode(currentProjectSnapshot.data()?.taskGoalRoutingMode)
            appliedAction = chooseRoutingAction(currentMode, classification)
            const suggestion = createSuggestion({
                classification,
                action: appliedAction,
                claimId,
                projectId,
                now,
                goldSpent,
                model: usesExactCalendarGoalRoute ? 'calendar-goal-learning' : routingModel,
                source: usesExactCalendarGoalRoute ? 'calendar_goal_learning' : 'task_goal_router',
            })

            if (!currentProjectSnapshot.exists || currentMode === TASK_GOAL_ROUTING_OFF) {
                transaction.update(taskRef, {
                    goalSuggestion: { ...suggestion, status: 'superseded', resolvedAt: now },
                })
                appliedAction = 'superseded'
                return false
            }

            const currentGoal = currentGoalSnapshot?.data()
            const currentMilestone = getFirstMilestone(currentMilestoneSnapshot)
            if (
                classification.goalId &&
                (!currentGoalSnapshot?.exists ||
                    !isGoalEligibleForTaskRouting(currentGoal, currentMilestone) ||
                    !isVisibleToUser(currentGoal, userId))
            ) {
                transaction.update(taskRef, {
                    goalSuggestion: {
                        ...suggestion,
                        status: 'superseded',
                        reason: 'goal_unavailable',
                        resolvedAt: now,
                    },
                })
                appliedAction = 'superseded'
                return false
            }

            if (currentTask.parentGoalId || currentTask.parentId || currentTask.isSubtask) {
                transaction.update(taskRef, {
                    goalSuggestion: { ...suggestion, status: 'superseded', resolvedAt: now },
                })
                appliedAction = 'superseded'
                return false
            }

            if (appliedAction !== 'auto_assign' || !selectedGoal) {
                transaction.update(taskRef, { goalSuggestion: suggestion })
                return true
            }

            const taskAfter = {
                parentGoalId: currentGoalSnapshot.id,
                parentGoalIsPublicFor: Array.isArray(currentGoal.isPublicFor) ? currentGoal.isPublicFor : [0],
                lockKey: currentGoal.lockKey || '',
                goalSuggestion: suggestion,
            }
            transaction.update(taskRef, taskAfter)
            appliedGoal = { id: currentGoalSnapshot.id, ...currentGoal }
            appliedSuggestion = suggestion

            const { createUndoActionRecord } = require('../shared/UndoActionService')
            const actionRef = db.collection(`users/${userId}/undoActions`).doc()
            transaction.set(
                actionRef,
                createUndoActionRecord({
                    actionId: actionRef.id,
                    initiatorId: userId,
                    actorId: userId,
                    source:
                        suggestion.source === 'calendar_goal_learning' ? 'calendar_goal_learning' : 'task_goal_routing',
                    label: `Added “${task.name || task.extendedName || 'Task'}” to “${
                        getTaskNameWithoutMeta(currentGoal.extendedName || currentGoal.name || '') || 'Goal'
                    }”`,
                    operations: [
                        {
                            objectType: 'task',
                            projectId,
                            objectId: task.id,
                            kind: 'update',
                            before: {
                                parentGoalId: currentTask.parentGoalId || null,
                                parentGoalIsPublicFor: currentTask.parentGoalIsPublicFor || null,
                                lockKey: currentTask.lockKey || '',
                                'goalSuggestion.status': 'dismissed',
                            },
                            after: {
                                parentGoalId: taskAfter.parentGoalId,
                                parentGoalIsPublicFor: taskAfter.parentGoalIsPublicFor,
                                lockKey: taskAfter.lockKey,
                                'goalSuggestion.status': 'auto_assigned',
                            },
                        },
                    ],
                    createdAt: now,
                })
            )
            return true
        })

        if (applied && appliedAction === 'auto_assign' && appliedGoal && appliedSuggestion) {
            await writeAutomaticGoalRoutingArtifacts({
                db,
                projectId,
                project,
                taskId: task.id,
                userId,
                userData: userSnapshot.data() || {},
                goal: appliedGoal,
                suggestion: appliedSuggestion,
            })
        }

        return {
            action: applied ? appliedAction : 'superseded',
            classification,
            learnedFromFeedback: usesExactCalendarGoalRoute,
        }
    } catch (error) {
        console.error('[taskGoalRouting] Failed to route task', { projectId, taskId: task.id, error })
        await markClaimFinished({
            status: 'failed',
            claimId,
            projectId,
            source: 'task_goal_router',
            reason: 'classification_failed',
            createdAt: now,
        })
        return { action: 'failed' }
    }
}

module.exports = {
    AUTO_ASSIGN_CONFIDENCE_THRESHOLD,
    AUTO_ASSIGN_MARGIN_THRESHOLD,
    SUGGESTION_CONFIDENCE_THRESHOLD,
    TASK_GOAL_ROUTING_AUTOMATIC,
    TASK_GOAL_ROUTING_OFF,
    TASK_GOAL_ROUTING_SUGGESTIONS,
    chooseRoutingAction,
    classifyTaskAgainstGoals,
    normalizeClassificationResult,
    normalizeTaskGoalRoutingMode,
    routeNewTaskToGoal,
    isGoalEligibleForTaskRouting,
    selectCandidateGoals,
    writeAutomaticGoalRoutingArtifacts,
}
