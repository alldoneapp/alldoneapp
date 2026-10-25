'use strict'

const admin = require('firebase-admin')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createTaskUpdatedFeed } = require('../Feeds/tasksFeeds')
const { generateTaskObjectModel } = require('../Feeds/tasksFeedsHelper')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function summarizeEvent(task = {}) {
    return normalizeText(task.extendedName || task.name) || 'calendar event'
}

function buildCalendarLearnedRuleFeedText({ task = {}, ruleType, targetProject = null, selectedGoal = null } = {}) {
    const eventName = summarizeEvent(task)

    if (ruleType === 'goal') {
        return selectedGoal
            ? `created a learned calendar Goal rule • Add “${eventName}” to Goal “${selectedGoal.name}”`
            : `created a learned calendar Goal rule • Leave “${eventName}” without a Goal`
    }

    return `created a learned calendar project rule • Route “${eventName}” to “${
        targetProject?.name || 'the selected project'
    }”`
}

async function createCalendarLearnedRuleFeed({
    feedbackId,
    projectId,
    projectData = {},
    task = {},
    userId,
    userData = {},
    ruleType,
    targetProject = null,
    selectedGoal = null,
}) {
    if (!feedbackId || !projectId || !task.id || !userId) {
        throw new Error('Cannot create calendar learned-rule feed without feedback, project, task, and user IDs')
    }

    const db = admin.firestore()
    const feedUser = {
        uid: userId,
        displayName: userData.displayName || '',
        photoURL: userData.photoURL || '',
        dateFormat: userData.dateFormat || null,
    }
    const project = { ...projectData, id: projectId }
    const feedId = `calendar-learned-rule-${feedbackId}`

    loadFeedsGlobalState(admin, admin, feedUser, project, [], null)
    const batch = new BatchWrapper(db)
    batch.setProjectContext(projectId)
    batch.feedObjects = {
        [task.id]: generateTaskObjectModel(Date.now(), task, task.id),
    }

    await createTaskUpdatedFeed(projectId, task, task.id, batch, feedUser, false, {
        feedId,
        entryText: buildCalendarLearnedRuleFeedText({ task, ruleType, targetProject, selectedGoal }),
    })
    await batch.commit()

    return { feedId }
}

module.exports = {
    buildCalendarLearnedRuleFeedText,
    createCalendarLearnedRuleFeed,
}
