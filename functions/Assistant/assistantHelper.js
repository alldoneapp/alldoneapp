const { v4: uuidv4 } = require('uuid')
const admin = require('firebase-admin')
const moment = require('moment')
const { ChatOpenAI } = require('@langchain/openai')
// const { ChatPerplexity } = require('@langchain/perplexity')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const {
    MENTION_SPACE_CODE,
    STAYWARD_COMMENT,
    FEED_PUBLIC_FOR_ALL,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    inProductionEnvironment,
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

const getTokensPerGold = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 100
    if (modelKey === MODEL_GPT4) return 10
    if (modelKey === MODEL_GPT4O) return 50
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
    const promises = []
    promises.push(
        admin
            .firestore()
            .doc(`users/${userId}`)
            .update({ gold: admin.firestore.FieldValue.increment(-goldToReduce) })
    )
    promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
    await Promise.all(promises)
}

const reduceGoldWhenChatWithAI = async (userId, userCurrentGold, aiModel, aiCommentText, contextMessages) => {
    console.log('Starting gold reduction process:', {
        userId,
        userCurrentGold,
        aiModel,
        textLength: aiCommentText?.length,
        contextMessagesCount: contextMessages?.length,
    })

    const tokens = calculateTokens(aiCommentText, contextMessages, aiModel)
    console.log('Calculated tokens:', tokens)

    const goldToReduce = calculateGoldToReduce(userCurrentGold, tokens, aiModel)
    console.log('Gold to reduce:', goldToReduce)

    await spentGold(userId, goldToReduce)
    console.log('Gold reduction completed')
}

const calculateTokens = (aiText, contextMessages, modelKey) => {
    console.log('Calculating tokens for model:', modelKey)

    // For Sonar models, use character count
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) {
        let totalChars = aiText.length
        contextMessages.forEach(msg => {
            totalChars += msg[1].length
        })
        const tokens =
            Math.ceil(totalChars / CHARACTERS_PER_TOKEN_SONAR) + (contextMessages.length + 1) * ENCODE_MESSAGE_GAP
        console.log('Sonar model token calculation:', {
            totalChars,
            tokensCalculated: tokens,
        })
        return tokens
    }

    // For other models, use token encoding
    const encoding = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    let tokens = encoding.encode(aiText).length + ENCODE_MESSAGE_GAP
    contextMessages.forEach(msg => {
        tokens += encoding.encode(msg[1]).length + ENCODE_MESSAGE_GAP
    })
    encoding.free()
    console.log('OpenAI model token calculation:', tokens)
    return tokens
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

async function interactWithChatStream(formattedPrompt, modelKey, temperatureKey) {
    console.log('Starting interactWithChatStream...')
    console.log('Model Key:', modelKey)
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
            // Convert LangChain messages to Perplexity format
            const formattedMessages = Array.isArray(formattedPrompt)
                ? formattedPrompt.map(msg => {
                      // Handle LangChain Message instance
                      if (msg.lc_namespace && msg.lc_namespace[0] === 'langchain_core' && msg.content) {
                          const role = msg.constructor.name.toLowerCase().replace('message', '')
                          return [role, msg.content]
                      }
                      // Handle LangChain message format (plain object)
                      if (msg.type === 'constructor' && msg.id && msg.id[0] === 'langchain_core') {
                          const role = msg.id[2].toLowerCase().replace('message', '')
                          return [role, msg.kwargs.content]
                      }
                      // Handle existing array format
                      if (Array.isArray(msg)) {
                          return msg
                      }
                      // Handle simple object format
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
        // Existing OpenAI implementation
        const chat = new ChatOpenAI({
            openAIApiKey: OPEN_AI_KEY,
            model_name: model,
            temperature: temperature,
            maxTokens: COMPLETION_MAX_TOKENS,
        })
        return await chat.stream(formattedPrompt)
    }
}

function formatMessage(objectType, message, assistantId) {
    const commentId = uuidv4()
    const comment = {
        commentText: message,
        lastChangeDate: admin.firestore.FieldValue.serverTimestamp(),
        creatorId: assistantId,
        fromAssistant: true,
    }
    if (objectType === 'tasks') comment.commentType = STAYWARD_COMMENT
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
                userIds: admin.firestore.FieldValue.arrayUnion(...followerIds),
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
    chatLink
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
        }
        console.log('Finished processing stream chunks:', {
            totalChunks: chunkCount,
            finalCommentLength: commentText.length,
        })

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
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
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
    assistantName
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
                  chatLink
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
    return assistant
}

// New function to get task-level settings or fall back to assistant settings
async function getTaskOrAssistantSettings(projectId, taskId, assistantId) {
    console.log('getTaskOrAssistantSettings called with:', { projectId, taskId, assistantId })

    // Get task data first
    const taskRef = admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`)
    const taskDoc = await taskRef.get()
    const task = taskDoc.data()
    console.log('Task data:', task)

    // Get assistant settings
    const assistant = await getAssistantForChat(projectId, assistantId)
    console.log('Assistant data:', assistant)

    // Return task settings if they exist, otherwise use assistant settings with defaults
    const settings = {
        model: (task && task.aiModel) || assistant.model || 'MODEL_GPT3_5',
        temperature: (task && task.aiTemperature) || assistant.temperature || 'TEMPERATURE_NORMAL',
        instructions: (task && task.aiSystemMessage) || assistant.instructions || 'You are a helpful assistant.',
        displayName: assistant.displayName, // Always use assistant's display name
        uid: assistant.uid, // Always use assistant's uid
    }

    console.log('Final settings:', settings)
    return settings
}

function addBaseInstructions(messages, name, language, instructions) {
    messages.push(['system', `Your responses must be limited to ${COMPLETION_MAX_TOKENS} tokens.`])
    messages.push(['system', `You are an AI assistant  and your name is: "${parseTextForUseLiKePrompt(name || '')}"`])
    messages.push(['system', `Speak in ${parseTextForUseLiKePrompt(language || 'English')}`])
    messages.push(['system', `The current date is ${moment().format('dddd, MMMM Do YYYY, h:mm:ss a')}`])
    messages.push([
        'system',
        'Always left a space between links and words. Do not wrap links inside [],{{}},() or any other characters',
    ])
    if (instructions) messages.push(['system', parseTextForUseLiKePrompt(instructions)])
}

function parseTextForUseLiKePrompt(text) {
    if (!text) return ''
    return text.replaceAll('{', '{{').replaceAll('}', '}}')
}

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
}
