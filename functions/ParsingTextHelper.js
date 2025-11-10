const { ALL_USERS, DYNAMIC_PERCENT } = require('./Utils/HelperFunctionsCloud')
const { removeColor } = require('./Utils/hashtagUtils')
const { getMentionData, getVideoData, getImageData, getAttachmentData } = require('./Utils/parseTextUtils')

const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER

const REGEX_KARMA = /^pMP4SB2IsTQr8LN[\S]+/
const REGEX_VIDEO = /^ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+/
const REGEX_IMAGE = /^O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+/
const REGEX_ATTACHMENT = /^EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+/
const REGEX_GENERIC = /^(&[\S]+)$/i
const REGEX_HASHTAG = /(^|\s)(#[\S]+)$/i
const REGEX_MENTION = /^(@[\S]+)$/i
const REGEX_URL = /^https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|^www\.[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|^https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}|^www\.[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}|^http:\/\/localhost:[0-9]+\/[^\s]{2,}$/i

const MENTION_SPACE_CODE_REGEX = /M2mVOSjAVPPKweL/g

const FEED_PUBLIC_FOR_ALL = 0

const parseTextForSearch = (text, removeLineBreaks) => {
    const linealText = removeLineBreaks ? text.replace(/(\r\n|\n|\r)/gm, ' ') : text
    const words = linealText.split(' ')
    for (let i = 0; i < words.length; i++) {
        const word = words[i]
        if (REGEX_ATTACHMENT.test(word)) {
            const { attachmentText } = getAttachmentData(word)
            words[i] = attachmentText
        } else if (REGEX_IMAGE.test(word)) {
            const { imageText } = getImageData(word)
            words[i] = imageText
        } else if (REGEX_VIDEO.test(word)) {
            const { videoText } = getVideoData(word)
            words[i] = videoText
        } else if (REGEX_MENTION.test(word)) {
            const { mentionText } = getMentionData(word, true)
            words[i] = mentionText.replace('@', '')
        } else if (REGEX_HASHTAG.test(word)) {
            words[i] = removeColor(word)
        } else if (REGEX_GENERIC.test(word)) {
            words[i] = ''
        } else if (REGEX_URL.test(word)) {
            words[i] = ''
        } else if (REGEX_KARMA.test(word)) {
            words[i] = 'Karma'
        }
    }
    return words.join(' ')
}

const getObjectNameWithoutMeta = (taskName, removeLineBreaks) => {
    const linealText = removeLineBreaks ? taskName.replace(/(\r\n|\n|\r)/gm, ' ') : taskName
    const words = linealText.split(' ')
    for (let i = 0; i < words.length; i++) {
        // sanitize mentions
        if (words[i].startsWith('@')) {
            const parts = words[i].split('#')
            if (parts.length === 2 && parts[1].trim().length >= 0) {
                words[i] = parts[0].replace(MENTION_SPACE_CODE_REGEX, ' ')
            } else {
                words[i] = words[i].replace(MENTION_SPACE_CODE_REGEX, ' ')
            }
        }
    }
    return words.join(' ')
}

const mapTaskData = (taskId, algoliaObjectId, task, projectId) => {
    const extendedName = task.extendedName ? task.extendedName : task.name ? task.name : ''
    return {
        objectID: algoliaObjectId,
        projectId: projectId,
        id: taskId,
        userId: task.userId ? task.userId : '',
        extendedName: extendedName,
        name: parseTextForSearch(extendedName, true),
        humanReadableId: task.humanReadableId || '',
        created: task.created ? task.created : Date.now(),
        done: task.done || task.parentDone ? true : false,
        isPrivate: task.isPrivate ? task.isPrivate : false,
        isPublicFor: task.isPublicFor ? task.isPublicFor : [FEED_PUBLIC_FOR_ALL, task.userId],
        lastEditionDate: task.lastEditionDate ? task.lastEditionDate : Date.now(),
    }
}

const mapGoalData = (goalId, algoliaObjectId, goal, projectId, canBeInactive) => {
    const extendedName = goal.extendedName ? goal.extendedName : goal.name ? goal.name : ''
    return {
        objectID: algoliaObjectId,
        projectId: projectId,
        id: goal.id ? goal.id : goalId,
        extendedName: extendedName,
        progress: goal.progress >= 0 ? goal.progress : DYNAMIC_PERCENT,
        dynamicProgress: goal.dynamicProgress ? goal.dynamicProgress : 0,
        assigneesIds: goal.assigneesIds ? goal.assigneesIds : [],
        created: goal.created ? goal.created : Date.now(),
        name: parseTextForSearch(extendedName, true),
        startingMilestoneDate: goal.startingMilestoneDate ? goal.startingMilestoneDate : BACKLOG_DATE_NUMERIC,
        completionMilestoneDate: goal.completionMilestoneDate ? goal.completionMilestoneDate : BACKLOG_DATE_NUMERIC,
        isPublicFor: goal.isPublicFor ? goal.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        ownerId: goal.ownerId ? goal.ownerId : ALL_USERS,
        lockKey: goal.lockKey ? goal.lockKey : '',
        lastEditionDate: goal.lastEditionDate ? goal.lastEditionDate : Date.now(),
        canBeInactive,
    }
}

const mapNoteData = (noteId, algoliaObjectId, note, projectId) => {
    const extendedTitle = note.extendedTitle ? note.extendedTitle : note.title ? note.title : ''

    // Only log once at the start of mapping
    if (!note._loggedForMapping) {
        console.log(`Mapping note data for Algolia (${noteId}):`, {
            title: note.title,
            extendedTitle: note.extendedTitle,
            hasContent: !!note.content,
            contentLength: note.content ? note.content.length : 0,
        })
        note._loggedForMapping = true
    }

    const mappedNote = {
        objectID: algoliaObjectId,
        projectId: projectId,
        id: note.id ? note.id : noteId,
        extendedTitle: extendedTitle,
        userId: note.userId ? note.userId : '',
        title: parseTextForSearch(extendedTitle, true),
        content: note.content ? parseTextForSearch(note.content, true) : '',
        lastEditionDate: note.lastEditionDate ? note.lastEditionDate : Date.now(),
        isPrivate: note.isPrivate ? note.isPrivate : false,
        isPublicFor: note.isPublicFor ? note.isPublicFor : [FEED_PUBLIC_FOR_ALL, note.userId],
        parentObject: note.parentObject ? note.parentObject : null,
    }

    return mappedNote
}

const mapChatData = (chatId, algoliaObjectId, chat, projectId, customData) => {
    const title = chat.title ? chat.title : chat.name ? chat.name : ''
    const chatObj = {
        objectID: algoliaObjectId,
        projectId: projectId,
        id: chatId,
        name: title,
        cleanName: parseTextForSearch(title, true),
        lastEditionDate: chat.lastEditionDate ? chat.lastEditionDate : Date.now(),
        isPublicFor: chat.isPublicFor ? chat.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        ...customData,
    }

    return chat.type ? { ...chatObj, type: chat.type } : chatObj
}

const mapContactData = (contactId, algoliaObjectId, contact, projectId) => {
    const extendedDescription = contact.extendedDescription
        ? contact.extendedDescription
        : contact.description
        ? contact.description
        : ''
    return {
        objectID: algoliaObjectId,
        projectId: projectId,
        cleanDescription: parseTextForSearch(extendedDescription, true),
        uid: contactId,
        displayName: contact.displayName ? contact.displayName : '',
        recorderUserId: contact.recorderUserId ? contact.recorderUserId : '',
        photoURL: contact.photoURL ? contact.photoURL : '',
        photoURL50: contact.photoURL50 ? contact.photoURL50 : '',
        photoURL300: contact.photoURL300 ? contact.photoURL300 : '',
        company: contact.company ? contact.company : '',
        role: contact.role ? contact.role : '',
        description: contact.description ? contact.description : '',
        extendedDescription: extendedDescription,
        lastEditionDate: contact.lastEditionDate ? contact.lastEditionDate : Date.now(),
        isPrivate: contact.isPrivate ? contact.isPrivate : false,
        isPublicFor: contact.isPublicFor ? contact.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        isAssistant: false,
    }
}

const mapAssistantData = (algoliaObjectId, assistant, assistantId, projectId) => {
    return {
        objectID: algoliaObjectId,
        projectId: projectId,
        uid: assistantId,
        displayName: assistant.displayName ? assistant.displayName : '',
        photoURL: assistant.photoURL ? assistant.photoURL : '',
        photoURL50: assistant.photoURL50 ? assistant.photoURL50 : '',
        photoURL300: assistant.photoURL300 ? assistant.photoURL300 : '',
        description: assistant.description ? assistant.description : '',
        lastEditionDate: assistant.lastEditionDate ? assistant.lastEditionDate : Date.now(),
        isPrivate: false,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        isAssistant: true,
    }
}

const mapUserData = (userId, user) => {
    const extendedDescription = user.extendedDescription
        ? user.extendedDescription
        : user.description
        ? user.description
        : ''
    return {
        cleanDescription: '',
        uid: userId,
        displayName: user.displayName ? user.displayName : '',
        photoURL: user.photoURL ? user.photoURL : '',
        extendedDescription: extendedDescription,
        description: user.description ? user.description : '',
        isPrivate: user.isPrivate ? user.isPrivate : false,
        isPublicFor: user.isPublicFor ? user.isPublicFor : [FEED_PUBLIC_FOR_ALL, userId],
        projectIds: user.projectIds ? user.projectIds : [],
        lastEditionDate: user.lastEditionDate ? user.lastEditionDate : Date.now(),
        company: user.company ? user.company : '',
        role: user.role ? user.role : '',
        isAssistant: false,
    }
}

module.exports = {
    mapTaskData,
    mapGoalData,
    mapNoteData,
    mapContactData,
    mapUserData,
    mapChatData,
    mapAssistantData,
    parseTextForSearch,
    getObjectNameWithoutMeta,
}
