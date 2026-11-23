'use strict'

// AT-3135: email follow-up tasks of one source and one handling context are collected in one
// to-do ("Kleinanzeigen: Layla möchte ein Foto der Wickelkommode") instead of one task per email.
//
// Who decides what belongs together (decided with Karsten 2026-11-23):
// - The post-label assistant proposes a handling context (`emailBundle: { key, label }` on
//   create_task) for recurring mail of one platform/sender that is handled the same way. It is told
//   which collection to-dos already exist for the sender, so it reuses their key.
// - The server decides the identity: owner + provider + mailbox + the sender's registrable domain
//   (from the From header, never from the model) + the key. A model cannot put mail of another
//   sender domain or another mailbox into a collection to-do.
// - Separately urgent mail is not bundled: a task with its own deadline or reminder is created on
//   its own (`shouldBundleCreateTask`).
//
// Lifecycle: the collection to-do stays in the project where it was created, even when a later
// email is routed elsewhere (sticky, like thread tasks). It is private to the mailbox owner and
// carries no reply data (it is a normal to-do, not one conversation in Messages). Once done, the
// next actionable email of the same context reopens it. Deleting it starts a new one.
//
// Every email becomes one line at the end of the description, with its Gmail link, and one comment
// in the task chat. The title is "<label>: <current state>" while the user has not renamed it.
// Processing the same email again changes nothing (message pointer, messageIds, comment id).

const { hashParts, matchesEmailAccount } = require('./emailThreadIdentity')
const { canAccessObject } = require('../shared/privacyAccess')

const EMAIL_BUNDLE_KEY_MAX_LENGTH = 60
const EMAIL_BUNDLE_LABEL_MAX_LENGTH = 60
const EMAIL_BUNDLE_ITEM_MAX_LENGTH = 300
const EMAIL_BUNDLE_LIST_LIMIT = 10
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'or', 'ne', 'go'])

function normalizeText(value, maxLength) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text
}

// "Kleinanzeigen <noreply@mail.kleinanzeigen.de>" and "noreply@kleinanzeigen.de" are one source.
function getEmailSenderDomain(from = '') {
    const { parseEmailHeaderAddresses } = require('./emailChannelHelpers')
    const raw = String(from || '').trim()
    const address = (parseEmailHeaderAddresses(raw)[0]?.email || raw).trim().toLowerCase()
    const match = address.match(/@([a-z0-9.-]+\.[a-z0-9-]{2,})$/)
    if (!match) return ''
    const labels = match[1].split('.').filter(Boolean)
    if (labels.length < 2) return ''
    const keep =
        labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL_SUFFIXES.has(labels.at(-2)) ? 3 : 2
    return labels.slice(-keep).join('.')
}

function normalizeEmailBundleProposal(raw) {
    if (!raw || typeof raw !== 'object') return null
    const key = String(raw.key || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, EMAIL_BUNDLE_KEY_MAX_LENGTH)
        .replace(/-+$/g, '')
    const label = normalizeText(raw.label, EMAIL_BUNDLE_LABEL_MAX_LENGTH).replace(/[\s:]+$/g, '')
    if (key.length < 2 || !label) return null
    return { key, label }
}

function getEmailBundleRef(database, ownerId, bundleId) {
    return database.doc(`users/${ownerId}/emailTaskBundles/${bundleId}`)
}

// identity: getEmailIdentity of the email. Returns null when the email cannot be bundled.
function resolveEmailBundle({ identity, from, proposal }) {
    const normalized = normalizeEmailBundleProposal(proposal)
    const senderDomain = getEmailSenderDomain(from)
    if (!identity || !normalized || !senderDomain) return null
    const id = hashParts(['bundle', identity.ownerId, identity.provider, identity.email, senderDomain, normalized.key])
    return {
        id,
        key: normalized.key,
        label: normalized.label,
        senderDomain,
        registry: {
            key: normalized.key,
            label: normalized.label,
            senderDomain,
            gmailEmail: identity.email,
            provider: identity.provider,
            createdAt: Date.now(),
        },
    }
}

// The collection to-do a new email of this context goes to: open or done (it is reopened), in the
// project it was created in. null when it was deleted, moved out of reach, or is no longer the
// owner's own private to-do, so the next email starts a new one: once the user shares it or hands
// it to someone else, future conversations (unlike the ones already in it) must not follow.
function isOwnerPrivateTask(task, ownerId) {
    const isPublicFor = Array.isArray(task?.isPublicFor) ? task.isPublicFor : []
    return task?.userId === ownerId && isPublicFor.length > 0 && isPublicFor.every(id => id === ownerId)
}

async function findLiveEmailBundleTask({ database, identity, bundleId, projectIds, transaction = null }) {
    if (!identity || !bundleId) return null
    const read = ref => (transaction ? transaction.get(ref) : ref.get())
    const registrySnapshot = await read(getEmailBundleRef(database, identity.ownerId, bundleId))
    const registry = registrySnapshot.exists ? registrySnapshot.data() || {} : null
    if (!registry?.projectId || !registry?.taskId || !(projectIds || []).includes(registry.projectId)) return null
    const taskSnapshot = await read(database.doc(`items/${registry.projectId}/tasks/${registry.taskId}`))
    const task = taskSnapshot.exists ? taskSnapshot.data() || null : null
    if (
        !task ||
        task.gmailData?.bundle?.id !== bundleId ||
        !matchesEmailAccount(task.gmailData, identity) ||
        !canAccessObject(task, identity.ownerId) ||
        !isOwnerPrivateTask(task, identity.ownerId)
    )
        return null
    return { taskId: registry.taskId, projectId: registry.projectId, task, registry }
}

// Shown to the post-label assistant so the same context keeps the same key. Only this mailbox's
// collection to-dos of this sender domain; never task content.
async function listEmailBundlesForSender({ database, identity, from }) {
    const senderDomain = getEmailSenderDomain(from)
    if (!identity || !senderDomain) return []
    const snapshot = await database
        .collection(`users/${identity.ownerId}/emailTaskBundles`)
        .where('senderDomain', '==', senderDomain)
        .limit(EMAIL_BUNDLE_LIST_LIMIT * 2)
        .get()
    return snapshot.docs
        .map(doc => doc.data() || {})
        .filter(data => data.gmailEmail === identity.email && data.key && data.label)
        .slice(0, EMAIL_BUNDLE_LIST_LIMIT)
        .map(data => ({ key: data.key, label: data.label }))
}

function buildEmailBundleTitle(label, state) {
    const { abbreviateTaskName } = require('../shared/TaskValidator')
    const text = normalizeText(state, EMAIL_BUNDLE_ITEM_MAX_LENGTH)
    const prefix = `${label}:`
    return abbreviateTaskName(text.toLowerCase().startsWith(prefix.toLowerCase()) ? text : `${prefix} ${text}`)
}

function buildEmailBundleItemLine({ text, webUrl = '' }) {
    const item = normalizeText(text, EMAIL_BUNDLE_ITEM_MAX_LENGTH)
    return `- ${item}${webUrl ? ` ${webUrl}` : ''}`
}

// A task with its own deadline or reminder is separately urgent and keeps its own to-do.
function shouldBundleCreateTask(toolArgs = {}) {
    return !toolArgs.dueDate && toolArgs.alertEnabled !== true
}

// plan: { actionable, itemText, state }. Informational mail is only a comment: no line, no title,
// no reopening. Description lines are only ever appended; the title changes only while it still
// is the one the automation wrote last (gmailData.taskContent.name).
function buildEmailBundleTaskUpdate(task, plan, gmailData, actorId, now) {
    const taskGmailData = task.gmailData || {}
    const bundle = taskGmailData.bundle || {}
    const baseline = taskGmailData.taskContent || {}
    const nextBaseline = { ...baseline }
    const update = {}
    const newer = gmailData.receivedAt
        ? gmailData.receivedAt >= (taskGmailData.lastEmailReceivedAt || 0)
        : !taskGmailData.lastEmailReceivedAt
    const actionable = plan.actionable === true
    if (actionable && plan.itemText) {
        const line = buildEmailBundleItemLine({ text: plan.itemText, webUrl: gmailData.webUrl })
        const description = task.description || ''
        update.description = description ? `${description}\n${line}` : line
        if (description === (baseline.description || '')) nextBaseline.description = update.description
    }
    if (actionable && newer && plan.state && bundle.label) {
        const title = buildEmailBundleTitle(bundle.label, plan.state)
        const untouched =
            Object.hasOwn(baseline, 'name') &&
            task.name === baseline.name &&
            (!task.extendedName || task.extendedName === task.name)
        if (untouched && title && title !== task.name) {
            update.name = title
            update.extendedName = title
            nextBaseline.name = title
        }
    }
    const rejectedSuggestion =
        task.suggestedBy &&
        task.userId === task.suggestedBy &&
        (task.assistantId === task.suggestedBy ||
            task.taskMetadata?.assistantSuggestion?.assistantId === task.suggestedBy)
    if (actionable && (task.inDone || task.done) && !rejectedSuggestion) {
        Object.assign(update, {
            done: false,
            inDone: false,
            completed: null,
            completedDate: null,
            completedTime: null,
            currentReviewerId: task.userId || 'Open',
        })
    }
    const threadIds = [
        ...new Set(
            [...(taskGmailData.threadIds || []), taskGmailData.threadId, gmailData.threadId].filter(
                value => typeof value === 'string' && value
            )
        ),
    ]
    return {
        ...update,
        lastEditionDate: now,
        lastEditorId: actorId,
        gmailData: {
            ...taskGmailData,
            threadIds,
            taskContent: nextBaseline,
            lastEmailReceivedAt: Math.max(taskGmailData.lastEmailReceivedAt || 0, gmailData.receivedAt || 0),
            bundle: {
                ...bundle,
                itemCount: (Number(bundle.itemCount) || 0) + (actionable && plan.itemText ? 1 : 0),
                lastItemAt: actionable ? now : bundle.lastItemAt || null,
            },
        },
    }
}

function buildBundleCommentText(context = {}, text = '') {
    const from = String(context.from || '').slice(0, 200)
    const date = context.date ? ` (${String(context.date).slice(0, 80)})` : ''
    const body = normalizeText(text, 1000) || normalizeText(context.subject, 300) || 'Email received'
    return from ? `${from}${date}: ${body}` : body
}

// Adds one email to a collection to-do. `via`: 'bundle' (a new thread joins the collection to-do
// its context points to) or 'thread' (a later email of a thread already in it). The selection is
// checked again inside the transaction.
async function appendEmailToBundleTask({
    database,
    userId,
    projectIds,
    selected,
    bundleId,
    via = 'bundle',
    gmailData,
    context = {},
    itemText = '',
    state = '',
    commentText = '',
    actionable = true,
    actor,
    fromAssistant = false,
}) {
    const { TaskCommentService } = require('../shared/TaskCommentService')
    const { getEmailIdentity } = require('./emailThreadIdentity')
    const identity = getEmailIdentity(userId, gmailData)
    if (!identity) throw new Error('A proven email account and message identity are required')
    const service = new TaskCommentService({ database })
    const comment = await service.addComment({
        projectId: selected.projectId,
        taskId: selected.taskId,
        commentId: `email_${identity.messageKey}`,
        comment: buildBundleCommentText(context, commentText || itemText),
        actor,
        fromAssistant: actor?.fromAssistant ?? fromAssistant,
        gmailData: {
            ...gmailData,
            origin: selected.task?.gmailData?.origin || gmailData.origin || 'gmail_label_follow_up',
            accountUserId: userId,
            taskProjectId: selected.projectId,
            receivedAt: Number(context.internalDate) || Date.parse(context.date) || 0,
        },
        linkEmail: true,
        // Informational mail of a thread in the collection to-do is a comment nobody has to act on.
        silent: !actionable,
        emailBundle: {
            id: bundleId,
            via,
            projectIds,
            plan: { actionable: actionable === true, itemText, state },
        },
    })
    return {
        taskId: selected.taskId,
        projectId: selected.projectId,
        taskName: comment.taskName || selected.task?.name || '',
        existing: true,
        bundled: true,
        updated: !comment.existing,
        commentId: comment.commentId,
    }
}

module.exports = {
    appendEmailToBundleTask,
    buildEmailBundleItemLine,
    buildEmailBundleTaskUpdate,
    buildEmailBundleTitle,
    findLiveEmailBundleTask,
    getEmailBundleRef,
    getEmailSenderDomain,
    isOwnerPrivateTask,
    listEmailBundlesForSender,
    normalizeEmailBundleProposal,
    resolveEmailBundle,
    shouldBundleCreateTask,
}
