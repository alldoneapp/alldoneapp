'use strict'

// Tells a user, in the app, that one of their scheduled assistant tasks did not run because
// somebody changed what it does since they approved it (security audit 2026-11, NEW-A).
//
// Same shape as the wiki's Gold-cap notice (KnowledgeBase/knowledgeBaseCapNotice.js): a topic of
// its own, private to the user, opened by an assistant of the project, with fixed text (a notice
// must not spend Gold) and an unread badge. The comment id carries the content hash, so a user is
// told once per change, and the task document remembers the hash it was told about
// (`contentApprovalNoticeByUser`), so the five-minute scheduler does not re-read the topic on every
// tick while the task waits for the user.

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const { CONTENT_APPROVAL_NOTICE_FIELD } = require('./assistantTaskContentHash')

const NOTICE_TEXTS = {
    en: {
        title: ({ task }) => `Scheduled task paused: "${task}" was changed`,
        body: ({ task, url }) =>
            `⚠️ Your scheduled assistant task "${task}" was changed by someone since you switched it on ` +
            `(prompt, system instruction, model or settings). It runs with your Gold, tools and ` +
            `connected accounts, so it is paused for you until you review it. Open the task, check what ` +
            `it does and save or switch it on again to confirm: ${url}`,
    },
    de: {
        title: ({ task }) => `Geplanter Task pausiert: „${task}“ wurde geändert`,
        body: ({ task, url }) =>
            `⚠️ Dein geplanter Assistenten-Task „${task}“ wurde seit deiner Aktivierung von jemandem ` +
            `geändert (Prompt, Systemanweisung, Modell oder Einstellungen). Er läuft mit deinem Gold, ` +
            `deinen Tools und verbundenen Konten und ist für dich pausiert, bis du ihn prüfst. Öffne den ` +
            `Task, prüfe, was er tut, und speichere oder aktiviere ihn erneut, um ihn zu bestätigen: ${url}`,
    },
    es: {
        title: ({ task }) => `Tarea programada en pausa: «${task}» fue modificada`,
        body: ({ task, url }) =>
            `⚠️ Alguien modificó tu tarea programada del asistente «${task}» desde que la activaste ` +
            `(prompt, instrucción del sistema, modelo o ajustes). Se ejecuta con tu Gold, tus herramientas ` +
            `y tus cuentas conectadas, así que está en pausa para ti hasta que la revises. Abre la tarea, ` +
            `comprueba lo que hace y guárdala o actívala de nuevo para confirmarla: ${url}`,
    },
}

function resolveNoticeLanguage(language) {
    const value = String(language || '')
        .trim()
        .toLowerCase()
    if (value.startsWith('de') || value === 'german') return 'de'
    if (value.startsWith('es') || value === 'spanish') return 'es'
    return 'en'
}

const buildNoticeChatId = (taskId, userId) =>
    `AssistantTaskApproval_${taskId}_${userId}`.replace(/[^A-Za-z0-9_-]/g, '_')
const buildNoticeCommentId = hash => `assistant-task-approval-${String(hash).slice(0, 32)}`
const getTaskSettingsUrl = (baseUrl, projectId, assistantId) =>
    `${String(baseUrl || '').replace(/\/+$/, '')}/projects/${projectId}/assistants/${assistantId}/customizations`

function buildNotice({ language, taskName, url }) {
    const texts = NOTICE_TEXTS[resolveNoticeLanguage(language)]
    const task = String(taskName || '').slice(0, 120) || 'Assistant task'
    return { title: texts.title({ task }), text: texts.body({ task, url }) }
}

// Never throws: the run is already skipped, a notice that cannot be posted is retried next tick.
async function notifyAssistantTaskNeedsApproval({
    taskRef,
    task,
    taskProjectId,
    assistantId,
    userId,
    userData = {},
    noticeProjectId,
    hash,
    db = admin.firestore(),
    now = Date.now(),
    resolveAssistantId = (data, projectId) =>
        require('../shared/projectRoutingCommentHelper').getDefaultAssistantIdForProject(data, projectId),
    storeAssistantMessageInTopicOnce = require('../WhatsApp/whatsAppDailyTopic').storeAssistantMessageInTopicOnce,
    getBaseUrl = require('../Utils/HelperFunctionsCloud').getBaseUrl,
}) {
    try {
        if (task?.[CONTENT_APPROVAL_NOTICE_FIELD]?.[userId] === hash)
            return { notified: false, reason: 'already_notified' }
        const projectId = noticeProjectId || taskProjectId
        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        const members = projectSnapshot.exists ? projectSnapshot.data()?.userIds : null
        if (!Array.isArray(members) || !members.includes(userId)) return { notified: false, reason: 'not_member' }

        const topicAssistantId =
            projectId === taskProjectId
                ? assistantId
                : await resolveAssistantId(
                      { ...userData, defaultAssistantId: userData.defaultAssistantId || userData.assistantId },
                      projectId
                  )
        if (!topicAssistantId) return { notified: false, reason: 'no_assistant' }

        const notice = buildNotice({
            language: userData.language,
            taskName: task?.name,
            url: getTaskSettingsUrl(getBaseUrl(), taskProjectId, assistantId),
        })
        const chatId = buildNoticeChatId(task?.id || taskRef.id, userId)
        const commentId = buildNoticeCommentId(hash)
        const chatRef = db.doc(`chatObjects/${projectId}/chats/${chatId}`)
        if (!(await chatRef.get()).exists) {
            await chatRef.set({
                id: chatId,
                title: notice.title,
                type: 'topics',
                isPublicFor: [userId],
                assistantId: topicAssistantId,
                creatorId: userId,
                created: now,
                lastEditionDate: now,
                lastEditorId: userId,
                usersFollowing: [userId],
                members: [userId],
                hasStar: '#ffffff',
                stickyData: { days: 0, stickyEndDate: 0 },
                commentsData: { amount: 0, lastComment: '', lastCommentOwnerId: '', lastCommentType: '' },
                isAssistantEnabled: false,
            })
            await Promise.all([
                db
                    .doc(`usersFollowing/${projectId}/entries/${userId}`)
                    .set({ topics: { [chatId]: true } }, { merge: true }),
                db
                    .doc(`followers/${projectId}/topics/${chatId}`)
                    .set({ usersFollowing: FieldValue.arrayUnion(userId) }, { merge: true }),
            ])
        }
        const { stored } = await storeAssistantMessageInTopicOnce({
            projectId,
            chatId,
            assistantId: topicAssistantId,
            responseText: notice.text,
            commentId,
            userId,
            updateAssistantLine: true,
            extraCommentFields: { isSystemNotice: true, assistantTaskApprovalNotice: true },
        })
        if (stored) {
            await db.doc(`chatNotifications/${projectId}/${userId}/${commentId}`).set({
                chatId,
                chatType: 'topics',
                followed: true,
                date: now,
                creatorId: topicAssistantId,
                creatorType: 'assistant',
            })
        }
        await taskRef.update({ [`${CONTENT_APPROVAL_NOTICE_FIELD}.${userId}`]: hash })
        return { notified: stored, chatId }
    } catch (error) {
        console.error('[assistant task approval] Could not post the notice', {
            taskId: task?.id,
            userId,
            error: error?.message || String(error),
        })
        return { notified: false, reason: 'failed' }
    }
}

module.exports = {
    notifyAssistantTaskNeedsApproval,
    __private__: { buildNotice, buildNoticeChatId, buildNoticeCommentId, getTaskSettingsUrl, resolveNoticeLanguage },
}
