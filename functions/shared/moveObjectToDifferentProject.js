'use strict'

const admin = require('firebase-admin')

const { BACKLOG_DATE_NUMERIC, DEFAULT_WORKSTREAM_ID, generateSortIndex } = require('../Utils/HelperFunctionsCloud')
const { copyProjectMoveChat } = require('../Chats/copyProjectMoveChat')
const { getNotesBucketName } = require('./notesStorageBucket')
const { moveNoteToDifferentProject } = require('./moveNoteToDifferentProject')
const { moveTaskToDifferentProject } = require('./moveTaskToDifferentProject')
const { withoutAccessProjection } = require('./objectAccessProjection')
const { normalizeProjectMoveType } = require('./projectMoveContract')
const {
    GOAL_SCHEDULE_MODE_DYNAMIC,
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    getLinearMilestonePeriod,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
} = require('./goalMilestonesHelper')

const OBJECT_PATHS = Object.freeze({
    goal: (projectId, objectId) => `goals/${projectId}/items/${objectId}`,
    contact: (projectId, objectId) => `projectsContacts/${projectId}/contacts/${objectId}`,
    skill: (projectId, objectId) => `skills/${projectId}/items/${objectId}`,
})

function buildProjectMoveState({ requestId, sourceProjectId, targetProjectId, actorId, timestamp, status }) {
    return {
        requestId,
        sourceProjectId,
        targetProjectId,
        requestedByUserId: actorId,
        requestedAt: timestamp,
        status,
    }
}

function filterPrivacyForTarget(isPublicFor, targetUserIds, actorId) {
    if (!Array.isArray(isPublicFor) || isPublicFor.includes(0)) return [0]
    const targetMembers = new Set(targetUserIds || [])
    const filtered = isPublicFor.filter(id => targetMembers.has(id) || String(id).startsWith('ws@'))
    if (targetMembers.has(actorId) && !filtered.includes(actorId)) filtered.push(actorId)
    return filtered
}

function prepareGoalForTarget(goal, targetProject, actorId, projectMove) {
    const targetUserIds = targetProject.userIds || []
    const targetMembers = new Set(targetUserIds)
    const assigneesIds = (goal.assigneesIds || []).filter(id => targetMembers.has(id) || String(id).startsWith('ws@'))
    if (!assigneesIds.length || (goal.assigneesIds || []).includes(DEFAULT_WORKSTREAM_ID)) {
        if (!assigneesIds.includes(DEFAULT_WORKSTREAM_ID)) assigneesIds.push(DEFAULT_WORKSTREAM_ID)
    }
    const assigneesCapacity = Object.fromEntries(
        assigneesIds.map(id => [id, goal.assigneesCapacity?.[id] || 'CAPACITY_NONE'])
    )

    return withoutAccessProjection({
        ...goal,
        assigneesIds,
        assigneesCapacity,
        assigneesReminderDate: Object.fromEntries(
            assigneesIds
                .filter(id => goal.assigneesReminderDate?.[id] !== undefined)
                .map(id => [id, goal.assigneesReminderDate[id]])
        ),
        parentDoneMilestoneIds: [],
        progressByDoneMilestone: {},
        dateByDoneMilestone: {},
        sortIndexByMilestone: {},
        isPublicFor: filterPrivacyForTarget(goal.isPublicFor, targetUserIds, actorId),
        creatorId: targetMembers.has(goal.creatorId) ? goal.creatorId : actorId,
        lastEditorId: actorId,
        lastEditionDate: Date.now(),
        movingToOtherProjectId: null,
        projectMove,
    })
}

function prepareContactForTarget(contact, actorId, projectMove) {
    return withoutAccessProjection({
        ...contact,
        lastEditorId: actorId,
        lastEditionDate: Date.now(),
        lastVisitBoard: {},
        lastVisitBoardInGoals: {},
        assistantId: '',
        commentsData: null,
        openTasksAmount: 0,
        contactStatusId: null,
        movingToOtherProjectId: null,
        projectMove,
    })
}

function prepareSkillForTarget(skill, targetProject, actorId, projectMove) {
    return withoutAccessProjection({
        ...skill,
        isPublicFor: filterPrivacyForTarget(skill.isPublicFor, targetProject.userIds || [], actorId),
        lastEditorId: actorId,
        lastEditionDate: Date.now(),
        movingToOtherProjectId: null,
        projectMove,
    })
}

async function ensureTargetGoalMilestone(database, targetProjectId, targetProject, goal) {
    if (goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC) return null

    const milestones = database.collection(`goalsMilestones/${targetProjectId}/milestonesItems`)
    const dynamic = normalizeGoalScheduleMode(goal.scheduleMode) === GOAL_SCHEDULE_MODE_DYNAMIC
    const period = dynamic
        ? getLinearMilestonePeriod(
              goal.completionMilestoneDate,
              normalizeGoalMilestonesConfig(targetProject.goalMilestonesConfig)
          )
        : null
    let query = milestones.where('ownerId', '==', goal.ownerId).where('done', '==', false)
    query = dynamic
        ? query.where('periodKey', '==', period.periodKey)
        : query.where('date', '==', goal.completionMilestoneDate)
    const existing = await query.get()
    const expectedType = dynamic ? MILESTONE_TYPE_LINEAR : MILESTONE_TYPE_FIXED
    let milestoneId = existing.docs.find(doc => normalizeMilestoneType(doc.data().milestoneType) === expectedType)?.id
    if (!milestoneId) {
        const { buildFixedMilestoneData, buildLinearMilestoneData } = require('../Goals/linearGoalMilestones')
        const milestoneRef = milestones.doc()
        milestoneId = milestoneRef.id
        await milestoneRef.set(
            dynamic
                ? buildLinearMilestoneData(period, goal.ownerId)
                : buildFixedMilestoneData(goal.completionMilestoneDate, goal.ownerId)
        )
    }
    await database
        .doc(`goals/${targetProjectId}/items/${goal.id}`)
        .set({ sortIndexByMilestone: { [milestoneId]: generateSortIndex() } }, { merge: true })
    return milestoneId
}

async function moveStoredObject(params) {
    const {
        database,
        sourceProjectId,
        targetProjectId,
        objectId,
        objectType,
        actorId,
        requestId,
        sourceProject,
        targetProject,
    } = params
    const pathBuilder = OBJECT_PATHS[objectType]
    const sourceRef = database.doc(pathBuilder(sourceProjectId, objectId))
    const targetRef = database.doc(pathBuilder(targetProjectId, objectId))
    const [sourceSnapshot, targetSnapshot] = await Promise.all([sourceRef.get(), targetRef.get()])

    if (!sourceSnapshot.exists && targetSnapshot.exists) {
        const targetMove = targetSnapshot.data()?.projectMove
        if (targetMove?.requestId === requestId && targetMove.status !== 'completed') {
            await targetRef.set(
                { projectMove: { ...targetMove, status: 'completed', completedAt: Date.now() } },
                { merge: true }
            )
        }
        return { moved: false, reason: 'already_moved', sourceProjectId, targetProjectId, objectId, objectType }
    }
    if (!sourceSnapshot.exists) throw new Error(`${objectType} ${objectId} was not found in the source project`)
    if (targetSnapshot.exists && targetSnapshot.data()?.projectMove?.requestId !== requestId) {
        throw new Error(`The target project already contains ${objectType} ${objectId}`)
    }

    const timestamp = Date.now()
    const movingState = buildProjectMoveState({
        requestId,
        sourceProjectId,
        targetProjectId,
        actorId,
        timestamp,
        status: 'moving',
    })
    const sourceData = sourceSnapshot.data() || {}
    await sourceRef.set(
        {
            movingToOtherProjectId: targetProjectId,
            projectMove: movingState,
            lastEditionDate: timestamp,
            lastEditorId: actorId,
        },
        { merge: true }
    )

    const movedData =
        objectType === 'goal'
            ? prepareGoalForTarget(sourceData, targetProject, actorId, movingState)
            : objectType === 'contact'
              ? prepareContactForTarget(sourceData, actorId, movingState)
              : prepareSkillForTarget(sourceData, targetProject, actorId, movingState)
    await targetRef.set(movedData)

    if (objectType === 'goal') {
        await ensureTargetGoalMilestone(database, targetProjectId, targetProject, { id: objectId, ...movedData })
        const taskSnapshots = await database
            .collection(`items/${sourceProjectId}/tasks`)
            .where('parentGoalId', '==', objectId)
            .get()
        const rootTasks = taskSnapshots.docs.filter(doc => !doc.data()?.parentId)
        for (const taskSnapshot of rootTasks) {
            await moveTaskToDifferentProject({
                database,
                sourceProjectId,
                targetProjectId,
                taskId: taskSnapshot.id,
                editorId: actorId,
                manual: true,
                requestId: `${requestId}-${taskSnapshot.id}`,
                sourceProject,
                targetProject,
                targetGoal: { id: objectId, isPublicFor: movedData.isPublicFor, lockKey: movedData.lockKey || '' },
            })
        }
    }

    if (sourceData.noteId) {
        try {
            await moveNoteToDifferentProject({
                database,
                sourceProjectId,
                targetProjectId,
                noteId: sourceData.noteId,
                editorId: actorId,
                requestId: `${requestId}-note`,
                notesBucketName: getNotesBucketName(),
            })
        } catch (error) {
            if (!String(error?.message || '').includes('not found in source project')) throw error
            console.warn('Project move: linked note no longer exists', {
                objectType,
                objectId,
                noteId: sourceData.noteId,
            })
        }
    }

    await copyProjectMoveChat({
        adminRef: admin,
        actorId,
        sourceProjectId,
        targetProjectId,
        objectType: objectType === 'contact' ? 'contacts' : `${objectType}s`,
        objectId,
    })
    const copyInnerFeeds = params.copyInnerFeeds || require('../Feeds/globalFeedsHelper').copyInnerFeedsToOtherProject
    await copyInnerFeeds(admin, sourceProjectId, targetProjectId, `${objectType}s`, objectId)
    await sourceRef.delete()
    await targetRef.set(
        { projectMove: { ...movingState, status: 'completed', completedAt: Date.now() } },
        { merge: true }
    )

    return { moved: true, sourceProjectId, targetProjectId, objectId, objectType }
}

async function moveObjectToDifferentProject(params) {
    const objectType = normalizeProjectMoveType(params.objectType)
    const { database, sourceProjectId, targetProjectId, objectId, actorId, requestId } = params
    if (!objectType || !sourceProjectId || !targetProjectId || !objectId || !actorId || !requestId) {
        throw new Error('A supported object type, project ids, object id, actor id and request id are required')
    }
    if (sourceProjectId === targetProjectId) {
        return {
            moved: false,
            reason: 'already_in_target_project',
            sourceProjectId,
            targetProjectId,
            objectId,
            objectType,
        }
    }

    const [sourceProjectSnapshot, targetProjectSnapshot, actorSnapshot] = await Promise.all([
        database.doc(`projects/${sourceProjectId}`).get(),
        database.doc(`projects/${targetProjectId}`).get(),
        database.doc(`users/${actorId}`).get(),
    ])
    if (!sourceProjectSnapshot.exists || !targetProjectSnapshot.exists) throw new Error('Move project not found')
    const actor = actorSnapshot.exists ? actorSnapshot.data() || {} : {}
    const common = {
        ...params,
        objectType,
        editorId: actorId,
        editorName: actor.displayName || '',
        sourceProject: { id: sourceProjectId, ...(sourceProjectSnapshot.data() || {}) },
        targetProject: { id: targetProjectId, ...(targetProjectSnapshot.data() || {}) },
    }

    if (objectType === 'task') return moveTaskToDifferentProject({ ...common, taskId: objectId, manual: true })
    if (objectType === 'note') {
        return moveNoteToDifferentProject({
            ...common,
            noteId: objectId,
            feedUser: { uid: actorId },
            notesBucketName: getNotesBucketName(),
        })
    }
    if (objectType === 'chat') {
        const result = await copyProjectMoveChat({
            adminRef: admin,
            actorId,
            sourceProjectId,
            targetProjectId,
            objectType: 'topics',
            objectId,
            requestId,
        })
        const copyInnerFeeds =
            params.copyInnerFeeds || require('../Feeds/globalFeedsHelper').copyInnerFeedsToOtherProject
        await copyInnerFeeds(admin, sourceProjectId, targetProjectId, 'topics', objectId)
        return { ...result, sourceProjectId, targetProjectId, objectId, objectType }
    }
    return moveStoredObject(common)
}

module.exports = {
    OBJECT_PATHS,
    buildProjectMoveState,
    filterPrivacyForTarget,
    ensureTargetGoalMilestone,
    moveObjectToDifferentProject,
    prepareContactForTarget,
    prepareGoalForTarget,
    prepareSkillForTarget,
}
