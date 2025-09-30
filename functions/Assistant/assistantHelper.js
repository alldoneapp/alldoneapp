const { v4: uuidv4 } = require('uuid')
const admin = require('firebase-admin')
const moment = require('moment')
const OpenAI = require('openai')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const {
    MENTION_SPACE_CODE,
    STAYWARD_COMMENT,
    FEED_PUBLIC_FOR_ALL,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    inProductionEnvironment,
    OPEN_STEP,
} = require('../Utils/HelperFunctionsCloud')
const { logEvent } = require('../GAnalytics/GAnalytics')
const {
    GLOBAL_PROJECT_ID,
    getAssistantData,
    getDefaultAssistantData,
    updateAssistantLastCommentData,
} = require('../Firestore/assistantsFirestore')
const { updateContactLastCommentData } = require('../Firestore/contactsFirestore')
const { updateUserLastCommentData } = require('../Users/usersFirestore')
const { updateSkillLastCommentData } = require('../Skills/skillsFirestore')
const { updateTaskLastCommentData } = require('../Tasks/tasksFirestoreCloud')
const { updateGoalLastCommentData } = require('../Goals/goalsFirestore')
const { updateNoteLastCommentData } = require('../Notes/notesFirestoreCloud')
const {
    removeFormatTagsFromText,
    cleanTextMetaData,
    shrinkTagText,
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
} = require('../Utils/parseTextUtils')
const { getObjectFollowersIds } = require('../Feeds/globalFeedsHelper')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { getChat } = require('../Chats/chatsFirestoreCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getEnvFunctions } = require('../envFunctionsHelper')

const MODEL_GPT3_5 = 'MODEL_GPT3_5'
const MODEL_GPT4 = 'MODEL_GPT4'
const MODEL_GPT4O = 'MODEL_GPT4O'
const MODEL_GPT5 = 'MODEL_GPT5'
const MODEL_SONAR = 'MODEL_SONAR'
const MODEL_SONAR_PRO = 'MODEL_SONAR_PRO'
const MODEL_SONAR_REASONING = 'MODEL_SONAR_REASONING'
const MODEL_SONAR_REASONING_PRO = 'MODEL_SONAR_REASONING_PRO'
const MODEL_SONAR_DEEP_RESEARCH = 'MODEL_SONAR_DEEP_RESEARCH'

const TEMPERATURE_VERY_LOW = 'TEMPERATURE_VERY_LOW'
const TEMPERATURE_LOW = 'TEMPERATURE_LOW'
const TEMPERATURE_NORMAL = 'TEMPERATURE_NORMAL'
const TEMPERATURE_HIGH = 'TEMPERATURE_HIGH'
const TEMPERATURE_VERY_HIGH = 'TEMPERATURE_VERY_HIGH'

const COMPLETION_MAX_TOKENS = 1000

const ENCODE_MESSAGE_GAP = 4
const CHARACTERS_PER_TOKEN_SONAR = 4 // Approximate number of characters per token for Sonar models

/**
 * Check if a model supports native OpenAI tool/function calling
 * @param {string} modelKey - The model key (e.g., MODEL_GPT4O)
 * @returns {boolean} True if model supports native tool calling
 */
const modelSupportsNativeTools = modelKey => {
    // Only GPT models support native tool calling
    return modelKey === MODEL_GPT3_5 || modelKey === MODEL_GPT4 || modelKey === MODEL_GPT4O || modelKey === MODEL_GPT5
}

const getTokensPerGold = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 100
    if (modelKey === MODEL_GPT4) return 10
    if (modelKey === MODEL_GPT4O) return 50
    if (modelKey === MODEL_GPT5) return 10
    if (modelKey === MODEL_SONAR) return 100
    if (modelKey === MODEL_SONAR_PRO) return 50
    if (modelKey === MODEL_SONAR_REASONING) return 20
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 15
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 10
}

const getModel = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 'gpt-3.5-turbo'
    if (modelKey === MODEL_GPT4) return 'gpt-4'
    if (modelKey === MODEL_GPT4O) return 'gpt-4o'
    if (modelKey === MODEL_GPT5) return 'gpt-5'
    if (modelKey === MODEL_SONAR) return 'sonar'
    if (modelKey === MODEL_SONAR_PRO) return 'sonar-pro'
    if (modelKey === MODEL_SONAR_REASONING) return 'sonar-reasoning'
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 'sonar-reasoning-pro'
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 'sonar-deep-research'
}

const getTemperature = temperatureKey => {
    if (temperatureKey === TEMPERATURE_VERY_LOW) return 0.2
    else if (temperatureKey === TEMPERATURE_LOW) return 0.5
    else if (temperatureKey === TEMPERATURE_NORMAL) return 0.7
    else if (temperatureKey === TEMPERATURE_HIGH) return 1
    return 1.3
}

async function spentGold(userId, goldToReduce) {
    console.log('🔋 GOLD COST TRACKING: Spending gold:', { userId, goldToReduce })

    // Check if FieldValue.increment is available
    if (admin.firestore.FieldValue && admin.firestore.FieldValue.increment) {
        console.log('🔋 GOLD COST TRACKING: Using FieldValue.increment')
        const promises = []
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    gold: admin.firestore.FieldValue.increment(-goldToReduce),
                })
        )
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    } else {
        console.log('🔋 GOLD COST TRACKING: FieldValue.increment not available, using manual calculation')
        // Fallback for emulator: get current gold, then update manually
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        const currentGold = userDoc.data()?.gold || 0
        const newGold = Math.max(0, currentGold - goldToReduce)

        console.log('🔋 GOLD COST TRACKING: Manual calculation:', { currentGold, goldToReduce, newGold })

        const promises = []
        promises.push(admin.firestore().doc(`users/${userId}`).update({ gold: newGold }))
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    }
}

const reduceGoldWhenChatWithAI = async (userId, userCurrentGold, aiModel, aiCommentText, contextMessages) => {
    console.log('🔋 GOLD COST TRACKING: Starting gold reduction process:', {
        userId,
        userCurrentGold,
        aiModel,
        modelName: getModel(aiModel),
        tokensPerGold: getTokensPerGold(aiModel),
        textLength: aiCommentText?.length,
        contextMessagesCount: contextMessages?.length,
    })

    const tokens = calculateTokens(aiCommentText, contextMessages, aiModel)
    console.log('🔋 GOLD COST TRACKING: Token calculation complete:', {
        totalTokens: tokens,
        aiModel,
        tokensPerGold: getTokensPerGold(aiModel),
    })

    const goldToReduce = calculateGoldToReduce(userCurrentGold, tokens, aiModel)
    console.log('🔋 GOLD COST TRACKING: Gold calculation complete:', {
        goldToReduce,
        userCurrentGold,
        costPerToken: 1 / getTokensPerGold(aiModel),
        totalCost: tokens / getTokensPerGold(aiModel),
        cappedAtUserGold: goldToReduce < tokens / getTokensPerGold(aiModel),
    })

    await spentGold(userId, goldToReduce)
    console.log('🔋 GOLD COST TRACKING: Gold reduction completed')
}

const calculateTokens = (aiText, contextMessages, modelKey) => {
    console.log('🧮 TOKEN CALCULATION: Starting for model:', modelKey)

    const aiTextLength = aiText?.length || 0
    const contextMessageDetails = contextMessages.map((msg, index) => ({
        index,
        type: msg[0],
        length: msg[1]?.length || 0,
    }))

    console.log('🧮 TOKEN CALCULATION: Input details:', {
        modelKey,
        aiTextLength,
        contextMessagesCount: contextMessages.length,
        contextMessageDetails,
        encodeMessageGap: ENCODE_MESSAGE_GAP,
    })

    // For Sonar models, use character count
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) {
        let totalChars = aiTextLength
        let contextChars = 0
        contextMessages.forEach(msg => {
            const msgLength = msg[1]?.length || 0
            contextChars += msgLength
            totalChars += msgLength
        })
        const baseTokens = Math.ceil(totalChars / CHARACTERS_PER_TOKEN_SONAR)
        const gapTokens = (contextMessages.length + 1) * ENCODE_MESSAGE_GAP
        const tokens = baseTokens + gapTokens

        console.log('🧮 TOKEN CALCULATION: Sonar model result:', {
            totalChars,
            aiTextChars: aiTextLength,
            contextChars,
            charactersPerToken: CHARACTERS_PER_TOKEN_SONAR,
            baseTokens,
            gapTokens,
            totalTokens: tokens,
        })
        return tokens
    }

    // For other models, use token encoding
    const encoding = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    let aiTokens = encoding.encode(aiText).length
    let contextTokens = 0
    let gapTokens = ENCODE_MESSAGE_GAP // Gap for AI response

    contextMessages.forEach((msg, index) => {
        const msgTokens = encoding.encode(msg[1]).length
        contextTokens += msgTokens
        gapTokens += ENCODE_MESSAGE_GAP
        console.log(`🧮 TOKEN CALCULATION: Context message ${index} (${msg[0]}): ${msgTokens} tokens`)
    })

    const totalTokens = aiTokens + contextTokens + gapTokens
    encoding.free()

    console.log('🧮 TOKEN CALCULATION: OpenAI model result:', {
        aiTokens,
        contextTokens,
        gapTokens,
        totalTokens,
        breakdown: {
            aiResponse: aiTokens,
            contextMessages: contextTokens,
            encodingGaps: gapTokens,
        },
    })
    return totalTokens
}

const calculateGoldToReduce = (userGold, totalTokens, model) => {
    console.log('Calculating gold Reduction:', {
        userGold,
        totalTokens,
        model,
        tokensPerGold: getTokensPerGold(model),
    })
    const goldCost = Math.round(totalTokens / getTokensPerGold(model))
    const goldToReduce = userGold - goldCost > 0 ? goldCost : userGold
    return goldToReduce
}

async function interactWithChatStream(formattedPrompt, modelKey, temperatureKey, allowedTools = []) {
    console.log('Starting interactWithChatStream...')
    console.log('Model Key:', modelKey)
    console.log('Allowed Tools:', allowedTools)
    console.log('Formatted Prompt structure:', JSON.stringify(formattedPrompt, null, 2))

    const model = getModel(modelKey)
    const temperature = getTemperature(temperatureKey)
    const envFunctions = getEnvFunctions()
    console.log('Environment functions loaded')
    console.log('Environment has PERPLEXITY_API_KEY:', !!envFunctions.PERPLEXITY_API_KEY)

    const { OPEN_AI_KEY, PERPLEXITY_API_KEY } = envFunctions

    // Check if it's a Perplexity model
    if (modelKey.startsWith('MODEL_SONAR')) {
        console.log('Using Perplexity model')
        const { PerplexityClient } = require('./perplexityClient')
        try {
            console.log('Creating PerplexityClient instance...')
            // Convert messages to Perplexity format [role, content]
            const formattedMessages = Array.isArray(formattedPrompt)
                ? formattedPrompt.map(msg => {
                      // Handle array format [role, content]
                      if (Array.isArray(msg)) {
                          return msg
                      }
                      // Handle object format { role, content }
                      if (typeof msg === 'object' && msg.role && msg.content) {
                          return [msg.role, msg.content]
                      }
                      console.error('Unexpected message format:', JSON.stringify(msg))
                      throw new Error('Unexpected message format')
                  })
                : formattedPrompt
            console.log('Formatted messages:', JSON.stringify(formattedMessages, null, 2))

            const client = new PerplexityClient(PERPLEXITY_API_KEY, model)
            console.log('PerplexityClient created successfully')
            return await client.stream(formattedMessages)
        } catch (error) {
            console.error('Error creating PerplexityClient:', error)
            throw error
        }
    } else {
        // Native OpenAI implementation with tool calling support
        const openai = new OpenAI({ apiKey: OPEN_AI_KEY })

        // Convert messages to OpenAI format
        const messages = Array.isArray(formattedPrompt)
            ? formattedPrompt.map(msg => {
                  // Handle array format [role, content]
                  if (Array.isArray(msg)) {
                      return { role: msg[0], content: msg[1] }
                  }
                  // Handle object format { role, content }
                  if (typeof msg === 'object' && msg.role && msg.content) {
                      return { role: msg.role, content: msg.content }
                  }
                  console.error('Unexpected message format:', JSON.stringify(msg))
                  throw new Error('Unexpected message format')
              })
            : formattedPrompt

        const requestParams = {
            model: model,
            temperature: temperature,
            max_completion_tokens: COMPLETION_MAX_TOKENS,
            messages: messages,
            stream: true,
        }

        // Add tools if model supports native tools and tools are allowed
        if (modelSupportsNativeTools(modelKey) && Array.isArray(allowedTools) && allowedTools.length > 0) {
            const { getToolSchemas } = require('./toolSchemas')
            const toolSchemas = getToolSchemas(allowedTools)
            if (toolSchemas.length > 0) {
                console.log(
                    'Using native tool schemas:',
                    toolSchemas.map(t => t.function.name)
                )
                requestParams.tools = toolSchemas
            }
        }

        console.log('Creating OpenAI stream with params:', {
            model: requestParams.model,
            temperature: requestParams.temperature,
            max_tokens: requestParams.max_tokens,
            messageCount: messages.length,
            hasTools: !!requestParams.tools,
        })

        const stream = await openai.chat.completions.create(requestParams)

        // Convert OpenAI stream to our expected format
        return convertOpenAIStream(stream)
    }
}

/**
 * Convert OpenAI stream chunks to our expected format
 */
async function* convertOpenAIStream(stream) {
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta

        if (!delta) continue

        // Yield chunk in our expected format
        yield {
            content: delta.content || '',
            additional_kwargs: {
                tool_calls: delta.tool_calls || undefined,
            },
        }
    }
}

function formatMessage(objectType, message, assistantId) {
    console.log('🎯 EMULATOR: formatMessage called - using fallback timestamp for emulator')

    const commentId = uuidv4()
    const comment = {
        commentText: message,
        // Use regular timestamp as fallback for emulator
        lastChangeDate: new Date(),
        creatorId: assistantId,
        fromAssistant: true,
    }
    if (objectType === 'tasks') comment.commentType = STAYWARD_COMMENT
    console.log('🎯 EMULATOR: formatMessage completed successfully')
    return { commentId, comment }
}

const updateLastCommentDataOfChatParentObject = async (projectId, objectId, type, lastComment, commentType) => {
    const cleanedComment = shrinkTagText(
        cleanTextMetaData(removeFormatTagsFromText(lastComment), true),
        LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN
    )

    if (type === 'assistants') {
        await updateAssistantLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'contacts') {
        const promises = []
        promises.push(updateContactLastCommentData(projectId, objectId, cleanedComment, commentType))
        promises.push(updateUserLastCommentData(projectId, objectId, cleanedComment, commentType))
        await Promise.all(promises)
    } else if (type === 'skills') {
        await updateSkillLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'tasks') {
        await updateTaskLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'goals') {
        await updateGoalLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'notes') {
        await updateNoteLastCommentData(projectId, objectId, cleanedComment, commentType)
    }
}

const getFollowerLists = async (projectId, objectType, objectId, isPublicFor) => {
    let followerIds = await getObjectFollowersIds(projectId, objectType, objectId)

    followerIds = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        ? followerIds
        : followerIds.filter(uid => isPublicFor.includes(uid))

    return followerIds
}

const createChatInternalNotifications = (
    projectId,
    objectId,
    objectType,
    commentId,
    followrsMap,
    userIdsToNotify,
    assistantId,
    batch
) => {
    userIdsToNotify.forEach(userId => {
        batch.set(admin.firestore().doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
            chatId: objectId,
            chatType: objectType,
            followed: !!followrsMap[userId],
            date: moment().utc().valueOf(),
            creatorId: assistantId,
            creatorType: 'assistant',
        })
    })
}

const createChatEmailNotifications = (
    projectId,
    objectId,
    objectType,
    objectName,
    messageTimestamp,
    followerIds,
    batch
) => {
    // Check if followerIds array is not empty before using arrayUnion
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for email notifications, skipping arrayUnion', { objectId })
        // Create with empty array instead of using arrayUnion
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: [],
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    } else {
        // Normal case with follower IDs
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: followerIds, // Use array directly for emulator
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    }
}

const createChatPushNotification = (
    projectId,
    objectId,
    followerIds,
    objectName,
    commentId,
    messageTimestamp,
    assistantName,
    projectname,
    comment,
    chatLink,
    batch
) => {
    // Check if followerIds array is not empty before creating notification
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for push notifications, skipping notification creation', { objectId })
        return // Skip creating notification
    }

    // Normal case with follower IDs
    batch.set(admin.firestore().doc(`pushNotifications/${commentId}`), {
        userIds: followerIds,
        body: `${projectname}\n  ✔ ${objectName}\n ${assistantName} ${'commented'}: ${comment}`,
        link: chatLink,
        messageTimestamp,
        type: 'Chat Notification',
        chatId: objectId,
        projectId,
    })
}

const generateNotifications = (
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    objectName,
    assistantName,
    projectname,
    chatLink,
    commentId,
    lastComment,
    followerIds,
    assistantId
) => {
    // Ensure followerIds is at least an empty array if not provided
    const safeFollowerIds = followerIds || []

    if (safeFollowerIds.length === 0) {
        console.log('No followers to notify for this message', {
            projectId,
            objectType,
            objectId,
        })
    }

    const batch = new BatchWrapper(admin.firestore())
    const messageTimestamp = moment().utc().valueOf()
    const followersMap = {}
    safeFollowerIds.forEach(followerId => {
        followersMap[followerId] = true
    })

    // Only create notifications if there are followers or users to notify
    if (safeFollowerIds.length > 0 || (userIdsToNotify && userIdsToNotify.length > 0)) {
        createChatInternalNotifications(
            projectId,
            objectId,
            objectType,
            commentId,
            followersMap,
            userIdsToNotify,
            assistantId,
            batch
        )

        createChatEmailNotifications(
            projectId,
            objectId,
            objectType,
            objectName,
            messageTimestamp,
            safeFollowerIds,
            batch
        )

        createChatPushNotification(
            projectId,
            objectId,
            safeFollowerIds,
            objectName,
            commentId,
            messageTimestamp,
            assistantName,
            projectname,
            lastComment,
            chatLink,
            batch
        )
    }

    return batch.commit()
}

const getCurrentFollowerIds = async (followerIds, projectId, objectType, objectId, isPublicFor) => {
    try {
        // If followerIds is already provided, use that
        if (followerIds && Array.isArray(followerIds)) {
            console.log('Using provided follower IDs:', {
                followerCount: followerIds.length,
                projectId,
                objectType,
                objectId,
            })
            return followerIds
        }

        // Otherwise get follower IDs from the project
        console.log('Fetching follower IDs for object:', {
            projectId,
            objectType,
            objectId,
        })

        // Get the chat object first to get the taskId
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        const chat = chatDoc.data()

        if (!chat || !chat.taskId) {
            console.log('No chat or taskId found:', { objectId })
            return []
        }

        // Get the task to find the creator - first try in project
        let taskDoc = await admin
            .firestore()
            .doc(`assistantTasks/${projectId}/${chat.assistantId}/${chat.taskId}`)
            .get()
        let task = taskDoc.data()

        // If not found, try in global projects
        if (!task || !task.creatorUserId) {
            console.log('Task not found in project, checking global projects:', { taskId: chat.taskId })
            taskDoc = await admin
                .firestore()
                .doc(`assistantTasks/globalProject/${chat.assistantId}/${chat.taskId}`)
                .get()
            task = taskDoc.data()
        }

        if (!task || !task.creatorUserId) {
            console.log('No task or creatorUserId found in project or global:', { taskId: chat.taskId })
            return []
        }

        console.log('Found task creator and using that as follower:', {
            taskId: chat.taskId,
            creatorUserId: task.creatorUserId,
        })

        // Return array with just the creator ID
        return [task.creatorUserId]
    } catch (error) {
        console.error('Error in getCurrentFollowerIds:', {
            error,
            projectId,
            objectType,
            objectId,
        })
        return [] // Return empty array on error
    }
}

const updateLastAssistantCommentData = async (projectId, objectType, objectId, currentFollowerIds, creatorId) => {
    const promises = []
    currentFollowerIds.forEach(followerId => {
        const ref = admin.firestore().doc(`users/${followerId}`)
        const updateDate = { objectType, objectId, creatorId, creatorType: 'assistant', date: moment().utc().valueOf() }

        promises.push(
            ref.update({
                [`lastAssistantCommentData.${projectId}`]: updateDate,
                [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                    ...updateDate,
                    projectId,
                },
            })
        )
    })
    await Promise.all(promises)
}

/**
 * Execute a tool natively and return the raw result (not processed by LLM)
 * This is used for OpenAI native tool calling
 */
async function executeToolNatively(toolName, toolArgs, projectId, assistantId, requestUserId, userContext) {
    console.log('🔧 executeToolNatively:', { toolName, toolArgs, projectId })

    const admin = require('firebase-admin')

    // Get creator ID - use requestUserId if available, otherwise use assistantId
    const creatorId = requestUserId || assistantId

    switch (toolName) {
        case 'create_task': {
            const { TaskService } = require('../shared/TaskService')
            const taskService = new TaskService({
                taskBatchSize: 100,
                maxBatchesPerProject: 20,
            })
            await taskService.initialize()

            // Get user data for feed
            let feedUser
            try {
                const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
                if (userDoc.exists) {
                    const userData = userDoc.data()
                    feedUser = {
                        uid: creatorId,
                        id: creatorId,
                        creatorId: creatorId,
                        name: userData.name || userData.displayName || 'User',
                        email: userData.email || '',
                    }
                } else {
                    feedUser = {
                        uid: creatorId,
                        id: creatorId,
                        creatorId: creatorId,
                        name: 'Unknown User',
                        email: '',
                    }
                }
            } catch (error) {
                console.warn('Could not get user data, using defaults:', error)
                feedUser = {
                    uid: creatorId,
                    id: creatorId,
                    creatorId: creatorId,
                    name: 'Unknown User',
                    email: '',
                }
            }

            const result = await taskService.createAndPersistTask(
                {
                    name: toolArgs.name,
                    description: toolArgs.description || '',
                    userId: creatorId,
                    projectId: projectId,
                    isPrivate: false,
                    feedUser,
                },
                {
                    userId: creatorId,
                    projectId: projectId,
                }
            )

            return {
                success: true,
                taskName: toolArgs.name,
                taskId: result.taskId,
            }
        }

        case 'create_note': {
            const notesRef = admin.firestore().collection(`notes/${projectId}/notes`)
            const noteData = {
                title: toolArgs.title,
                content: toolArgs.content,
                creatorId: creatorId,
                lastChangeDate: admin.firestore.FieldValue.serverTimestamp(),
                createDate: admin.firestore.FieldValue.serverTimestamp(),
            }

            const noteRef = await notesRef.add(noteData)
            return {
                success: true,
                noteTitle: toolArgs.title,
                noteId: noteRef.id,
            }
        }

        case 'get_tasks': {
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
            const { ProjectService } = require('../shared/ProjectService')

            // Get user data
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            // Get projects
            const projectService = new ProjectService()
            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projectsData = await projectService.getUserProjects(userData, includeArchived, includeCommunity)

            const retrievalService = new TaskRetrievalService()
            const tasks = await retrievalService.getUserTasks({
                projectId: toolArgs.allProjects ? null : projectId,
                userId: creatorId,
                userData,
                projectsData,
                status: toolArgs.status || 'open',
                date: toolArgs.date || null,
            })

            return {
                tasks: tasks.map(t => ({
                    id: t.id,
                    name: t.name,
                    description: t.description,
                    completed: t.completed,
                    projectName: t.projectName,
                    dueDate: t.dueDate,
                })),
                count: tasks.length,
            }
        }

        case 'get_user_projects': {
            const { ProjectService } = require('../shared/ProjectService')

            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            const projectService = new ProjectService()
            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projects = await projectService.getUserProjects(userData, includeArchived, includeCommunity)

            return {
                projects: projects.map(p => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    description: p.description,
                })),
                count: projects.length,
            }
        }

        case 'get_focus_task': {
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                return { focusTask: null }
            }

            const userData = userDoc.data()
            const focusTaskId = userData.focusTask

            if (!focusTaskId) {
                return { focusTask: null }
            }

            const taskDoc = await admin.firestore().doc(`tasks/${projectId}/tasks/${focusTaskId}`).get()
            if (!taskDoc.exists) {
                return { focusTask: null }
            }

            const taskData = taskDoc.data()
            return {
                focusTask: {
                    id: taskDoc.id,
                    name: taskData.name,
                    description: taskData.description,
                    completed: taskData.completed,
                },
            }
        }

        case 'update_task': {
            const { TaskService } = require('../shared/TaskService')
            const taskService = new TaskService({
                taskBatchSize: 100,
                maxBatchesPerProject: 20,
            })
            await taskService.initialize()

            // Get user data for feed
            let feedUser
            try {
                const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
                if (userDoc.exists) {
                    const userData = userDoc.data()
                    feedUser = {
                        uid: creatorId,
                        id: creatorId,
                        creatorId: creatorId,
                        name: userData.name || userData.displayName || 'User',
                        email: userData.email || '',
                    }
                }
            } catch (error) {
                console.warn('Could not get user data:', error)
                feedUser = {
                    uid: creatorId,
                    id: creatorId,
                    creatorId: creatorId,
                    name: 'Unknown User',
                    email: '',
                }
            }

            const result = await taskService.updateTask(toolArgs, {
                userId: creatorId,
                projectId: projectId,
                feedUser: feedUser,
            })

            return result
        }

        case 'update_note': {
            // Search for note by title
            const notesRef = admin.firestore().collection(`notes/${projectId}/notes`)
            const querySnapshot = await notesRef.where('title', '==', toolArgs.noteTitle).limit(1).get()

            if (querySnapshot.empty) {
                throw new Error(`Note with title "${toolArgs.noteTitle}" not found`)
            }

            const noteDoc = querySnapshot.docs[0]
            await noteDoc.ref.update({
                content: toolArgs.content,
                lastChangeDate: admin.firestore.FieldValue.serverTimestamp(),
            })

            return {
                success: true,
                noteTitle: toolArgs.noteTitle,
                noteId: noteDoc.id,
            }
        }

        default:
            throw new Error(`Unknown tool: ${toolName}`)
    }
}

async function storeChunks(
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    stream,
    parser,
    assistantId,
    isPublicFor,
    followerIds,
    objectName,
    assistantName,
    projectname,
    chatLink,
    requestUserId,
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = []
) {
    console.log('Starting storeChunks with:', {
        projectId,
        objectType,
        objectId,
        hasStream: !!stream,
        hasParser: !!parser,
        assistantId,
        isPublicFor,
        followerIdsCount: followerIds?.length,
        objectName,
        assistantName,
        projectname,
        hasChatLink: !!chatLink,
    })

    try {
        const { commentId, comment } = formatMessage(objectType, '', assistantId)
        console.log('Formatted initial message:', {
            commentId,
            hasComment: !!comment,
            commentContent: comment,
        })

        let promises = []
        promises.push(getCurrentFollowerIds(followerIds, projectId, objectType, objectId, isPublicFor))
        promises.push(
            admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
                .set(comment)
        )

        console.log('Getting current follower IDs and creating initial comment...')
        const [currentFollowerIds] = await Promise.all(promises)
        console.log('Got current follower IDs:', {
            followerCount: currentFollowerIds?.length,
        })

        let commentText = ''
        let thinkingMode = false
        let thinkingContent = ''
        let answerContent = ''
        let chunkCount = 0
        let toolAlreadyExecuted = false

        // Create a reference to the comment document for updates
        const commentRef = admin
            .firestore()
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)

        // Process each chunk from the stream
        console.log('Starting to process stream chunks...')
        for await (const chunk of stream) {
            chunkCount++
            console.log(`Processing chunk #${chunkCount}:`, {
                hasContent: !!chunk.content,
                contentLength: chunk.content?.length,
                isLoading: chunk.isLoading,
                isThinking: chunk.isThinking,
                clearThinkingMode: chunk.clearThinkingMode,
                hasReplacementContent: !!chunk.replacementContent,
            })

            // If a tool was already executed, skip all remaining chunks from the stream
            if (toolAlreadyExecuted) {
                console.log('Tool already executed, discarding remaining stream chunk')
                continue
            }

            // Handle native OpenAI tool calls (from GPT models with native tool calling)
            if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
                console.log('🔧 NATIVE TOOL CALL: Detected native tool call', {
                    toolCallsCount: chunk.additional_kwargs.tool_calls.length,
                    toolCalls: chunk.additional_kwargs.tool_calls.map(tc => ({
                        id: tc.id,
                        name: tc.function?.name,
                        argsLength: tc.function?.arguments?.length,
                    })),
                })

                // Check if we have conversation history to resume with
                if (!conversationHistory || !modelKey || !temperatureKey) {
                    console.warn(
                        '🔧 NATIVE TOOL CALL: Missing conversation history or model info - tools disabled for this model'
                    )
                    commentText += '\n\n[Tools are only available for GPT models]'
                    await commentRef.update({ commentText })
                    toolAlreadyExecuted = true
                    continue
                }

                // Process first tool call (OpenAI typically sends one at a time)
                const toolCall = chunk.additional_kwargs.tool_calls[0]
                const toolName = toolCall.function.name
                const toolCallId = toolCall.id

                // Parse arguments
                let toolArgs = {}
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments)
                    console.log('🔧 NATIVE TOOL CALL: Parsed arguments', { toolName, toolArgs })
                } catch (e) {
                    console.error('🔧 NATIVE TOOL CALL: Failed to parse arguments', e)
                    commentText += `\n\nError: Failed to parse tool arguments for ${toolName}`
                    await commentRef.update({ commentText })
                    toolAlreadyExecuted = true
                    continue
                }

                // Check permissions
                const assistant = await getAssistantForChat(projectId, assistantId)
                const allowed = Array.isArray(assistant.allowedTools) && assistant.allowedTools.includes(toolName)

                if (!allowed) {
                    console.log('🔧 NATIVE TOOL CALL: Tool not permitted', { toolName })
                    commentText += `\n\nTool not permitted: ${toolName}`
                    await commentRef.update({ commentText })
                    toolAlreadyExecuted = true
                    continue
                }

                // Show loading indicator
                const loadingMessage = `⏳ Executing ${toolName}...`
                commentText += `\n\n${loadingMessage}`
                await commentRef.update({ commentText })

                console.log('🔧 NATIVE TOOL CALL: Executing tool', { toolName, toolArgs })

                // Execute tool and get result
                let toolResult
                try {
                    toolResult = await executeToolNatively(
                        toolName,
                        toolArgs,
                        projectId,
                        assistantId,
                        requestUserId,
                        userContext
                    )
                    console.log('🔧 NATIVE TOOL CALL: Tool executed successfully', {
                        toolName,
                        resultLength: JSON.stringify(toolResult).length,
                    })
                } catch (error) {
                    console.error('🔧 NATIVE TOOL CALL: Tool execution failed', error)
                    const errorMsg = `Error executing ${toolName}: ${error.message}`
                    commentText = commentText.replace(loadingMessage, errorMsg)
                    await commentRef.update({ commentText })
                    toolAlreadyExecuted = true
                    continue
                }

                // Build new conversation history with tool result
                // Need to add: assistant's message with tool call, then tool result message

                // Collect all assistant content before tool call
                const assistantMessageContent = commentText.replace(loadingMessage, '').trim()

                // Build updated conversation with plain objects
                const updatedConversation = [
                    ...conversationHistory,
                    {
                        role: 'assistant',
                        content: assistantMessageContent,
                        tool_calls: [
                            {
                                id: toolCallId,
                                type: 'function',
                                function: {
                                    name: toolName,
                                    arguments: JSON.stringify(toolArgs),
                                },
                            },
                        ],
                    },
                    {
                        role: 'tool',
                        content: JSON.stringify(toolResult),
                        tool_call_id: toolCallId,
                    },
                ]

                console.log('🔧 NATIVE TOOL CALL: Resuming stream with tool result', {
                    conversationLength: updatedConversation.length,
                    toolResultLength: JSON.stringify(toolResult).length,
                })

                // Resume stream with updated conversation
                const newStream = await interactWithChatStream(
                    updatedConversation,
                    modelKey,
                    temperatureKey,
                    allowedTools
                )

                // Remove loading indicator
                commentText = commentText.replace(loadingMessage, '')
                await commentRef.update({ commentText })

                // Process the new stream - it will continue adding to commentText
                console.log('🔧 NATIVE TOOL CALL: Processing resumed stream')
                stream = newStream
                toolAlreadyExecuted = true // Prevent old stream from continuing
                continue
            }

            // Handle loading indicator for deep research
            if (chunk.isLoading) {
                await commentRef.update({
                    commentText: chunk.content,
                    isLoading: true,
                    isThinking: false,
                })
                console.log('Updated comment with loading state')
                continue
            }

            // If we receive a signal to clear thinking and replace with answer content
            if (chunk.clearThinkingMode && chunk.replacementContent) {
                thinkingMode = false
                // Replace the entire comment text with the answer content
                commentText = chunk.replacementContent
                answerContent = chunk.replacementContent

                await commentRef.update({
                    commentText,
                    isThinking: false,
                    isLoading: false,
                })
                console.log('Cleared thinking mode and updated with replacement content:', {
                    contentLength: commentText.length,
                })
                continue
            }

            // Track if this chunk is part of thinking mode
            if (chunk.isThinking !== undefined) {
                thinkingMode = chunk.isThinking
            }

            // Add the content to our accumulated text
            const contentToAdd = parser ? parser(chunk.content) : chunk.content
            console.log('Content to add:', {
                originalLength: chunk.content?.length,
                parsedLength: contentToAdd?.length,
                isThinkingMode: thinkingMode,
            })

            // If in thinking mode, accumulate thinking content separately
            if (thinkingMode) {
                thinkingContent += contentToAdd
                commentText = thinkingContent
            } else {
                // If not in thinking mode, accumulate answer content
                answerContent += contentToAdd
                commentText = answerContent
            }

            // Update the comment with current text and thinking state
            await commentRef.update({
                commentText,
                isThinking: thinkingMode,
                isLoading: false,
            })
            console.log('Updated comment with new content:', {
                commentLength: commentText.length,
                isThinking: thinkingMode,
            })

            // Note: Manual TOOL: format parsing removed - native tool calling only
            // Tools are only available for GPT models that support native tool calling
        }
        console.log('Finished processing stream chunks:', {
            totalChunks: chunkCount,
            finalCommentLength: commentText.length,
        })

        // Simple validation: warn if assistant mentioned actions without tool calls
        validateToolCallConsistency(commentText)

        const lastComment = cleanTextMetaData(removeFormatTagsFromText(commentText), true)
        console.log('Generated last comment:', {
            hasLastComment: !!lastComment,
            lastCommentLength: lastComment?.length,
            originalLength: commentText.length,
        })

        promises = []

        console.log('Updating last assistant comment data...')
        promises.push(updateLastAssistantCommentData(projectId, objectType, objectId, currentFollowerIds, assistantId))

        console.log('Generating notifications...')
        promises.push(
            generateNotifications(
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                objectName,
                assistantName,
                projectname,
                chatLink,
                commentId,
                lastComment,
                currentFollowerIds,
                assistantId
            )
        )

        console.log('Updating chat object...')
        console.log('KW SPECIAL Chat update data:', {
            objectId,
            projectId,
            assistantId,
            userIdsToNotify,
            members: [userIdsToNotify[0], assistantId],
            path: `chatObjects/${projectId}/chats/${objectId}`,
        })
        promises.push(
            admin
                .firestore()
                .doc(`chatObjects/${projectId}/chats/${objectId}`)
                .update({
                    members: [userIdsToNotify[0], assistantId], // Ensure user is first, then assistant
                    lastEditionDate: Date.now(),
                    [`commentsData.lastCommentOwnerId`]: assistantId,
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
                    [`commentsData.amount`]: 1, // Use direct value for emulator
                })
        )

        console.log('Updating last comment data...')
        promises.push(
            updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, commentText, STAYWARD_COMMENT)
        )

        console.log('Waiting for all promises to resolve...')
        await Promise.all(promises)
        console.log('All promises resolved successfully')

        return commentText
    } catch (error) {
        console.error('Error in storeChunks:', error)
        throw error
    }
}

const getLinkedParentChatUrl = (projectId, objectType, objectId) => {
    const origin = inProductionEnvironment() ? 'https://my.alldone.app' : 'https://mystaging.alldone.app'
    return `${origin}/projects/${projectId}/${objectType === 'topics' ? 'chats' : objectType}/${objectId}/chat`
}

async function getCommonData(projectId, objectType, objectId) {
    const promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getChat(projectId, objectId))
    const [project, chat] = await Promise.all(promises)

    const chatLink = getLinkedParentChatUrl(projectId, objectType, objectId)

    return { project, chat, chatLink }
}

async function storeBotAnswerStream(
    projectId,
    objectType,
    objectId,
    stream,
    userIdsToNotify,
    isPublicFor,
    parser,
    assistantId,
    followerIds,
    assistantName,
    requestUserId,
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = []
) {
    console.log('Starting storeBotAnswerStream with:', {
        projectId,
        objectType,
        objectId,
        assistantId,
        assistantName,
        hasStream: !!stream,
        hasParser: !!parser,
        userIdsToNotifyCount: userIdsToNotify?.length,
        followerIdsCount: followerIds?.length,
    })

    try {
        const { project, chat, chatLink } = await getCommonData(projectId, objectType, objectId)
        console.log('Retrieved common data:', {
            hasProject: !!project,
            hasChat: !!chat,
            hasChatLink: !!chatLink,
        })

        const result = chat
            ? await storeChunks(
                  projectId,
                  objectType,
                  objectId,
                  userIdsToNotify,
                  stream,
                  parser,
                  assistantId,
                  isPublicFor,
                  followerIds,
                  chat.title,
                  assistantName,
                  project.name,
                  chatLink,
                  requestUserId || '',
                  userContext,
                  conversationHistory,
                  modelKey,
                  temperatureKey,
                  allowedTools
              )
            : ''

        console.log('storeBotAnswerStream returning comment text:', {
            hasText: !!result,
            textLength: result?.length,
        })

        return result
    } catch (error) {
        console.error('Error in storeBotAnswerStream:', error)
        throw error
    }
}

function replaceUserNameByMention(userName, userId, text) {
    const paresdName = `@${userName.replace(/ /g, MENTION_SPACE_CODE)}#${userId} `
    const re = new RegExp(`${userName}`, 'gi')
    return text.replace(re, paresdName)
}

function addSpaceToUrl(url, text) {
    const re = new RegExp(`${url}`, 'gi')
    return text.replace(re, ` ${url} `)
}

async function getAssistantForChat(projectId, assistantId) {
    let assistant = null
    if (assistantId) {
        // Try to get assistant from global project first
        assistant = await getAssistantData(admin, GLOBAL_PROJECT_ID, assistantId)
        // If not found in global, try project-specific
        if (!assistant) {
            assistant = await getAssistantData(admin, projectId, assistantId)
        }
    }
    if (!assistant) {
        assistant = await getDefaultAssistantData(admin)
    }
    // Provide fallback defaults for missing fields
    assistant.model = assistant.model || 'MODEL_GPT3_5'
    assistant.temperature = assistant.temperature || 'TEMPERATURE_NORMAL'
    assistant.instructions = assistant.instructions || 'You are a helpful assistant.'
    assistant.allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
    return assistant
}

// New function to get task-level settings or fall back to assistant settings
async function getTaskOrAssistantSettings(projectId, taskId, assistantId) {
    console.log('⚙️ ASSISTANT SETTINGS: Getting task or assistant settings:', { projectId, taskId, assistantId })

    // Get task data first
    const taskRef = admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`)
    const taskDoc = await taskRef.get()
    const task = taskDoc.data()
    console.log('⚙️ ASSISTANT SETTINGS: Task data:', {
        hasTask: !!task,
        taskAiModel: task?.aiModel,
        taskAiTemperature: task?.aiTemperature,
        hasTaskAiSystemMessage: !!task?.aiSystemMessage,
    })

    // Get assistant settings
    const assistant = await getAssistantForChat(projectId, assistantId)
    console.log('⚙️ ASSISTANT SETTINGS: Assistant data:', {
        hasAssistant: !!assistant,
        assistantModel: assistant?.model,
        assistantTemperature: assistant?.temperature,
        hasAssistantInstructions: !!assistant?.instructions,
        assistantDisplayName: assistant?.displayName,
        allowedToolsCount: assistant?.allowedTools?.length || 0,
    })

    // Return task settings if they exist, otherwise use assistant settings with defaults
    const settings = {
        model: (task && task.aiModel) || assistant.model || 'MODEL_GPT3_5',
        temperature: (task && task.aiTemperature) || assistant.temperature || 'TEMPERATURE_NORMAL',
        instructions: (task && task.aiSystemMessage) || assistant.instructions || 'You are a helpful assistant.',
        displayName: assistant.displayName, // Always use assistant's display name
        uid: assistant.uid, // Always use assistant's uid
        allowedTools: Array.isArray(assistant.allowedTools) ? assistant.allowedTools : [],
    }

    console.log('⚙️ ASSISTANT SETTINGS: Final resolved settings:', {
        finalModel: settings.model,
        finalTemperature: settings.temperature,
        hasInstructions: !!settings.instructions,
        displayName: settings.displayName,
        allowedTools: settings.allowedTools,
        modelTokensPerGold: getTokensPerGold(settings.model),
        settingsSource: {
            model: task && task.aiModel ? 'task' : 'assistant',
            temperature: task && task.aiTemperature ? 'task' : 'assistant',
            instructions: task && task.aiSystemMessage ? 'task' : 'assistant',
        },
    })
    return settings
}

function addBaseInstructions(messages, name, language, instructions, allowedTools = []) {
    messages.push(['system', `Your responses must be limited to ${COMPLETION_MAX_TOKENS} tokens.`])
    messages.push(['system', `You are an AI assistant  and your name is: "${parseTextForUseLiKePrompt(name || '')}"`])
    messages.push(['system', `Speak in ${parseTextForUseLiKePrompt(language || 'English')}`])
    messages.push(['system', `The current date is ${moment().format('dddd, MMMM Do YYYY, h:mm:ss a')}`])

    // Add emphasis on immediate action for tool-enabled assistants
    if (Array.isArray(allowedTools) && allowedTools.length > 0) {
        messages.push([
            'system',
            `IMPORTANT: You are action-oriented. When users ask you to do something, DO IT IMMEDIATELY - don't just talk about doing it.`,
        ])
    }
    messages.push([
        'system',
        'Always left a space between links and words. Do not wrap links inside [],{{}},() or any other characters',
    ])
    // Note: Tool instructions removed - using OpenAI native tool calling instead of manual TOOL: format
    if (instructions) messages.push(['system', parseTextForUseLiKePrompt(instructions)])
}

function parseTextForUseLiKePrompt(text) {
    if (!text) return ''
    return text.replaceAll('{', '{{').replaceAll('}', '}}')
}

/**
 * Example function showing how internal assistants can use SearchService
 * This function can be called by AI assistants to search for relevant content
 * when answering user questions or performing tasks.
 */
async function searchForAssistant(userId, projectId, query, options = {}) {
    const { type = 'all', dateRange = null, includeContent = false } = options

    try {
        // Initialize SearchService
        const { SearchService } = require('../shared/SearchService')
        const searchService = new SearchService({
            database: admin.firestore(),
            moment: moment,
            enableAlgolia: true,
            enableNoteContent: true,
            enableDateParsing: true,
            isCloudFunction: true,
        })
        await searchService.initialize()

        // Execute search
        const searchResults = await searchService.search(userId, {
            query,
            type,
            projectId,
            dateRange,
        })

        // If includeContent is true, fetch full note content for note results
        if (includeContent && searchResults.results.notes) {
            for (const noteResult of searchResults.results.notes) {
                try {
                    const fullNote = await searchService.getNote(userId, noteResult.id, noteResult.projectId)
                    noteResult.fullContent = fullNote.content
                    noteResult.wordCount = fullNote.metadata.wordCount
                } catch (error) {
                    console.warn(`Could not fetch full content for note ${noteResult.id}:`, error.message)
                }
            }
        }

        return {
            success: true,
            query: searchResults.query,
            parsedQuery: searchResults.parsedQuery,
            results: searchResults.results,
            totalResults: searchResults.totalResults,
            summary: generateSearchSummary(searchResults),
        }
    } catch (error) {
        console.error('Assistant search failed:', error)
        return {
            success: false,
            error: error.message,
            results: {},
            totalResults: 0,
        }
    }
}

/**
 * Generate a human-readable summary of search results for assistants
 */
function generateSearchSummary(searchResults) {
    const { results, totalResults, query } = searchResults
    const summaryParts = []

    if (totalResults === 0) {
        return `No results found for "${query}"`
    }

    Object.entries(results).forEach(([type, items]) => {
        if (items && items.length > 0) {
            const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
            summaryParts.push(`${items.length} ${typeLabel.toLowerCase()}`)
        }
    })

    const summary = `Found ${totalResults} results for "${query}": ${summaryParts.join(', ')}`

    // Add context about most relevant results
    const allResults = Object.values(results)
        .flat()
        .sort((a, b) => b.score - a.score)
    if (allResults.length > 0) {
        const topResult = allResults[0]
        return `${summary}. Most relevant: ${topResult.title} (${topResult.type})`
    }

    return summary
}

/**
 * Simple validation to log when assistant mentions actions without tool calls
 * This helps with debugging and monitoring
 */
function validateToolCallConsistency(commentText) {
    try {
        // Check if the assistant mentioned actions without actually calling tools
        const mentionedActions = []
        const intentPatterns = [
            /(?:I will|I'll|let me|I'm going to)\s+(create|make|add|update|get|retrieve|find)\s+(?:a\s+)?(task|note|tasks)/gi,
            /(?:creating|making|adding|updating|getting|retrieving|finding)\s+(?:a\s+)?(task|note|tasks)/gi,
        ]

        intentPatterns.forEach(pattern => {
            const matches = commentText.matchAll(pattern)
            for (const match of matches) {
                mentionedActions.push(match[0])
            }
        })

        // Check if there are already tool calls in the text
        const hasToolCalls = /TOOL:\s*\w+\s*\{/.test(commentText)

        if (mentionedActions.length > 0 && !hasToolCalls) {
            console.warn('🔍 TOOL VALIDATION: Assistant mentioned actions without tool calls:', {
                mentionedActions,
                commentText: commentText.substring(0, 200) + '...',
            })
        } else if (mentionedActions.length > 0 && hasToolCalls) {
            console.log('🔍 TOOL VALIDATION: Assistant mentioned actions with tool calls - OK')
        }
    } catch (error) {
        console.error('🔍 TOOL VALIDATION: Error in validation:', error)
    }
}

/**
 * Process tool results through LLM for intelligent analysis and formatting
 */
// processToolResultWithLLM function removed - native tool calling only

module.exports = {
    COMPLETION_MAX_TOKENS,
    storeBotAnswerStream,
    replaceUserNameByMention,
    addSpaceToUrl,
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    ENCODE_MESSAGE_GAP,
    reduceGoldWhenChatWithAI,
    getTaskOrAssistantSettings,
    searchForAssistant,
    generateSearchSummary,
}
