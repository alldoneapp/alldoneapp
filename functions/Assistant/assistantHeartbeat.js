const admin = require('firebase-admin')
const moment = require('moment')
const { generatePreConfigTaskResult } = require('./assistantPreConfigTaskTopic')
const { getOpenTasksContextMessage, parseTextForUseLiKePrompt } = require('./assistantHelper')
const {
    addTimestampToContextContent,
    resolveUserTimezoneOffset,
    getUserLocalDateContext,
} = require('./contextTimestampHelper')
const {
    DEFAULT_AWAKE_START,
    DEFAULT_AWAKE_END,
    DEFAULT_PROMPT,
    HEARTBEAT_OK_MARKER,
    normalizeHeartbeatIntervalMs,
    normalizeHeartbeatTimeMs,
    getEffectiveHeartbeatChancePercent,
    getEffectiveHeartbeatSendWhatsApp,
} = require('./heartbeatSettingsHelper')
const { THREAD_CONTEXT_MESSAGE_LIMIT } = require('./contextLimits')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { getFirstName } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')

/**
 * Fetch recent conversation history from a topic for context.
 *
 * @param {string} projectId
 * @param {string} chatId
 * @param {number} limit - Max messages to fetch
 * @returns {Promise<Array<[string, string]>>} Array of [role, content] tuples
 */
async function getTopicConversationHistory(
    projectId,
    chatId,
    limit = THREAD_CONTEXT_MESSAGE_LIMIT,
    userTimezoneOffset = null
) {
    try {
        const snapshot = await admin
            .firestore()
            .collection(`chatComments/${projectId}/topics/${chatId}/comments`)
            .orderBy('created', 'desc')
            .limit(limit)
            .get()

        const messages = []
        for (const doc of snapshot.docs.reverse()) {
            const data = doc.data()
            if (data.commentText) {
                const role = data.fromAssistant ? 'assistant' : 'user'
                messages.push([
                    role,
                    addTimestampToContextContent(
                        data.commentText,
                        Number(data.created || data.lastChangeDate || 0),
                        userTimezoneOffset
                    ),
                ])
            }
        }
        return messages
    } catch (error) {
        console.warn('Heartbeat: Failed to fetch conversation history:', {
            projectId,
            chatId,
            error: error.message,
        })
        return []
    }
}

async function getTopicTitle(projectId, chatId) {
    try {
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
        if (!chatDoc.exists) return null

        const title = chatDoc.data()?.title
        return typeof title === 'string' && title.trim() ? title : null
    } catch (error) {
        console.warn('Heartbeat: Failed to fetch topic title:', {
            projectId,
            chatId,
            error: error.message,
        })
        return null
    }
}

/**
 * Get or create a dedicated heartbeat topic for a user.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} assistantId
 * @param {Object|null} userData
 * @returns {Promise<{ chatId: string, isNew: boolean }>}
 */
async function getOrCreateHeartbeatTopic(userId, projectId, assistantId, userData = null) {
    const user = userData || (await getUserData(userId))
    const { dateKey, dateLabel } = getUserLocalDateContext(user)
    const today = dateKey
    const chatId = `Heartbeat${today}${userId}`
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)

    const chatDoc = await chatRef.get()
    if (chatDoc.exists) {
        const data = chatDoc.data()
        const patchData = {}

        if (!data.stickyData || data.stickyData.days === undefined) {
            patchData.stickyData = { days: 0, stickyEndDate: 0 }
            patchData.hasStar = data.hasStar || '#ffffff'
        }

        if (data.isAssistantEnabled !== true) {
            patchData.isAssistantEnabled = true
        }

        if (Object.keys(patchData).length > 0) {
            await chatRef.update(patchData)
        }
        return { chatId, isNew: false }
    }

    const firstName = getFirstName(user?.displayName || 'User')
    const title = `Heartbeat <> ${firstName} ${dateLabel}`

    const now = Date.now()
    const chatData = {
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
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: '',
            lastCommentType: '',
        },
        isAssistantEnabled: true,
    }

    await chatRef.set(chatData)

    // Create follower documents so the topic is navigable in the UI
    const userFollowingRef = admin.firestore().doc(`usersFollowing/${projectId}/entries/${userId}`)
    const followersRef = admin.firestore().doc(`followers/${projectId}/topics/${chatId}`)

    await Promise.all([
        userFollowingRef.set({ topics: { [chatId]: true } }, { merge: true }),
        followersRef.set({ usersFollowing: admin.firestore.FieldValue.arrayUnion(userId) }, { merge: true }),
    ])

    return { chatId, isNew: true }
}

/**
 * Check if current time is within the assistant's awake window for a given timezone.
 */
function isWithinAwakeWindow(assistant, timezoneOffsetMinutes) {
    const now = moment.utc().utcOffset(timezoneOffsetMinutes)
    const currentMs = (now.hours() * 60 + now.minutes()) * 60 * 1000
    const start = normalizeHeartbeatTimeMs(assistant.heartbeatAwakeStart, DEFAULT_AWAKE_START)
    const end = normalizeHeartbeatTimeMs(assistant.heartbeatAwakeEnd, DEFAULT_AWAKE_END)

    if (start <= end) {
        return currentMs >= start && currentMs <= end
    }
    // Overnight window (e.g., 10 PM to 6 AM)
    return currentMs >= start || currentMs <= end
}

/**
 * Get the effective heartbeat chance percent, considering defaults.
 */
function getEffectiveChancePercent(assistant, projectId, userData) {
    return getEffectiveHeartbeatChancePercent(assistant, projectId, userData)
}

function getEffectiveHeartbeatIntervalMs(assistant) {
    return normalizeHeartbeatIntervalMs(assistant.heartbeatIntervalMs)
}

function getCurrentHeartbeatWindowStart(now, intervalMs) {
    return Math.floor(now / intervalMs) * intervalMs
}

/**
 * Normalize timezone offset from user data.
 * User timezone can be stored as a number (offset in minutes or hours) or a string.
 */
function normalizeTimezone(timezone) {
    if (typeof timezone === 'number') {
        // If small number, assume hours; if large, assume minutes
        if (Math.abs(timezone) <= 14) {
            return timezone * 60
        }
        return timezone
    }
    if (typeof timezone === 'string') {
        const parsed = parseInt(timezone, 10)
        if (!isNaN(parsed)) {
            if (Math.abs(parsed) <= 14) {
                return parsed * 60
            }
            return parsed
        }
    }
    return 0
}

/**
 * Main heartbeat check and execution function.
 * Called every 5 minutes by the scheduled Cloud Function.
 */
async function checkAndExecuteHeartbeats() {
    const startTime = Date.now()
    console.log('Heartbeat: Starting check')

    try {
        // Step 1: Load active users (logged in within 30 days)
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        const activeUsersMap = new Map()

        const activeUsersSnapshot = await admin
            .firestore()
            .collection('users')
            .where('lastLogin', '>=', thirtyDaysAgo)
            .get()

        activeUsersSnapshot.docs.forEach(doc => {
            activeUsersMap.set(doc.id, { id: doc.id, ...doc.data() })
        })

        console.log('Heartbeat: Active users loaded:', { count: activeUsersMap.size })

        // Step 2: Get projects with active users
        const activeUserProjects = new Set()
        const projectMembersMap = new Map()

        for (const [userId] of activeUsersMap.entries()) {
            try {
                const userProjectsSnapshot = await admin
                    .firestore()
                    .collection('projects')
                    .where('userIds', 'array-contains', userId)
                    .get()

                userProjectsSnapshot.docs.forEach(doc => {
                    const projectData = doc.data()
                    if (
                        projectData.active === false ||
                        projectData.isTemplate === true ||
                        projectData.parentTemplateId
                    ) {
                        return
                    }
                    activeUserProjects.add(doc.id)
                    if (!projectMembersMap.has(doc.id)) {
                        const memberIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
                        projectMembersMap.set(doc.id, new Set(memberIds))
                    }
                })
            } catch (error) {
                console.warn('Heartbeat: Error fetching projects for user:', { userId, error: error.message })
            }
        }

        console.log('Heartbeat: Projects identified:', { count: activeUserProjects.size })

        // Step 3: Check each assistant in each project
        const heartbeatsToExecute = []

        for (const projectId of activeUserProjects) {
            try {
                const assistantsSnapshot = await admin.firestore().collection(`assistants/${projectId}/items`).get()

                for (const doc of assistantsSnapshot.docs) {
                    const assistant = { uid: doc.id, ...doc.data() }
                    const assistantRef = admin.firestore().doc(`assistants/${projectId}/items/${assistant.uid}`)
                    const prompt = assistant.heartbeatPrompt ?? DEFAULT_PROMPT
                    const processedWindowUpdates = {}

                    if (!prompt || prompt.trim().length === 0) continue

                    const projectMembers = projectMembersMap.get(projectId) || new Set()

                    for (const userId of projectMembers) {
                        if (!activeUsersMap.has(userId)) continue

                        const userData = activeUsersMap.get(userId)
                        const chancePercent = getEffectiveChancePercent(assistant, projectId, userData)

                        if (chancePercent <= 0) continue

                        // Check awake window
                        const timezoneOffsetMinutes =
                            resolveUserTimezoneOffset(userData) ?? normalizeTimezone(userData.timezone)
                        if (!isWithinAwakeWindow(assistant, timezoneOffsetMinutes)) {
                            continue
                        }

                        const intervalMs = getEffectiveHeartbeatIntervalMs(assistant)
                        const currentWindowStart = getCurrentHeartbeatWindowStart(Date.now(), intervalMs)
                        const lastProcessedWindow = assistant.heartbeatLastProcessedWindowByUser?.[userId]
                        const lastExecuted = assistant.heartbeatLastExecutedByUser?.[userId]

                        if (lastExecuted && Date.now() - lastExecuted < intervalMs) {
                            continue
                        }

                        // Only evaluate one heartbeat chance per configured interval window.
                        if (lastProcessedWindow && lastProcessedWindow >= currentWindowStart) {
                            continue
                        }

                        processedWindowUpdates[`heartbeatLastProcessedWindowByUser.${userId}`] = currentWindowStart

                        // Roll dice
                        if (Math.random() * 100 >= chancePercent) {
                            continue
                        }

                        // Check gold
                        if (!userData.gold || userData.gold <= 0) {
                            console.log('Heartbeat: Skipping - no gold:', { userId, projectId })
                            continue
                        }

                        console.log('Heartbeat: Queuing execution:', {
                            projectId,
                            assistantId: assistant.uid,
                            userId,
                            chancePercent,
                            intervalMs,
                        })

                        heartbeatsToExecute.push({ projectId, assistant, userId, userData })
                    }

                    if (Object.keys(processedWindowUpdates).length > 0) {
                        await assistantRef.update(processedWindowUpdates)
                    }
                }
            } catch (error) {
                console.warn('Heartbeat: Error checking project:', { projectId, error: error.message })
            }
        }

        console.log('Heartbeat: Tasks to execute:', { count: heartbeatsToExecute.length })

        // Step 4: Execute heartbeats
        for (const { projectId, assistant, userId, userData } of heartbeatsToExecute) {
            try {
                const assistantRef = admin.firestore().doc(`assistants/${projectId}/items/${assistant.uid}`)
                // NOTE: duplicate runs within the same window are already prevented by
                // heartbeatLastProcessedWindowByUser (updated before this loop). We bump
                // heartbeatLastExecutedByUser after generatePreConfigTaskResult resolves so
                // silent-OK runs don't falsely look like a full execution in the UI.

                // If heartbeatSendWhatsApp is not explicitly set, default to true when user has a phone number
                const sendWhatsApp = getEffectiveHeartbeatSendWhatsApp(assistant, userData)
                const userPhone = userData.phone
                const shouldSendWhatsApp = sendWhatsApp && !!userPhone

                let chatId
                if (shouldSendWhatsApp) {
                    const { getOrCreateWhatsAppDailyTopic } = require('../WhatsApp/whatsAppDailyTopic')
                    const result = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistant.uid, userData)
                    chatId = result.chatId
                } else {
                    const result = await getOrCreateHeartbeatTopic(userId, projectId, assistant.uid, userData)
                    chatId = result.chatId
                }

                const basePrompt = assistant.heartbeatPrompt ?? DEFAULT_PROMPT

                const [chatHistory, topicTitle] = await Promise.all([
                    getTopicConversationHistory(
                        projectId,
                        chatId,
                        THREAD_CONTEXT_MESSAGE_LIMIT,
                        resolveUserTimezoneOffset(userData) ?? normalizeTimezone(userData.timezone)
                    ),
                    getTopicTitle(projectId, chatId),
                ])
                const prompt = basePrompt

                const openTasksContext = await getOpenTasksContextMessage(
                    userId,
                    resolveUserTimezoneOffset(userData) ?? normalizeTimezone(userData.timezone)
                )
                const additionalContextMessages = [
                    ...(topicTitle
                        ? [
                              [
                                  'system',
                                  `This conversation is about a chat titled: "${parseTextForUseLiKePrompt(
                                      topicTitle
                                  )}"`,
                              ],
                          ]
                        : []),
                    ...(openTasksContext?.message ? [['system', openTasksContext.message]] : []),
                    ...chatHistory,
                ]

                const executionResult = await generatePreConfigTaskResult(
                    userId,
                    projectId,
                    chatId,
                    [userId],
                    [FEED_PUBLIC_FOR_ALL],
                    assistant.uid,
                    prompt,
                    'en',
                    {
                        model: assistant.model,
                        temperature: assistant.temperature,
                        instructions: assistant.instructions,
                    },
                    {
                        sendWhatsApp: shouldSendWhatsApp,
                        name: 'Heartbeat',
                        recurrence: 'never',
                    },
                    null, // functionEntryTime
                    'topics', // objectType - heartbeat uses topic chats, not task chats
                    { additionalContextMessages, silentModeMarker: HEARTBEAT_OK_MARKER }
                )

                if (executionResult && executionResult.silentOk === true) {
                    await assistantRef.update({
                        [`heartbeatLastSilentOkByUser.${userId}`]: Date.now(),
                    })
                    console.log('Heartbeat: Silent OK (no message posted):', {
                        projectId,
                        assistantId: assistant.uid,
                        userId,
                    })
                } else {
                    await assistantRef.update({
                        [`heartbeatLastExecutedByUser.${userId}`]: Date.now(),
                    })
                    console.log('Heartbeat: Executed successfully:', {
                        projectId,
                        assistantId: assistant.uid,
                        userId,
                        sentWhatsApp: shouldSendWhatsApp,
                    })
                }
            } catch (error) {
                console.error('Heartbeat: Execution failed:', {
                    projectId,
                    assistantId: assistant.uid,
                    userId,
                    error: error.message,
                })
            }
        }

        const duration = Date.now() - startTime
        console.log('Heartbeat: Check completed:', {
            duration: `${(duration / 1000).toFixed(2)}s`,
            executed: heartbeatsToExecute.length,
        })
    } catch (error) {
        console.error('Heartbeat: Fatal error:', error)
        throw error
    }
}

module.exports = {
    checkAndExecuteHeartbeats,
}
