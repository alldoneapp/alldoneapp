const crypto = require('crypto')
const admin = require('firebase-admin')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')

function getTranscriptCommentId(sessionId, turnId, role) {
    return crypto.createHash('sha256').update(`${sessionId}:${turnId}:${role}`).digest('hex').slice(0, 40)
}

async function getCallTranscriptTurn({ sessionId, turnId, role, projectId, chatId }) {
    const commentId = getTranscriptCommentId(sessionId, turnId, role)
    const doc = await admin.firestore().doc(`chatComments/${projectId}/topics/${chatId}/comments/${commentId}`).get()
    if (!doc.exists) return null

    const data = doc.data() || {}
    return {
        role: data.fromAssistant ? 'assistant' : 'user',
        text: String(data.commentText || '').trim(),
    }
}

// Mirror storeAssistantMessageInTopic: point the user's AssistantLine "Last comment" bubble at this
// thread whenever the assistant speaks. The chat-doc commentsData update only feeds the Chats-list
// preview; the MyDay AssistantLine reads lastAssistantCommentData on the user doc instead.
async function updateLastAssistantCommentData({ projectId, chatId, assistantId, userId, date }) {
    const updateData = {
        objectType: 'topics',
        objectId: chatId,
        creatorId: assistantId,
        creatorType: 'user',
        date,
    }
    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({
            [`lastAssistantCommentData.${projectId}`]: updateData,
            ['lastAssistantCommentData.allProjects']: {
                ...updateData,
                projectId,
            },
        })
}

async function storeCallTranscriptTurn({
    sessionId,
    turnId,
    role,
    text,
    projectId,
    chatId,
    userId,
    assistantId,
    source = 'whatsapp_call',
}) {
    const normalizedText = String(text || '').trim()
    if (!normalizedText) return { stored: false, reason: 'empty' }

    const commentId = getTranscriptCommentId(sessionId, turnId, role)
    const commentRef = admin.firestore().doc(`chatComments/${projectId}/topics/${chatId}/comments/${commentId}`)
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)
    const sessionRef = admin.firestore().doc(`whatsAppCallSessions/${sessionId}`)
    const creatorId = role === 'assistant' ? assistantId : userId
    const now = Date.now()
    let stored = false

    await admin.firestore().runTransaction(async transaction => {
        const existing = await transaction.get(commentRef)
        if (existing.exists) return

        transaction.set(commentRef, {
            commentText: normalizedText,
            lastChangeDate: admin.firestore.Timestamp.now(),
            created: now,
            creatorId,
            fromAssistant: role === 'assistant',
            source,
            callSessionId: sessionId,
            realtimeTurnId: String(turnId || ''),
            isCallTranscript: true,
        })
        transaction.update(chatRef, {
            lastEditionDate: now,
            lastEditorId: creatorId,
            'commentsData.lastComment': normalizedText.substring(0, 200),
            'commentsData.lastCommentOwnerId': creatorId,
            'commentsData.lastCommentType': STAYWARD_COMMENT,
            'commentsData.amount': admin.firestore.FieldValue.increment(1),
        })
        transaction.set(
            sessionRef,
            {
                transcriptTurnCount: admin.firestore.FieldValue.increment(1),
                updatedAt: now,
            },
            { merge: true }
        )
        stored = true
    })

    // Only on a newly stored assistant turn (recap or spoken reply), so idempotent retries and the
    // caller's own turns don't move the AssistantLine pointer. Best-effort: never fail the transcript
    // write if the user-doc update fails.
    if (stored && role === 'assistant' && userId) {
        await updateLastAssistantCommentData({ projectId, chatId, assistantId, userId, date: now }).catch(error => {
            console.warn('WhatsApp Call: Failed to update lastAssistantCommentData', {
                error: error?.message || String(error),
            })
        })
    }

    return { stored, commentId }
}

async function getCallTranscript(session) {
    const snapshot = await admin
        .firestore()
        .collection(`chatComments/${session.projectId}/topics/${session.chatId}/comments`)
        .where('callSessionId', '==', session.id)
        .get()

    return snapshot.docs
        .map(doc => doc.data() || {})
        .filter(item => item.commentText)
        .sort((left, right) => Number(left.created || 0) - Number(right.created || 0))
        .map(item => ({
            role: item.fromAssistant ? 'assistant' : 'user',
            text: item.commentText,
        }))
}

module.exports = {
    getCallTranscript,
    getCallTranscriptTurn,
    getTranscriptCommentId,
    storeCallTranscriptTurn,
}
