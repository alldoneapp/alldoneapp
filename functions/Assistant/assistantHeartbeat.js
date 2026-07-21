const admin = require('firebase-admin')
const moment = require('moment')
const { generatePreConfigTaskResult } = require('./assistantPreConfigTaskTopic')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { getOpenTasksContextMessage, parseTextForUseLiKePrompt } = require('./assistantHelper')
const {
    addTimestampToContextContent,
    resolveUserTimezoneOffset,
    getUserLocalDayBounds,
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
    getEffectiveHeartbeatChanceNoReplyPercent,
    getEffectiveHeartbeatSendWhatsApp,
    getEffectiveHeartbeatModel,
} = require('./heartbeatSettingsHelper')
const { THREAD_CONTEXT_MESSAGE_LIMIT } = require('./contextLimits')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { getFirstName } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')
const {
    HEARTBEAT_SCHEDULES_COLLECTION,
    calculateNextHeartbeatAfterOccurrence,
    getHeartbeatScheduleTiming,
    getTimestampMillis: getScheduleTimestampMillis,
    isAssistantHeartbeatEligible,
    isProjectHeartbeatEligible,
    isTimestampInHeartbeatAwakeWindow,
    isUserHeartbeatEligible,
} = require('./assistantHeartbeatSchedule')

const HEARTBEAT_INSUFFICIENT_GOLD_NOTICE =
    'Heartbeat paused because you\u2019re out of gold. Add gold to resume assistant heartbeats here https://my.alldone.app/settings/premium'
const HEARTBEAT_INSUFFICIENT_GOLD_NOTICE_FIELD = 'heartbeatInsufficientGoldNoticeAt'
const HEARTBEAT_INSUFFICIENT_GOLD_NOTICE_THROTTLE_MS = 24 * 60 * 60 * 1000
const HEARTBEAT_TASK_MAX_RUN_WALL_CLOCK_MS = 25 * 60 * 1000

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
 * Get the effective heartbeat chance percent for days the user already replied,
 * considering defaults.
 */
function getEffectiveChancePercent(assistant, projectId, userData) {
    return getEffectiveHeartbeatChancePercent(assistant, projectId, userData)
}

/**
 * Get the effective heartbeat chance percent for days the user has not replied yet,
 * considering defaults.
 */
function getEffectiveChanceNoReplyPercent(assistant, projectId, userData) {
    return getEffectiveHeartbeatChanceNoReplyPercent(assistant, projectId, userData)
}

/**
 * Determine whether the user has replied to the assistant during their current
 * local day. We look at both the in-app heartbeat daily topic and the WhatsApp
 * daily topic, since the heartbeat conversation can live in either channel.
 */
async function hasUserRepliedToday(projectId, userId, userData) {
    const { hasUserMessageOnUserLocalDay } = require('./assistantPreConfigTaskTopic')
    const { dateKey } = getUserLocalDateContext(userData)
    const heartbeatChatId = `Heartbeat${dateKey}${userId}`
    const whatsAppChatId = `BotChat${dateKey}${userId}`

    const [repliedInHeartbeat, repliedInWhatsApp] = await Promise.all([
        hasUserMessageOnUserLocalDay(projectId, heartbeatChatId, userId, userData),
        hasUserMessageOnUserLocalDay(projectId, whatsAppChatId, userId, userData),
    ])

    return repliedInHeartbeat || repliedInWhatsApp
}

function getEffectiveHeartbeatIntervalMs(assistant) {
    return normalizeHeartbeatIntervalMs(assistant.heartbeatIntervalMs)
}

function getCurrentHeartbeatWindowStart(now, intervalMs) {
    return Math.floor(now / intervalMs) * intervalMs
}

function getTimestampMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value instanceof Date) return value.getTime()
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value && typeof value.seconds === 'number') return value.seconds * 1000
    return 0
}

function hasCompletedHeartbeatToday(assistant, userId, userData, now = Date.now()) {
    const { startOfDay, endOfDay } = getUserLocalDayBounds(userData, now)
    const lastExecuted = getTimestampMillis(assistant.heartbeatLastExecutedByUser?.[userId])

    // HEARTBEAT_OK is only a silent evaluation result. Keep using the initial,
    // higher chance until the assistant produces a substantive heartbeat.
    return lastExecuted >= startOfDay && lastExecuted <= endOfDay
}

async function reserveHeartbeatInsufficientGoldNotice(userId, now = Date.now()) {
    const userRef = admin.firestore().doc(`users/${userId}`)

    return await admin.firestore().runTransaction(async transaction => {
        const userDoc = await transaction.get(userRef)
        const userData = userDoc.exists ? userDoc.data() || {} : {}
        const currentGold = typeof userData.gold === 'number' ? userData.gold : 0

        if (currentGold > 0) {
            return { shouldNotify: false, hasGold: true, userData: { id: userId, ...userData } }
        }

        const lastNoticeAt = getTimestampMillis(userData[HEARTBEAT_INSUFFICIENT_GOLD_NOTICE_FIELD])
        if (lastNoticeAt && now - lastNoticeAt < HEARTBEAT_INSUFFICIENT_GOLD_NOTICE_THROTTLE_MS) {
            return { shouldNotify: false, hasGold: false, userData: { id: userId, ...userData } }
        }

        transaction.set(
            userRef,
            {
                [HEARTBEAT_INSUFFICIENT_GOLD_NOTICE_FIELD]: now,
            },
            { merge: true }
        )

        return { shouldNotify: true, hasGold: false, userData: { id: userId, ...userData } }
    })
}

async function postHeartbeatInsufficientGoldNotice(projectId, assistant, userId, userData) {
    const { chatId } = await getOrCreateHeartbeatTopic(userId, projectId, assistant.uid, userData)

    await createInitialStatusMessage(
        projectId,
        'topics',
        chatId,
        assistant.uid,
        HEARTBEAT_INSUFFICIENT_GOLD_NOTICE,
        [userId],
        [FEED_PUBLIC_FOR_ALL],
        [userId]
    )

    return { channel: 'topic', chatId }
}

async function sendHeartbeatInsufficientGoldNotice(projectId, assistant, userId, userData) {
    try {
        const sendWhatsApp = getEffectiveHeartbeatSendWhatsApp(assistant, userData)
        const userPhone = userData?.phone

        if (sendWhatsApp && userPhone) {
            const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
            const whatsappService = new TwilioWhatsAppService()
            const whatsappResult = await whatsappService.sendTaskCompletionNotification(
                userPhone,
                userId,
                projectId,
                null,
                assistant.displayName || 'Assistant',
                { name: 'Heartbeat' },
                HEARTBEAT_INSUFFICIENT_GOLD_NOTICE
            )

            if (whatsappResult?.success) {
                console.log('Heartbeat: Insufficient gold notice sent by WhatsApp:', {
                    projectId,
                    assistantId: assistant.uid,
                    userId,
                })
                return { channel: 'whatsapp' }
            }

            console.warn('Heartbeat: WhatsApp insufficient gold notice failed, falling back to topic:', {
                projectId,
                assistantId: assistant.uid,
                userId,
                error: whatsappResult?.error || whatsappResult?.message || null,
            })
        }

        const result = await postHeartbeatInsufficientGoldNotice(projectId, assistant, userId, userData)
        console.log('Heartbeat: Insufficient gold notice posted to topic:', {
            projectId,
            assistantId: assistant.uid,
            userId,
            chatId: result.chatId,
        })
        return result
    } catch (error) {
        console.error('Heartbeat: Failed to send insufficient gold notice:', {
            projectId,
            assistantId: assistant.uid,
            userId,
            error: error.message,
        })
        return { channel: null, error: error.message }
    }
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

                        let userData = activeUsersMap.get(userId)
                        const repliedChancePercent = getEffectiveChancePercent(assistant, projectId, userData)
                        const noReplyChancePercent = getEffectiveChanceNoReplyPercent(assistant, projectId, userData)

                        // Skip only when the heartbeat is disabled for both reply states.
                        if (repliedChancePercent <= 0 && noReplyChancePercent <= 0) continue

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

                        // Check gold
                        if (!userData.gold || userData.gold <= 0) {
                            const noticeReservation = await reserveHeartbeatInsufficientGoldNotice(userId)
                            if (noticeReservation.hasGold) {
                                userData = { ...userData, ...noticeReservation.userData }
                            } else {
                                if (noticeReservation.shouldNotify) {
                                    await sendHeartbeatInsufficientGoldNotice(
                                        projectId,
                                        assistant,
                                        userId,
                                        noticeReservation.userData || userData
                                    )
                                }
                                console.log('Heartbeat: Skipping - no gold:', { userId, projectId })
                                continue
                            }
                        }

                        // Use the higher/replied chance until this assistant completes its
                        // first heartbeat of the user's local day. After that first run,
                        // use the lower/no-reply chance until the user replies that day.
                        let chancePercent = repliedChancePercent
                        let repliedToday = null
                        const completedToday = hasCompletedHeartbeatToday(assistant, userId, userData)
                        if (completedToday && repliedChancePercent !== noReplyChancePercent) {
                            repliedToday = await hasUserRepliedToday(projectId, userId, userData)
                            chancePercent = repliedToday ? repliedChancePercent : noReplyChancePercent
                        }

                        if (chancePercent <= 0) continue

                        // Roll dice
                        if (Math.random() * 100 >= chancePercent) {
                            continue
                        }

                        if (!userData.gold || userData.gold <= 0) {
                            console.log('Heartbeat: Skipping - no gold:', { userId, projectId })
                            continue
                        }

                        console.log('Heartbeat: Queuing execution:', {
                            projectId,
                            assistantId: assistant.uid,
                            userId,
                            chancePercent,
                            completedToday,
                            repliedToday,
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

                console.log('🔕 [Heartbeat] Dispatching with silent marker', {
                    projectId,
                    assistantId: assistant.uid,
                    userId,
                    chatId,
                    silentModeMarker: HEARTBEAT_OK_MARKER,
                    promptPreview: typeof prompt === 'string' ? prompt.slice(0, 120) : null,
                })

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
                        model: getEffectiveHeartbeatModel(assistant),
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

                console.log('🔕 [Heartbeat] generatePreConfigTaskResult returned', {
                    projectId,
                    assistantId: assistant.uid,
                    userId,
                    silentOk: executionResult?.silentOk === true,
                    guardrailStoppedReason: executionResult?.guardrailStopped?.reason || null,
                    hasCommentId: !!executionResult?.commentId,
                    commentLength: executionResult?.commentText?.length || 0,
                    commentPreview:
                        typeof executionResult?.commentText === 'string'
                            ? executionResult.commentText.slice(0, 200)
                            : null,
                })

                if (executionResult && executionResult.silentOk === true) {
                    await assistantRef.update({
                        [`heartbeatLastSilentOkByUser.${userId}`]: Date.now(),
                    })
                    console.log('Heartbeat: Silent OK (no message posted):', {
                        projectId,
                        assistantId: assistant.uid,
                        userId,
                    })
                } else if (executionResult?.guardrailStopped) {
                    await assistantRef.update({
                        [`heartbeatLastFailureByUser.${userId}`]: Date.now(),
                        [`heartbeatLastFailureMessageByUser.${userId}`]: executionResult.guardrailStopped.message,
                    })
                    console.log('Heartbeat: Guardrail failure recorded:', {
                        projectId,
                        assistantId: assistant.uid,
                        userId,
                        reason: executionResult.guardrailStopped.reason,
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

async function updateHeartbeatScheduleOutcome(scheduleRef, outcome, data = {}) {
    await scheduleRef
        .update({
            lastFinishedAt: Date.now(),
            lastOutcome: outcome,
            updatedAt: Date.now(),
            ...data,
        })
        .catch(error => {
            console.warn('Heartbeat worker: Failed to update schedule outcome', {
                scheduleId: scheduleRef.id,
                outcome,
                error: error.message,
            })
        })
}

async function claimScheduledHeartbeat({ scheduleId, projectId, assistantId, userId, dueAt, scheduleHash }) {
    const db = admin.firestore()
    const scheduleRef = db.doc(`${HEARTBEAT_SCHEDULES_COLLECTION}/${scheduleId}`)
    const now = Date.now()

    const result = await db.runTransaction(async transaction => {
        const scheduleDoc = await transaction.get(scheduleRef)
        if (!scheduleDoc.exists) return { claimed: false, reason: 'missing_schedule' }
        const schedule = scheduleDoc.data() || {}

        if (
            schedule.projectId !== projectId ||
            schedule.assistantId !== assistantId ||
            schedule.userId !== userId ||
            schedule.scheduleHash !== scheduleHash
        ) {
            return { claimed: false, reason: 'stale_schedule' }
        }

        const lastProcessedDueAt = getScheduleTimestampMillis(schedule.lastProcessedDueAt)
        if (lastProcessedDueAt >= dueAt) return { claimed: false, reason: 'already_processed' }

        const update = {
            lastProcessedDueAt: dueAt,
            lastStartedAt: now,
            lastOutcome: 'started',
            updatedAt: now,
        }
        const currentNextAt = getScheduleTimestampMillis(schedule.nextHeartbeatAt)
        if (!currentNextAt || currentNextAt <= dueAt) {
            update.nextHeartbeatAt = calculateNextHeartbeatAfterOccurrence({
                afterMs: Math.max(now, dueAt),
                scheduleId,
                intervalMs: schedule.intervalMs,
                awakeStartMs: schedule.awakeStartMs,
                awakeEndMs: schedule.awakeEndMs,
                timezoneName: schedule.timezoneName || null,
                timezoneOffsetMinutes: schedule.timezoneOffsetMinutes || 0,
            })
        }

        transaction.update(scheduleRef, update)
        return { claimed: true, schedule, scheduleRef }
    })

    return { ...result, scheduleRef }
}

async function executeHeartbeatContent({ projectId, assistant, userId, userData }) {
    const assistantRef = admin.firestore().doc(`assistants/${projectId}/items/${assistant.uid}`)
    const sendWhatsApp = getEffectiveHeartbeatSendWhatsApp(assistant, userData)
    const shouldSendWhatsApp = sendWhatsApp && !!userData.phone

    let chatId
    if (shouldSendWhatsApp) {
        const { getOrCreateWhatsAppDailyTopic } = require('../WhatsApp/whatsAppDailyTopic')
        const result = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistant.uid, userData)
        chatId = result.chatId
    } else {
        const result = await getOrCreateHeartbeatTopic(userId, projectId, assistant.uid, userData)
        chatId = result.chatId
    }

    const prompt = assistant.heartbeatPrompt ?? DEFAULT_PROMPT
    const timezoneOffset = resolveUserTimezoneOffset(userData) ?? normalizeTimezone(userData.timezone)
    const [chatHistory, topicTitle, openTasksContext] = await Promise.all([
        getTopicConversationHistory(projectId, chatId, THREAD_CONTEXT_MESSAGE_LIMIT, timezoneOffset),
        getTopicTitle(projectId, chatId),
        getOpenTasksContextMessage(userId, timezoneOffset),
    ])
    const additionalContextMessages = [
        ...(topicTitle
            ? [['system', `This conversation is about a chat titled: "${parseTextForUseLiKePrompt(topicTitle)}"`]]
            : []),
        ...(openTasksContext?.message ? [['system', openTasksContext.message]] : []),
        ...chatHistory,
    ]

    console.log('Heartbeat worker: Dispatching assistant run', {
        projectId,
        assistantId: assistant.uid,
        userId,
        chatId,
        silentModeMarker: HEARTBEAT_OK_MARKER,
    })

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
            model: getEffectiveHeartbeatModel(assistant),
            temperature: assistant.temperature,
            instructions: assistant.instructions,
        },
        {
            sendWhatsApp: shouldSendWhatsApp,
            name: 'Heartbeat',
            recurrence: 'never',
        },
        null,
        'topics',
        {
            additionalContextMessages,
            silentModeMarker: HEARTBEAT_OK_MARKER,
            maxRunWallClockMs: HEARTBEAT_TASK_MAX_RUN_WALL_CLOCK_MS,
        }
    )

    if (executionResult?.silentOk === true) {
        await assistantRef.update({ [`heartbeatLastSilentOkByUser.${userId}`]: Date.now() })
        return { outcome: 'silent_ok', executionResult }
    }
    if (executionResult?.guardrailStopped) {
        await assistantRef.update({
            [`heartbeatLastFailureByUser.${userId}`]: Date.now(),
            [`heartbeatLastFailureMessageByUser.${userId}`]: executionResult.guardrailStopped.message,
        })
        return { outcome: 'guardrail_failed', executionResult }
    }

    await assistantRef.update({ [`heartbeatLastExecutedByUser.${userId}`]: Date.now() })
    return { outcome: 'executed', executionResult }
}

async function executeScheduledHeartbeat(task = {}) {
    const { scheduleId, projectId, assistantId, userId, scheduleHash } = task
    const dueAt = Number(task.dueAt)
    if (!scheduleId || !projectId || !assistantId || !userId || !scheduleHash || !Number.isFinite(dueAt)) {
        console.warn('Heartbeat worker: Invalid task payload', { scheduleId, projectId, assistantId, userId })
        return { outcome: 'invalid_payload' }
    }

    const claim = await claimScheduledHeartbeat({ scheduleId, projectId, assistantId, userId, dueAt, scheduleHash })
    if (!claim.claimed) {
        console.log('Heartbeat worker: Skipping unclaimed occurrence', {
            scheduleId,
            dueAt,
            reason: claim.reason,
        })
        return { outcome: claim.reason }
    }

    const scheduleRef = claim.scheduleRef
    try {
        const db = admin.firestore()
        const [projectDoc, assistantDoc, userDoc] = await Promise.all([
            db.doc(`projects/${projectId}`).get(),
            db.doc(`assistants/${projectId}/items/${assistantId}`).get(),
            db.doc(`users/${userId}`).get(),
        ])
        const project = projectDoc.exists ? { ...projectDoc.data(), id: projectId } : null
        const assistant = assistantDoc.exists ? { ...assistantDoc.data(), uid: assistantId } : null
        let userData = userDoc.exists ? { ...userDoc.data(), id: userId } : null
        const isMember = Array.isArray(project?.userIds) && project.userIds.includes(userId)

        if (
            !project ||
            !assistant ||
            !userData ||
            !isMember ||
            !isProjectHeartbeatEligible(project) ||
            !isUserHeartbeatEligible(userData) ||
            !isAssistantHeartbeatEligible(assistant, projectId, userData)
        ) {
            await scheduleRef.delete().catch(() => {})
            return { outcome: 'ineligible' }
        }

        const timing = getHeartbeatScheduleTiming(assistant, userData)
        if (timing.scheduleHash !== scheduleHash) {
            await updateHeartbeatScheduleOutcome(scheduleRef, 'stale_schedule')
            return { outcome: 'stale_schedule' }
        }
        if (!isTimestampInHeartbeatAwakeWindow(Date.now(), timing)) {
            await updateHeartbeatScheduleOutcome(scheduleRef, 'outside_awake_window')
            return { outcome: 'outside_awake_window' }
        }

        // The claimed due time is the cadence boundary for scheduled heartbeats.
        // Comparing it with the previous run's completion timestamp would discard
        // the next occurrence whenever that run took any meaningful time to finish.

        const assistantRef = db.doc(`assistants/${projectId}/items/${assistantId}`)
        await assistantRef.update({ [`heartbeatLastCheckedByUser.${userId}`]: Date.now() })

        if (!userData.gold || userData.gold <= 0) {
            const noticeReservation = await reserveHeartbeatInsufficientGoldNotice(userId)
            if (noticeReservation.hasGold) {
                userData = { ...userData, ...noticeReservation.userData }
            } else {
                if (noticeReservation.shouldNotify) {
                    await sendHeartbeatInsufficientGoldNotice(
                        projectId,
                        assistant,
                        userId,
                        noticeReservation.userData || userData
                    )
                }
                await updateHeartbeatScheduleOutcome(scheduleRef, 'no_gold')
                return { outcome: 'no_gold' }
            }
        }

        const repliedChancePercent = getEffectiveChancePercent(assistant, projectId, userData)
        const noReplyChancePercent = getEffectiveChanceNoReplyPercent(assistant, projectId, userData)
        let chancePercent = repliedChancePercent
        let repliedToday = null
        const completedToday = hasCompletedHeartbeatToday(assistant, userId, userData)
        if (completedToday && repliedChancePercent !== noReplyChancePercent) {
            repliedToday = await hasUserRepliedToday(projectId, userId, userData)
            chancePercent = repliedToday ? repliedChancePercent : noReplyChancePercent
        }

        if (chancePercent <= 0 || Math.random() * 100 >= chancePercent) {
            await updateHeartbeatScheduleOutcome(scheduleRef, 'chance_skipped', {
                lastChancePercent: chancePercent,
            })
            return { outcome: 'chance_skipped', chancePercent, completedToday, repliedToday }
        }

        const result = await executeHeartbeatContent({ projectId, assistant, userId, userData })
        await updateHeartbeatScheduleOutcome(scheduleRef, result.outcome)
        return { outcome: result.outcome }
    } catch (error) {
        await updateHeartbeatScheduleOutcome(scheduleRef, 'failed', {
            lastError: String(error.message || error).slice(0, 500),
        })
        console.error('Heartbeat worker: Execution failed', {
            scheduleId,
            projectId,
            assistantId,
            userId,
            dueAt,
            error: error.message,
        })
        throw error
    }
}

module.exports = {
    checkAndExecuteHeartbeats,
    claimScheduledHeartbeat,
    executeHeartbeatContent,
    executeScheduledHeartbeat,
}
