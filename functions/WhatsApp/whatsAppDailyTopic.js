const admin = require('firebase-admin')
const moment = require('moment')
const { v4: uuidv4 } = require('uuid')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')

/**
 * Get or create the daily WhatsApp topic for a user.
 * Uses the same BotChat format as in-app daily topics so messages appear together.
 *
 * @param {string} userId
 * @param {string} projectId - User's default project ID
 * @param {string} assistantId
 * @returns {Promise<{ chatId: string, isNew: boolean }>}
 */
async function getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId) {
    const today = moment().format('YYYYMMDD')
    const chatId = `BotChat${today}${userId}`
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)

    const chatDoc = await chatRef.get()
    if (chatDoc.exists) {
        return { chatId, isNew: false }
    }

    // Fetch user name for topic title
    const user = await getUserData(userId)
    const firstName = getFirstName(user?.displayName || 'User')
    const dateStr = moment().format('DD MMM YYYY')
    const title = `Daily Recap <> ${firstName} ${dateStr}`

    const now = Date.now()
    await chatRef.set({
        id: chatId,
        title,
        type: 'topics',
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        assistantId: assistantId || null,
        creatorId: userId,
        created: now,
        lastEditionDate: now,
        lastEditorId: userId,
        usersFollowing: [userId],
        members: [userId],
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: '',
            lastCommentType: '',
        },
    })

    return { chatId, isNew: true }
}

/**
 * Store a user message (from WhatsApp) in the daily topic.
 *
 * @param {string} projectId
 * @param {string} chatId
 * @param {string} userId
 * @param {string} messageText
 * @param {boolean} isVoice - Whether this was transcribed from a voice message
 * @returns {Promise<string>} commentId
 */
async function storeUserMessageInTopic(projectId, chatId, userId, messageText, isVoice = false) {
    const commentId = uuidv4()
    const now = Date.now()

    const comment = {
        commentText: messageText,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: userId,
        fromAssistant: false,
        source: 'whatsapp',
    }

    if (isVoice) {
        comment.isVoiceTranscription = true
    }

    const commentRef = admin.firestore().doc(`chatComments/${projectId}/topics/${chatId}/comments/${commentId}`)

    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)

    await Promise.all([
        commentRef.set(comment),
        chatRef.update({
            lastEditionDate: now,
            lastEditorId: userId,
            'commentsData.lastComment': messageText.substring(0, 200),
            'commentsData.lastCommentOwnerId': userId,
            'commentsData.lastCommentType': STAYWARD_COMMENT,
            'commentsData.amount': admin.firestore.FieldValue.increment(1),
        }),
    ])

    return commentId
}

/**
 * Store an assistant response in the daily topic.
 *
 * @param {string} projectId
 * @param {string} chatId
 * @param {string} assistantId
 * @param {string} responseText
 * @returns {Promise<string>} commentId
 */
async function storeAssistantMessageInTopic(projectId, chatId, assistantId, responseText) {
    const commentId = uuidv4()
    const now = Date.now()

    const comment = {
        commentText: responseText,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistantId,
        fromAssistant: true,
        source: 'whatsapp',
    }

    const commentRef = admin.firestore().doc(`chatComments/${projectId}/topics/${chatId}/comments/${commentId}`)

    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)

    await Promise.all([
        commentRef.set(comment),
        chatRef.update({
            lastEditionDate: now,
            lastEditorId: assistantId,
            'commentsData.lastComment': responseText.substring(0, 200),
            'commentsData.lastCommentOwnerId': assistantId,
            'commentsData.lastCommentType': STAYWARD_COMMENT,
            'commentsData.amount': admin.firestore.FieldValue.increment(1),
        }),
    ])

    return commentId
}

/**
 * Fetch recent conversation history from the daily topic for context.
 *
 * @param {string} projectId
 * @param {string} chatId
 * @param {number} limit - Max messages to fetch
 * @returns {Promise<Array<[string, string]>>} Array of [role, content] tuples
 */
async function getConversationHistory(projectId, chatId, limit = 10) {
    const snapshot = await admin
        .firestore()
        .collection(`chatComments/${projectId}/topics/${chatId}/comments`)
        .orderBy('created', 'desc')
        .limit(limit)
        .get()

    const messages = []
    snapshot.docs.reverse().forEach(doc => {
        const data = doc.data()
        if (data.commentText) {
            const role = data.fromAssistant ? 'assistant' : 'user'
            messages.push([role, data.commentText])
        }
    })

    return messages
}

function getFirstName(displayName) {
    if (!displayName) return 'User'
    return displayName.split(' ')[0]
}

module.exports = {
    getOrCreateWhatsAppDailyTopic,
    storeUserMessageInTopic,
    storeAssistantMessageInTopic,
    getConversationHistory,
}
