'use strict'

/**
 * Gold rewards are granted by the server (AT-2978, security decision 1 of the 2026-11 audit).
 *
 * Until now the browser decided that a reward was earned and asked `earnGoldSecondGen` to pay it, so
 * a script could call that endpoint in a loop and collect the daily cap without doing anything. The
 * server now pays from what it can see itself:
 *
 * - a top-level task moves FORWARD (open -> workflow step -> ... -> done): `onUpdateTaskSecondGen`;
 * - a member writes a comment on a project-visible object in a guide: `onCreateObjectCommentSecondGen`.
 *
 * Each reward has an idempotency key, so a redelivered trigger pays once. The task key names the
 * step the task LEFT and the person paid for it, not the transition time: reopening a task and
 * completing it again pays nothing a second time, which is what made toggling a task a way to farm
 * the daily cap. The amount is derived from the key with the same hash the browser uses for its coin
 * animation (`getRewardGoldAmount` in utils/backends/firestore.js), so the animation shows exactly
 * what the server pays. The daily cap (`dailyGold`) is still applied by `earnGold`.
 */

const { getUserLocalDayStart } = require('../GoogleCalendar/calendarUserDay')

const OPEN_STEP = -1
const DONE_STEP = -2
const FEED_PUBLIC_FOR_ALL = 0

// MAX_GOLD_TO_EARN_BY_CHECK_TASKS and MAX_GOLD_TO_EARN_BY_COMMENT in TasksHelper.js.
const TASK_REWARD_MAX_GOLD = 5
const COMMENT_REWARD_MAX_GOLD = 3

const TASK_REWARD_SOURCE = 'task_completion'
const COMMENT_REWARD_SOURCE = 'guide_comment'

// Must stay identical to getRewardGoldAmount in utils/backends/firestore.js (pinned by the test).
function getRewardGoldAmount(maxGold, rewardKey) {
    const normalizedMaxGold = Number(maxGold)
    if (!Number.isFinite(normalizedMaxGold) || normalizedMaxGold <= 0 || !rewardKey) return 0

    let hash = 0
    for (let i = 0; i < rewardKey.length; i++) {
        hash = (hash * 31 + rewardKey.charCodeAt(i)) % 2147483647
    }

    return (Math.abs(hash) % normalizedMaxGold) + 1
}

// How far along a task is: 1 while open, one more for every workflow step reached, Infinity once done.
function getTaskProgressPosition(task) {
    if (!task) return 0
    if (task.done === true || task.currentReviewerId === DONE_STEP) return Number.POSITIVE_INFINITY
    return Array.isArray(task.stepHistory) && task.stepHistory.length > 0 ? task.stepHistory.length : 1
}

// Must stay identical to buildTaskProgressRewardKey in utils/backends/Tasks/tasksFirestore.js.
function buildTaskProgressRewardKey(taskId, stepIndex, recipientId) {
    if (!taskId || !Number.isFinite(stepIndex) || !recipientId) return ''
    return `task_progress:${taskId}:${stepIndex}:${recipientId}`
}

// Must stay identical to buildCommentRewardKey in utils/backends/Chats/chatsComments.js.
function buildCommentRewardKey(objectType, objectId, commentId) {
    if (!objectType || !objectId || !commentId) return ''
    return `comment:${objectType}:${objectId}:${commentId}`
}

/**
 * Who earns Gold for a task update, if anybody. Mirrors who the browser used to pay: leaving the
 * open step pays the task's owner after the move (`userId`), leaving a workflow step pays the
 * reviewer of that step. Subtasks earn nothing.
 */
function resolveTaskProgressReward(taskId, before, after) {
    if (!taskId || !before || !after || after.parentId) return null

    const from = getTaskProgressPosition(before)
    const to = getTaskProgressPosition(after)
    if (!Number.isFinite(from) || !(to > from)) return null

    const leavingOpen = from === 1
    const recipientId = leavingOpen ? after.userId : before.currentReviewerId
    if (typeof recipientId !== 'string' || !recipientId) return null

    const rewardKey = buildTaskProgressRewardKey(taskId, from, recipientId)
    if (!rewardKey) return null

    return {
        recipientId,
        // Leaving the open step only paid when the task's owner is a member (not a workstream).
        ownerId: leavingOpen ? before.userId : null,
        rewardKey,
        gold: getRewardGoldAmount(TASK_REWARD_MAX_GOLD, rewardKey),
    }
}

function getLocalRewardDay(userData, now) {
    const day = getUserLocalDayStart(userData, now)
    return { slimDate: day.format('DDMMYYYY'), dayDate: parseInt(day.format('YYYYMMDD'), 10) }
}

async function getProjectMemberIds(db, projectId) {
    const projectDoc = await db.doc(`projects/${projectId}`).get()
    if (!projectDoc.exists) return { exists: false, memberIds: [], project: null }
    const project = projectDoc.data() || {}
    return { exists: true, memberIds: Array.isArray(project.userIds) ? project.userIds : [], project }
}

async function payReward({ db, earnGold, projectId, recipientId, gold, rewardKey, objectId, objectType, source, now }) {
    const userDoc = await db.doc(`users/${recipientId}`).get()
    if (!userDoc.exists) return { skipped: 'recipient_not_a_user' }

    const { slimDate, dayDate } = getLocalRewardDay(userDoc.data() || {}, now)
    return earnGold(projectId, recipientId, gold, slimDate, now, dayDate, {
        rewardKey,
        objectId,
        objectType,
        source,
    })
}

async function awardTaskProgressGold({ db, earnGold, projectId, taskId, before, after, now = Date.now() }) {
    const reward = resolveTaskProgressReward(taskId, before, after)
    if (!reward) return { skipped: 'no_forward_transition' }

    const { memberIds } = await getProjectMemberIds(db, projectId)
    if (!memberIds.includes(reward.recipientId)) return { skipped: 'recipient_not_a_member' }
    if (reward.ownerId && !memberIds.includes(reward.ownerId)) return { skipped: 'owner_not_a_member' }

    return payReward({
        db,
        earnGold,
        projectId,
        recipientId: reward.recipientId,
        gold: reward.gold,
        rewardKey: reward.rewardKey,
        objectId: taskId,
        objectType: 'task',
        source: TASK_REWARD_SOURCE,
        now,
    })
}

function objectIsVisibleToWholeProject(objectType, objectData) {
    if (Array.isArray(objectData.isPublicFor)) return objectData.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    // Goals without isPublicFor are public (mapGoalData); nothing else is assumed to be.
    return objectType === 'goals'
}

/**
 * A member's new comment on a project-visible object in a guide earns a small reward, as it did when
 * the browser decided it (earnGoldInCommunitesWhenComment). Assistant and system comments do not.
 */
async function awardCommentGold({
    db,
    earnGold,
    getObjectDocPath,
    projectId,
    objectType,
    objectId,
    commentId,
    comment,
    now = Date.now(),
}) {
    const creatorId = comment?.creatorId
    if (typeof creatorId !== 'string' || !creatorId) return { skipped: 'no_creator' }
    if (comment.fromAssistant || comment.isLoading || comment.isThinking) return { skipped: 'not_a_member_comment' }

    const rewardKey = buildCommentRewardKey(objectType, objectId, commentId)
    if (!rewardKey) return { skipped: 'no_reward_key' }

    const { exists, memberIds, project } = await getProjectMemberIds(db, projectId)
    if (!exists || !project.parentTemplateId) return { skipped: 'not_a_guide' }
    if (!memberIds.includes(creatorId)) return { skipped: 'creator_not_a_member' }

    const objectPath = getObjectDocPath(projectId, objectType, objectId)
    if (!objectPath || objectPath.startsWith('users/') || objectPath === `projects/${projectId}`) {
        return { skipped: 'unsupported_object' }
    }
    const objectDoc = await db.doc(objectPath).get()
    if (!objectDoc.exists) return { skipped: 'object_missing' }
    if (!objectIsVisibleToWholeProject(objectType, objectDoc.data() || {})) return { skipped: 'object_not_public' }

    return payReward({
        db,
        earnGold,
        projectId,
        recipientId: creatorId,
        gold: getRewardGoldAmount(COMMENT_REWARD_MAX_GOLD, rewardKey),
        rewardKey,
        objectId,
        objectType,
        source: COMMENT_REWARD_SOURCE,
        now,
    })
}

module.exports = {
    OPEN_STEP,
    DONE_STEP,
    TASK_REWARD_MAX_GOLD,
    COMMENT_REWARD_MAX_GOLD,
    TASK_REWARD_SOURCE,
    COMMENT_REWARD_SOURCE,
    getRewardGoldAmount,
    getTaskProgressPosition,
    buildTaskProgressRewardKey,
    buildCommentRewardKey,
    resolveTaskProgressReward,
    awardTaskProgressGold,
    awardCommentGold,
}
