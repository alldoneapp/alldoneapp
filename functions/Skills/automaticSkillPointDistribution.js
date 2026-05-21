const admin = require('firebase-admin')
const moment = require('moment')
const { uniq } = require('lodash')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { FEED_SKILL_CHANGES_POINTS } = require('../Feeds/FeedsConstants')
const {
    generateCurrentDateObject,
    generateFeedModel,
    loadFeedObject,
    proccessFeed,
} = require('../Feeds/globalFeedsHelper')
const { interactWithChatStream, reduceGoldWhenChatWithAI, normalizeModelKey } = require('../Assistant/assistantHelper')

const SKILL_POINTS_PER_LEVEL = 5
const MANUAL_DISTRIBUTION_POINTS = 5
const FIRST_RUN_WINDOW_DAYS = 14
const MAX_TASKS_FOR_PROMPT = 200
const MAX_SKILLS_FOR_PROMPT = 200
const DAY_RATE_TIME_LOG_TYPE = 'dayRateTimeLog'

const normalizeTimestamp = value => {
    if (!value) return 0
    if (typeof value === 'number') return value
    if (typeof value.toMillis === 'function') return value.toMillis()
    if (value.seconds !== undefined) {
        return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

const truncate = (value, maxLength = 180) => {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

const isAutoDistributionEnabled = user => user.automaticSkillPointDistributionEnabled !== false

const getActiveProjectIds = user => {
    const projectIds = Array.isArray(user.projectIds) ? user.projectIds : []
    const archived = new Set(Array.isArray(user.archivedProjectIds) ? user.archivedProjectIds : [])
    const templates = new Set(Array.isArray(user.templateProjectIds) ? user.templateProjectIds : [])
    return projectIds.filter(projectId => projectId && !archived.has(projectId) && !templates.has(projectId))
}

const getDistributionProjectIds = (projectIds, projectsById) =>
    projectIds.filter(projectId => {
        const project = projectsById[projectId]
        return project && project.active !== false && project.isTemplate !== true
    })

async function getProjectMap(projectIds) {
    const db = admin.firestore()
    const docs = await Promise.all(projectIds.map(projectId => db.doc(`projects/${projectId}`).get()))
    return docs.reduce((map, doc) => {
        if (doc.exists) map[doc.id] = { ...doc.data(), id: doc.id }
        return map
    }, {})
}

async function resolveDefaultProjectAssistant(user, projectsById) {
    const db = admin.firestore()
    const defaultProjectId = user.defaultProjectId || ''
    const defaultProject = projectsById[defaultProjectId]
    if (!defaultProjectId || !defaultProject) return null

    const assistantsSnapshot = await db.collection(`assistants/${defaultProjectId}/items`).get()
    const projectAssistants = assistantsSnapshot.docs.map(doc => ({
        ...doc.data(),
        uid: doc.id,
        projectId: defaultProjectId,
    }))
    let assistant = projectAssistants.find(item => item.isDefault)

    if (!assistant && defaultProject.assistantId) {
        assistant = projectAssistants.find(item => item.uid === defaultProject.assistantId)
        if (!assistant) {
            const globalDoc = await db.doc(`assistants/globalProject/items/${defaultProject.assistantId}`).get()
            if (globalDoc.exists) assistant = { ...globalDoc.data(), uid: globalDoc.id, projectId: 'globalProject' }
        }
    }

    if (!assistant && projectAssistants.length > 0) assistant = projectAssistants[0]
    if (!assistant) return null

    return {
        ...assistant,
        model: normalizeModelKey(assistant.model || 'MODEL_GPT5_5'),
        temperature: assistant.temperature || 'TEMPERATURE_NORMAL',
        displayName: assistant.displayName || 'Assistant',
        defaultProjectId,
    }
}

async function collectSkills(projectIds, userId) {
    const db = admin.firestore()
    const snapshots = await Promise.all(
        projectIds.map(projectId => db.collection(`skills/${projectId}/items`).where('userId', '==', userId).get())
    )

    return snapshots.flatMap((snapshot, index) => {
        const projectId = projectIds[index]
        return snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            projectId,
            points: Number(doc.data().points || 0),
            created: normalizeTimestamp(doc.data().created),
        }))
    })
}

const isEligibleTask = (task, userId, windowStart, windowEnd) => {
    const completed = normalizeTimestamp(task.completed)
    return (
        task.done === true &&
        task.userId === userId &&
        task.isSubtask !== true &&
        !task.parentId &&
        task.genericData?.type !== DAY_RATE_TIME_LOG_TYPE &&
        !task.genericData &&
        completed >= windowStart &&
        completed <= windowEnd
    )
}

async function collectEligibleTasks(projectIds, userId, windowStart, windowEnd) {
    const db = admin.firestore()
    const snapshots = await Promise.all(
        projectIds.map(projectId =>
            db
                .collection(`items/${projectId}/tasks`)
                .where('completed', '>=', windowStart)
                .where('completed', '<=', windowEnd)
                .orderBy('completed', 'desc')
                .get()
        )
    )

    return snapshots
        .flatMap((snapshot, index) => {
            const projectId = projectIds[index]
            return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, projectId }))
        })
        .filter(task => isEligibleTask(task, userId, windowStart, windowEnd))
        .sort((a, b) => normalizeTimestamp(b.completed) - normalizeTimestamp(a.completed))
}

function allocateEvenly(skills, pointsToDistribute) {
    const orderedSkills = [...skills].sort((a, b) => {
        if (a.points !== b.points) return a.points - b.points
        if (a.created !== b.created) return a.created - b.created
        return `${a.projectId}:${a.id}`.localeCompare(`${b.projectId}:${b.id}`)
    })

    const allocations = []
    for (let i = 0; i < pointsToDistribute; i++) {
        const skill = orderedSkills[i % orderedSkills.length]
        let allocation = allocations.find(item => item.projectId === skill.projectId && item.skillId === skill.id)
        if (!allocation) {
            allocation = {
                projectId: skill.projectId,
                skillId: skill.id,
                points: 0,
                rationale: 'No eligible completed tasks were found, so points were split evenly across your skills.',
                evidenceTaskIds: [],
            }
            allocations.push(allocation)
        }
        allocation.points++
    }
    return allocations
}

function buildAllocationPrompt({ user, skills, tasks, pointsToDistribute, projectsById }) {
    const skillRows = skills.slice(0, MAX_SKILLS_FOR_PROMPT).map(skill => ({
        projectId: skill.projectId,
        projectName: projectsById[skill.projectId]?.name || skill.projectId,
        skillId: skill.id,
        name: truncate(skill.extendedName || skill.name || 'Untitled skill', 120),
        description: truncate(skill.description || '', 240),
        currentPoints: skill.points,
    }))

    const taskRows = tasks.slice(0, MAX_TASKS_FOR_PROMPT).map(task => ({
        projectId: task.projectId,
        projectName: projectsById[task.projectId]?.name || task.projectId,
        taskId: task.id,
        name: truncate(task.extendedName || task.name || 'Untitled task', 160),
        description: truncate(task.description || '', 260),
        completed: normalizeTimestamp(task.completed),
        estimationMinutes: task.estimations?.Open || task.estimations?.open || task.estimations?.['-1'] || 0,
    }))

    return [
        [
            'system',
            [
                'You distribute Alldone skill points after a user levels up.',
                'Return only strict JSON with this exact shape:',
                '{"allocations":[{"projectId":"...","skillId":"...","points":1,"rationale":"...","evidenceTaskIds":["..."]}]}',
                'Rules:',
                `- Allocate exactly ${pointsToDistribute} total points.`,
                '- Use only the provided projectId and skillId values.',
                '- points must be positive integers.',
                '- Prefer skills best supported by the completed tasks.',
                '- rationale must be one concise sentence suitable for a skill comment.',
                '- evidenceTaskIds must contain only provided task IDs that support the rationale.',
            ].join('\n'),
        ],
        [
            'user',
            JSON.stringify({
                user: { userId: user.uid, displayName: user.displayName || '' },
                pointsToDistribute,
                skills: skillRows,
                completedTasks: taskRows,
            }),
        ],
    ]
}

async function collectStreamText(stream) {
    let text = ''
    for await (const chunk of stream) {
        const content =
            (typeof chunk === 'string' && chunk) ||
            chunk?.content ||
            chunk?.text ||
            chunk?.choices?.[0]?.delta?.content ||
            chunk?.choices?.[0]?.message?.content ||
            ''
        text += content
    }
    return text.trim()
}

function parseJsonResponse(text) {
    const trimmed = String(text || '').trim()
    const withoutFence = trimmed
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim()
    return JSON.parse(withoutFence)
}

async function getAssistantAllocations({ user, assistant, skills, tasks, pointsToDistribute, projectsById }) {
    if (Number(user.gold || 0) <= 0) {
        throw new Error('insufficient_gold')
    }

    const messages = buildAllocationPrompt({ user, skills, tasks, pointsToDistribute, projectsById })
    const stream = await interactWithChatStream(messages, assistant.model, assistant.temperature, [], {
        projectId: assistant.defaultProjectId,
        assistantId: assistant.uid,
        requestUserId: user.uid,
    })
    const responseText = await collectStreamText(stream)
    await reduceGoldWhenChatWithAI(user.uid, Number(user.gold || 0), assistant.model, responseText, messages, null, {
        projectId: assistant.defaultProjectId,
        objectType: 'automaticSkillPointDistribution',
        objectId: user.uid,
    })
    return parseJsonResponse(responseText).allocations
}

function validateAllocations(allocations, skills, tasks, pointsToDistribute) {
    if (!Array.isArray(allocations) || allocations.length === 0) throw new Error('No allocations returned')
    const skillKeys = new Set(skills.map(skill => `${skill.projectId}:${skill.id}`))
    const taskIds = new Set(tasks.map(task => task.id))
    const allocationsBySkill = {}

    allocations.forEach(allocation => {
        const key = `${allocation.projectId}:${allocation.skillId}`
        if (!allocationsBySkill[key]) {
            allocationsBySkill[key] = {
                projectId: allocation.projectId,
                skillId: allocation.skillId,
                points: 0,
                rationale: '',
                evidenceTaskIds: [],
            }
        }
        allocationsBySkill[key].points += Number(allocation.points || 0)
        if (!allocationsBySkill[key].rationale && allocation.rationale) {
            allocationsBySkill[key].rationale = allocation.rationale
        }
        if (Array.isArray(allocation.evidenceTaskIds)) {
            allocationsBySkill[key].evidenceTaskIds.push(...allocation.evidenceTaskIds)
        }
    })

    const normalizedAllocations = Object.values(allocationsBySkill)
    let total = 0

    normalizedAllocations.forEach(allocation => {
        const key = `${allocation.projectId}:${allocation.skillId}`
        if (!skillKeys.has(key)) throw new Error(`Invalid skill allocation: ${key}`)
        if (!Number.isInteger(allocation.points) || allocation.points <= 0) {
            throw new Error(`Invalid points for ${key}`)
        }
        total += allocation.points
        allocation.evidenceTaskIds = uniq(allocation.evidenceTaskIds.filter(taskId => taskIds.has(taskId)))
        allocation.rationale = truncate(allocation.rationale || 'Recent completed tasks supported this skill.', 280)
    })

    if (total !== pointsToDistribute) {
        throw new Error(`Invalid allocation total: ${total}, expected ${pointsToDistribute}`)
    }

    return normalizedAllocations
}

async function ensureChat(projectId, skill, assistant, followers) {
    const db = admin.firestore()
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${skill.id}`)
    const chatDoc = await chatRef.get()
    const now = Date.now()
    const title = skill.extendedName || skill.name || 'Untitled skill'
    const isPublicFor = Array.isArray(skill.isPublicFor) ? skill.isPublicFor : [FEED_PUBLIC_FOR_ALL]

    if (!chatDoc.exists) {
        await chatRef.set({
            id: skill.id,
            title,
            type: 'skills',
            members: uniq([skill.userId, assistant.uid].filter(Boolean)),
            lastEditionDate: now,
            lastEditorId: assistant.uid,
            commentsData: {
                amount: 0,
                lastComment: '',
                lastCommentOwnerId: '',
                lastCommentType: '',
            },
            hasStar: '#ffffff',
            creatorId: skill.userId,
            isPublicFor,
            created: now,
            usersFollowing: followers,
            quickDateId: '',
            assistantId: skill.assistantId || assistant.uid,
            stickyData: { days: 0, stickyEndDate: 0 },
        })
    }
}

async function getSkillFollowers(projectId, skillId, isPublicFor) {
    const followerDoc = await admin.firestore().doc(`followers/${projectId}/skills/${skillId}`).get()
    let followers =
        followerDoc.exists && Array.isArray(followerDoc.data().usersFollowing) ? followerDoc.data().usersFollowing : []
    if (Array.isArray(isPublicFor) && !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        followers = followers.filter(userId => isPublicFor.includes(userId))
    }
    return followers
}

function getUsersToNotify(project, isPublicFor, assistantId) {
    let userIds = Array.isArray(project?.userIds) ? project.userIds : []
    if (Array.isArray(isPublicFor) && !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        userIds = userIds.filter(userId => isPublicFor.includes(userId))
    }
    return userIds.filter(userId => userId && userId !== assistantId)
}

async function writeSkillComment(batch, { project, skill, assistant, allocation, commentId, commentText, followers }) {
    const db = admin.firestore()
    const now = Date.now()
    const isPublicFor = Array.isArray(skill.isPublicFor) ? skill.isPublicFor : [FEED_PUBLIC_FOR_ALL]
    const userIdsToNotify = getUsersToNotify(project, isPublicFor, assistant.uid)
    const followersMap = followers.reduce((map, userId) => {
        map[userId] = true
        return map
    }, {})

    batch.set(db.doc(`chatComments/${skill.projectId}/skills/${skill.id}/comments/${commentId}`), {
        commentText,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistant.uid,
        fromAssistant: true,
        source: 'automaticSkillPointDistribution',
        automaticSkillPointDistribution: {
            points: allocation.points,
            evidenceTaskIds: allocation.evidenceTaskIds || [],
        },
    })

    const chatUpdate = {
        members: admin.firestore.FieldValue.arrayUnion(skill.userId, assistant.uid),
        lastEditionDate: now,
        lastEditorId: assistant.uid,
        [`commentsData.lastCommentOwnerId`]: assistant.uid,
        [`commentsData.lastComment`]: commentText,
        [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
        [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
    }
    if (followers.length > 0) chatUpdate.usersFollowing = admin.firestore.FieldValue.arrayUnion(...followers)

    batch.set(db.doc(`chatObjects/${skill.projectId}/chats/${skill.id}`), chatUpdate, { merge: true })

    batch.update(db.doc(`skills/${skill.projectId}/items/${skill.id}`), {
        points: admin.firestore.FieldValue.increment(allocation.points),
        lastEditionDate: now,
        lastEditorId: assistant.uid,
        [`commentsData.lastComment`]: commentText,
        [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
        [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
    })

    userIdsToNotify.forEach(userId => {
        batch.set(db.doc(`chatNotifications/${skill.projectId}/${userId}/${commentId}`), {
            chatId: skill.id,
            chatType: 'skills',
            followed: !!followersMap[userId],
            date: moment().utc().valueOf(),
            creatorId: assistant.uid,
            creatorType: 'assistant',
        })
    })

    batch.set(
        db.doc(`emailNotifications/${skill.id}`),
        {
            userIds: followers,
            projectId: skill.projectId,
            objectType: 'skills',
            objectId: skill.id,
            objectName: skill.extendedName || skill.name || 'Untitled skill',
            messageTimestamp: moment().utc().valueOf(),
        },
        { merge: true }
    )

    if (followers.length > 0) {
        batch.set(db.doc(`pushNotifications/${commentId}`), {
            userIds: followers,
            body: `${project?.name || skill.projectId}\n  Skill: ${
                skill.extendedName || skill.name || 'Untitled skill'
            }\n ${assistant.displayName} commented: ${commentText}`,
            link: `/projects/${skill.projectId}/skills/${skill.id}/chat`,
            messageTimestamp: moment().utc().valueOf(),
            type: 'Chat Notification',
            chatId: skill.id,
            projectId: skill.projectId,
            initiatorId: null,
        })

        followers.forEach(followerId => {
            batch.update(db.doc(`users/${followerId}`), {
                [`lastAssistantCommentData.${skill.projectId}`]: {
                    objectType: 'skills',
                    objectId: skill.id,
                    creatorId: assistant.uid,
                    creatorType: 'assistant',
                    date: moment().utc().valueOf(),
                },
                [`lastAssistantCommentData.allProjects`]: {
                    objectType: 'skills',
                    objectId: skill.id,
                    creatorId: assistant.uid,
                    creatorType: 'assistant',
                    date: moment().utc().valueOf(),
                    projectId: skill.projectId,
                },
            })
        })
    }
}

async function writeSkillPointFeed(batch, projectId, skill, assistant, oldPoints, newPoints, project) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const feedObject = await loadFeedObject(projectId, skill.id, 'skills', currentMilliseconds, batch)
    if (!feedObject) return

    const entryText = `increased skill points from ${oldPoints} to ${newPoints}`
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_CHANGES_POINTS,
        lastChangeDate: currentMilliseconds,
        entryText,
        feedUser: assistant,
        objectId: skill.id,
        isPublicFor: skill.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        skill.id,
        'skills',
        feedObject,
        feedId,
        feed,
        assistant,
        batch,
        true,
        {
            feedCreator: assistant,
            project,
        }
    )
}

function buildCommentText(allocation, tasksById) {
    const evidenceNames = (allocation.evidenceTaskIds || [])
        .map(taskId => tasksById[taskId])
        .filter(Boolean)
        .slice(0, 3)
        .map(task => `"${truncate(task.extendedName || task.name || 'Untitled task', 80)}"`)

    const evidenceText = evidenceNames.length > 0 ? ` Evidence: ${evidenceNames.join(', ')}.` : ''
    return `Auto-distributed +${allocation.points} skill point${allocation.points === 1 ? '' : 's'}. ${
        allocation.rationale
    }${evidenceText}`
}

async function applyAllocations({
    auditRef,
    user,
    assistant,
    allocations,
    skills,
    tasks,
    projectsById,
    pointsToDistribute,
    userSkillPointDelta = -pointsToDistribute,
    windowStart,
    windowEnd,
}) {
    const db = admin.firestore()
    const skillsByKey = skills.reduce((map, skill) => {
        map[`${skill.projectId}:${skill.id}`] = skill
        return map
    }, {})
    const tasksById = tasks.reduce((map, task) => {
        map[task.id] = task
        return map
    }, {})

    const batch = new BatchWrapper(db)
    if (userSkillPointDelta !== 0) {
        batch.update(db.doc(`users/${user.uid}`), {
            skillPoints: admin.firestore.FieldValue.increment(userSkillPointDelta),
        })
    }

    for (const allocation of allocations) {
        const skill = skillsByKey[`${allocation.projectId}:${allocation.skillId}`]
        const project = projectsById[skill.projectId]
        const followers = await getSkillFollowers(skill.projectId, skill.id, skill.isPublicFor)
        await ensureChat(skill.projectId, skill, assistant, followers)
        const commentId = db.collection('_').doc().id
        const commentText = buildCommentText(allocation, tasksById)

        await writeSkillComment(batch, { project, skill, assistant, allocation, commentId, commentText, followers })
        await writeSkillPointFeed(
            batch,
            skill.projectId,
            skill,
            assistant,
            skill.points,
            skill.points + allocation.points,
            project
        )
    }

    batch.set(
        auditRef,
        {
            status: 'applied',
            appliedAt: Date.now(),
            distributedPoints: pointsToDistribute,
            windowStart,
            windowEnd,
            allocations,
        },
        { merge: true }
    )
    await batch.commit()
    return { status: 'applied', distributedPoints: pointsToDistribute, allocations }
}

async function markAudit(auditRef, data) {
    await auditRef.set({ ...data, updatedAt: Date.now() }, { merge: true })
    return data
}

async function processSkillPointDistributionEvent({
    userId,
    oldUser,
    newUser,
    oldLevel,
    newLevel,
    pointsToDistribute,
    levelUpAt,
    windowStart,
    windowEnd,
    eventId,
    trigger,
    respectEnabled = true,
    userSkillPointDelta = -pointsToDistribute,
}) {
    const auditRef = admin.firestore().doc(`automaticSkillPointDistributions/${eventId}`)

    try {
        await auditRef.create({
            eventId,
            userId,
            oldLevel,
            newLevel,
            pointsToDistribute,
            windowStart,
            windowEnd,
            trigger,
            status: 'running',
            createdAt: Date.now(),
        })
    } catch (error) {
        if (error.code === 6 || error.code === 'already-exists') {
            return { status: 'skipped', reason: 'duplicate_event', eventId }
        }
        throw error
    }

    if (respectEnabled && !isAutoDistributionEnabled(newUser)) {
        return await markAudit(auditRef, { status: 'skipped', reason: 'disabled', eventId })
    }

    try {
        const activeProjectIds = getActiveProjectIds(newUser)
        const projectsById = await getProjectMap(activeProjectIds)
        const projectIds = getDistributionProjectIds(activeProjectIds, projectsById)
        const assistant = await resolveDefaultProjectAssistant(newUser, projectsById)
        if (!assistant?.uid) throw new Error('No default project assistant found')

        const skills = await collectSkills(projectIds, userId)
        if (skills.length === 0) {
            return await markAudit(auditRef, {
                status: 'skipped',
                reason: 'no_skills',
                eventId,
                defaultProjectId: assistant.defaultProjectId,
                assistantId: assistant.uid,
            })
        }

        const tasks = await collectEligibleTasks(projectIds, userId, windowStart, windowEnd)
        let allocations =
            tasks.length === 0
                ? allocateEvenly(skills, pointsToDistribute)
                : await getAssistantAllocations({
                      user: newUser,
                      assistant,
                      skills,
                      tasks,
                      pointsToDistribute,
                      projectsById,
                  })

        allocations = validateAllocations(allocations, skills, tasks, pointsToDistribute)

        await applyAllocations({
            auditRef,
            user: newUser,
            assistant,
            allocations,
            skills,
            tasks,
            projectsById,
            pointsToDistribute,
            windowStart,
            windowEnd,
            userSkillPointDelta,
        })
        return {
            status: 'applied',
            eventId,
            distributedPoints: pointsToDistribute,
            allocations,
        }
    } catch (error) {
        console.error('[AutomaticSkillPointDistribution] Failed', {
            userId,
            oldLevel,
            newLevel,
            error: error.message,
        })
        return await markAudit(auditRef, {
            status: 'failed',
            eventId,
            error: error.message,
        })
    }
}

async function processAutomaticSkillPointDistribution(userId, oldUser, newUser) {
    const oldLevel = Number(oldUser.level || 1)
    const newLevel = Number(newUser.level || 1)
    if (newLevel <= oldLevel) return null

    const pointsToDistribute = (newLevel - oldLevel) * SKILL_POINTS_PER_LEVEL
    const levelUpAt = normalizeTimestamp(newUser.lastSkillPointLevelUpAt) || Date.now()
    const previousLevelUpAt = normalizeTimestamp(oldUser.lastSkillPointLevelUpAt)
    const windowStart = previousLevelUpAt || levelUpAt - FIRST_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000

    return await processSkillPointDistributionEvent({
        userId,
        oldUser,
        newUser,
        oldLevel,
        newLevel,
        pointsToDistribute,
        levelUpAt,
        windowStart,
        windowEnd: levelUpAt,
        eventId: `${userId}_${oldLevel}_${newLevel}_${levelUpAt}`,
        trigger: 'level_up',
    })
}

async function processManualSkillPointDistribution(userId) {
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) throw new Error('User not found')

    const user = { ...userDoc.data(), uid: userDoc.id }
    const now = Date.now()
    const level = Number(user.level || 1)
    const previousLevelUpAt = normalizeTimestamp(user.lastSkillPointLevelUpAt)

    return await processSkillPointDistributionEvent({
        userId,
        oldUser: user,
        newUser: user,
        oldLevel: level,
        newLevel: level,
        pointsToDistribute: MANUAL_DISTRIBUTION_POINTS,
        levelUpAt: now,
        windowStart: previousLevelUpAt || now - FIRST_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        windowEnd: now,
        eventId: `${userId}_manual_${now}`,
        trigger: 'manual_test',
        respectEnabled: false,
        userSkillPointDelta: 0,
    })
}

module.exports = {
    processAutomaticSkillPointDistribution,
    processManualSkillPointDistribution,
    __private__: {
        allocateEvenly,
        validateAllocations,
        isEligibleTask,
        getActiveProjectIds,
        getDistributionProjectIds,
        buildAllocationPrompt,
        collectStreamText,
        parseJsonResponse,
    },
}
