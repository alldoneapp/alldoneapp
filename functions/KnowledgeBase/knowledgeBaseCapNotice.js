'use strict'

// Tells the payer of a project wiki, in the app, that the wiki stopped at its monthly Gold limit.
//
// Until this, the only trace of the cap was `lastRunStopReason: 'monthly_cap'` on the wiki document
// and a "spent" line deep in the wiki settings. A wiki whose first build ran into the limit simply
// stood still until the first of next month, and nothing said so (two production wikis did exactly
// that on the day the default switch-on shipped).
//
// The project's assistant opens a topic of its own in the wiki's project, private to the payer,
// with a link to the wiki settings, where raising the limit resumes the wiki at once
// (knowledgeBaseSettings.js). The message is fixed text, not a model answer: a notice that the Gold
// ran out must not spend Gold.
//
// Once per wiki, month and limit: the topic id is derived from the month and the comment id from the
// month and the limit, so a retried run or a second run stopping at the same limit adds nothing,
// while a raised limit that is reached again in the same month is reported in the same topic.

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const NOTICE_TEXTS = {
    en: {
        locale: 'en-US',
        title: ({ month }) => `Project wiki paused: Gold limit reached (${month})`,
        body: ({ project, spent, cap, date, url }) =>
            `⚠️ The project wiki of "${project}" reached its monthly Gold limit (${spent} of ${cap} Gold) ` +
            `and is paused until ${date}. Until then it takes in no changes from the project. ` +
            `Raise the limit in the wiki settings and it continues right away: ${url}`,
    },
    de: {
        locale: 'de-DE',
        title: ({ month }) => `Projekt-Wiki pausiert: Gold-Limit erreicht (${month})`,
        body: ({ project, spent, cap, date, url }) =>
            `⚠️ Das Projekt-Wiki von „${project}“ hat sein monatliches Gold-Limit erreicht ` +
            `(${spent} von ${cap} Gold) und pausiert bis zum ${date}. Bis dahin übernimmt es keine ` +
            `Änderungen aus dem Projekt. Wenn du das Limit in den Wiki-Einstellungen anhebst, ` +
            `läuft es sofort weiter: ${url}`,
    },
    es: {
        locale: 'es-ES',
        title: ({ month }) => `Wiki del proyecto en pausa: límite de Gold alcanzado (${month})`,
        body: ({ project, spent, cap, date, url }) =>
            `⚠️ La wiki del proyecto «${project}» alcanzó su límite mensual de Gold (${spent} de ${cap} Gold) ` +
            `y está en pausa hasta el ${date}. Hasta entonces no incorpora cambios del proyecto. ` +
            `Si subes el límite en los ajustes de la wiki, continúa de inmediato: ${url}`,
    },
}

// User documents carry both short codes ('de') and names ('German'); anything else reads English.
function resolveNoticeLanguage(language) {
    const value = String(language || '')
        .trim()
        .toLowerCase()
    if (value.startsWith('de') || value === 'german') return 'de'
    if (value.startsWith('es') || value === 'spanish') return 'es'
    return 'en'
}

function buildCapNoticeChatId(projectId, month) {
    return `WikiGoldCap_${projectId}_${month}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

function buildCapNoticeCommentId(month, goldCap) {
    return `wiki-gold-cap-${month}-${goldCap}`
}

function getWikiSettingsUrl(baseUrl, projectId) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/project/${projectId}/wiki-settings`
}

function formatUtc(timestamp, locale, options) {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(timestamp))
}

function buildCapNotice({ language, projectName, month, spent, goldCap, resumesAt, settingsUrl }) {
    const texts = NOTICE_TEXTS[resolveNoticeLanguage(language)]
    const monthLabel = formatUtc(Date.parse(`${month}-01T00:00:00Z`), texts.locale, {
        month: 'long',
        year: 'numeric',
    })
    return {
        title: texts.title({ month: monthLabel }),
        text: texts.body({
            project: projectName,
            spent: Math.round(spent),
            cap: goldCap,
            date: formatUtc(resumesAt, texts.locale, { day: 'numeric', month: 'long', year: 'numeric' }),
            url: settingsUrl,
        }),
    }
}

async function ensureNoticeTopic({ db, fieldValue, projectId, chatId, ownerUserId, assistantId, title, now }) {
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const existing = await chatRef.get()
    if (existing.exists) return

    await chatRef.set({
        id: chatId,
        title,
        type: 'topics',
        // Private to the payer: it is about their Gold.
        isPublicFor: [ownerUserId],
        assistantId,
        creatorId: ownerUserId,
        created: now,
        lastEditionDate: now,
        lastEditorId: ownerUserId,
        usersFollowing: [ownerUserId],
        members: [ownerUserId],
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        commentsData: { amount: 0, lastComment: '', lastCommentOwnerId: '', lastCommentType: '' },
        // A reply ("raise it to 1000") reaches the assistant like in any other topic.
        isAssistantEnabled: true,
    })
    // Follower documents, so the topic is in the payer's followed chats and navigable.
    await Promise.all([
        db
            .doc(`usersFollowing/${projectId}/entries/${ownerUserId}`)
            .set({ topics: { [chatId]: true } }, { merge: true }),
        db
            .doc(`followers/${projectId}/topics/${chatId}`)
            .set({ usersFollowing: fieldValue.arrayUnion(ownerUserId) }, { merge: true }),
    ])
}

// Never throws: the run that calls it has already stopped and recorded why; a notice that cannot be
// posted is logged and tried again by the next run that stops at the limit.
async function notifyKnowledgeBaseCapReached({
    projectId,
    ownerUserId,
    ownerData = {},
    month,
    spent,
    goldCap,
    resumesAt,
    db = admin.firestore(),
    fieldValue = FieldValue,
    now = Date.now(),
    resolveAssistantId = (userData, id) =>
        require('../shared/projectRoutingCommentHelper').getDefaultAssistantIdForProject(userData, id),
    storeAssistantMessageInTopicOnce = require('../WhatsApp/whatsAppDailyTopic').storeAssistantMessageInTopicOnce,
    getBaseUrl = require('../Utils/HelperFunctionsCloud').getBaseUrl,
}) {
    try {
        if (!projectId || !ownerUserId || !month) return { notified: false, reason: 'missing_context' }

        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        const project = (projectSnapshot.exists && projectSnapshot.data()) || null
        const userIds = Array.isArray(project?.userIds) ? project.userIds : []
        if (!userIds.includes(ownerUserId)) return { notified: false, reason: 'owner_not_member' }

        // The project's assistant, else the payer's own default (stored as `assistantId` on the user
        // document, `defaultAssistantId` on older ones), else any assistant of the project.
        const assistantId = await resolveAssistantId(
            { ...ownerData, defaultAssistantId: ownerData.defaultAssistantId || ownerData.assistantId },
            projectId
        )
        if (!assistantId) return { notified: false, reason: 'no_assistant' }

        const chatId = buildCapNoticeChatId(projectId, month)
        const commentId = buildCapNoticeCommentId(month, goldCap)
        const notice = buildCapNotice({
            language: ownerData.language,
            projectName: project.name || projectId,
            month,
            spent,
            goldCap,
            resumesAt,
            settingsUrl: getWikiSettingsUrl(getBaseUrl(), projectId),
        })

        await ensureNoticeTopic({
            db,
            fieldValue,
            projectId,
            chatId,
            ownerUserId,
            assistantId,
            title: notice.title,
            now,
        })
        const { stored } = await storeAssistantMessageInTopicOnce({
            projectId,
            chatId,
            assistantId,
            responseText: notice.text,
            commentId,
            userId: ownerUserId,
            updateAssistantLine: true,
            extraCommentFields: {
                source: 'knowledge_base',
                isSystemNotice: true,
                knowledgeBaseNotice: 'monthly_cap',
                month,
            },
        })
        if (!stored) return { notified: false, reason: 'already_notified', chatId }

        // The unread badge is its own document; without it the message arrives looking read.
        await db.doc(`chatNotifications/${projectId}/${ownerUserId}/${commentId}`).set({
            chatId,
            chatType: 'topics',
            followed: true,
            date: now,
            creatorId: assistantId,
            creatorType: 'assistant',
        })
        return { notified: true, chatId }
    } catch (error) {
        console.error('[knowledge base] Could not post the monthly cap notice', {
            projectId,
            ownerUserId,
            error: error?.message || String(error),
        })
        return { notified: false, reason: 'failed' }
    }
}

module.exports = {
    notifyKnowledgeBaseCapReached,
    __private__: {
        buildCapNotice,
        buildCapNoticeChatId,
        buildCapNoticeCommentId,
        getWikiSettingsUrl,
        resolveNoticeLanguage,
    },
}
