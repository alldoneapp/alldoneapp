'use strict'

const { getEmailIdentity } = require('./emailThreadIdentity')
const { resolveEmailThreadTask } = require('./emailThreadTaskStore')
const { getAccessibleProjectIdsFromUserData } = require('../shared/privacyAccess')
const { TaskCommentService } = require('../shared/TaskCommentService')

// Mail the owner sent is their own message on the task: no summary model, no Gold, and never a
// content update or reopening, which only the other side's mail may cause.
async function appendSentMessageToTask({ database, userId, userData, identity, selected, gmailData, context }) {
    const { buildSentMessageText } = require('./emailThreadTopicStore')
    const service = new TaskCommentService({ database })
    const comment = await service.addComment({
        projectId: selected.projectId,
        taskId: selected.taskId,
        commentId: `email_${identity.messageKey}`,
        comment: buildSentMessageText(context),
        actor: { uid: userId, displayName: userData?.displayName || 'Email', fromAssistant: false },
        fromAssistant: false,
        gmailData: {
            ...gmailData,
            accountUserId: userId,
            taskProjectId: selected.projectId,
            direction: 'outgoing',
            receivedAt: Number(context.internalDate) || Date.parse(context.date) || 0,
        },
        linkEmail: false,
        // The owner's own reply: nothing for anybody to read as new.
        silent: true,
    })
    return {
        taskId: selected.taskId,
        projectId: selected.projectId,
        taskName: comment.taskName || selected.task.name,
        existing: true,
        goldCost: 0,
        updated: !comment.existing,
        commentId: comment.commentId,
        sentByOwner: true,
    }
}

// `reopenOnNewEmail`: whether this email may reopen a done task. Callers that know the email's
// classification pass it (the labeling sync: actionable or needs a reply); the explicit
// "Create task" action leaves the default, since the user asked for the task themselves.
// `needsReply`: the email asks the user for an answer, which turns a reply task back on.
async function continueEmailThread({
    database,
    userId,
    userData,
    gmailData,
    context,
    actor,
    fromAssistant = false,
    sentByOwner = false,
    reopenOnNewEmail = true,
    needsReply = false,
}) {
    const identity = getEmailIdentity(userId, gmailData)
    if (!identity) return null
    const projectIds = getAccessibleProjectIdsFromUserData(userData)
    const selected = await resolveEmailThreadTask({ database, identity, projectIds, includeAmbiguity: true })
    if (!selected) return null
    if (selected.ambiguous) return selected
    const result = {
        taskId: selected.taskId,
        projectId: selected.projectId,
        taskName: selected.task.name,
        existing: true,
        goldCost: 0,
    }
    if (
        [selected.task.gmailData.messageId, ...(selected.task.gmailData.messageIds || [])].includes(identity.messageId)
    ) {
        return result
    }
    if (sentByOwner) {
        return appendSentMessageToTask({ database, userId, userData, identity, selected, gmailData, context })
    }

    const resolvedActor = typeof actor === 'function' ? await actor(selected) : actor

    // The provider context may contain Outlook HTML. Models receive bounded email
    // data; only their summary is persisted as a comment, never the full body.
    const { summarizeEmailContinuation } = require('./emailLine/taskSummarizer')
    const { resolveFeatureModelKey } = require('../Assistant/featureModelPreferences')
    const summary = await summarizeEmailContinuation({
        context: {
            from: context.from || '',
            subject: context.subject || '',
            date: context.date || '',
            body: String(context.bodyText || context.body || context.snippet || '').slice(0, 12000),
        },
        task: selected.task,
        language: userData.language || userData.appLanguage,
        cacheScope: `${userId}:${identity.key}`,
        modelKey: resolveFeatureModelKey('emailTaskSummary', userData),
    })
    const emailData = {
        ...gmailData,
        origin: selected.task.gmailData.origin || 'gmail_label_follow_up',
        accountUserId: userId,
        taskProjectId: selected.projectId,
        receivedAt: Number(context.internalDate) || Date.parse(context.date) || 0,
    }
    const service = new TaskCommentService({ database })
    const comment = await service.addComment({
        projectId: selected.projectId,
        taskId: selected.taskId,
        commentId: `email_${identity.messageKey}`,
        comment: `${String(context.from || '').slice(0, 200)}${context.date ? ` (${String(context.date).slice(0, 80)})` : ''}: ${summary.plan.summary}`,
        actor: resolvedActor,
        fromAssistant: resolvedActor?.fromAssistant ?? fromAssistant,
        gmailData: emailData,
        linkEmail: true,
        emailContinuation: {
            projectIds,
            plan: {
                ...summary.plan,
                reopen: reopenOnNewEmail !== false,
                needsReply: needsReply === true,
                expected: {
                    name: selected.task.name,
                    dueDate: selected.task.dueDate,
                    priority: selected.task.priority,
                },
            },
        },
    })
    if (!comment.existing) {
        const { calculateGoldCostFromTokens } = require('../Assistant/assistantHelper')
        const { deductGold } = require('../Gold/goldHelper')
        const goldCost = calculateGoldCostFromTokens(summary.totalTokens, summary.modelKey)
        if (goldCost > 0) {
            const charged = await deductGold(userId, goldCost, {
                source: 'email_thread_continuation',
                projectId: selected.projectId,
                objectId: identity.messageId,
                channel: identity.provider,
                model: summary.modelKey,
            })
            if (charged?.success) result.goldCost = goldCost
            else console.warn('[emailThread] Continuation saved, Gold deduction failed', { taskId: selected.taskId })
        }
    }
    return {
        ...result,
        taskName: comment.taskName || result.taskName,
        updated: !comment.existing,
        commentId: comment.commentId,
    }
}

module.exports = { continueEmailThread }
