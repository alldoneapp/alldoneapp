'use strict'

const { getEmailIdentity } = require('./emailThreadIdentity')
const { resolveEmailThreadTask } = require('./emailThreadTaskStore')
const { getAccessibleProjectIdsFromUserData } = require('../shared/privacyAccess')
const { TaskCommentService } = require('../shared/TaskCommentService')

async function continueEmailThread({ database, userId, userData, gmailData, context, actor, fromAssistant = false }) {
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
