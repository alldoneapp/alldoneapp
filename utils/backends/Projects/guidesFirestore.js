import { uniq } from 'lodash'
import moment from 'moment'
import momentTz from 'moment-timezone'

import store from '../../../redux/store'
import {
    createGuideCreatedFeedChain,
    getDb,
    getProjectData,
    runHttpsCallableFunction,
    getId,
    addFollowerWithoutFeeds,
} from '../firestore'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { setLanguage, translate } from '../../../i18n/TranslationService'
import HelperFunctions from '../../HelperFunctions'
import { MENTION_SPACE_CODE, STAYWARD_COMMENT } from '../../../components/Feeds/Utils/HelperFunctions'
import {
    createProjectJoinFeeds,
    getUserData,
    joinProjectOnServer,
    loadJoinedProjectIntoStore,
} from '../Users/usersFirestore'
import { createChat, addFollowerToChat } from '../Chats/chatsComments'
import { getChatMeta } from '../Chats/chatsFirestore'
import { trackEvent } from '../../analytics/analytics'

export const GUIDE_MAIN_CHAT_ID = 'guideMainChatId'

async function sendUserJoinsToGuideEmail(templateCreatorId, guideId, newUserId) {
    const { administratorUser } = store.getState()
    const usersToReceiveEmailIds = uniq([templateCreatorId, administratorUser.uid])
    const data = { usersToReceiveEmailIds, guideId, newUserId }
    await runHttpsCallableFunction('sendUserJoinsToGuideEmailSecondGen', data)
}

async function copyTemplateObjects(template, guideId, unlockedTemplate, isNewGuide) {
    const { loggedUser } = store.getState()
    const data = {
        templateId: template.id,
        creatorId: template.templateCreatorId,
        guideId,
        userId: loggedUser.uid,
        userName: loggedUser.displayName,
        userPhotoUrl: loggedUser.photoURL,
        dateMiddleOfDay: moment().startOf('day').hour(12).minute(0).valueOf(),
        dateNow: Date.now(),
        unlockedTemplate,
        isNewGuide,
        globalAssistantIds: template.globalAssistantIds,
    }

    return await runHttpsCallableFunction('copyTemplateObjectsSecondGen', data)
}

async function createWelcomeChatToGuideUser(guideId, creator, assistantId) {
    const { uid: creatorId } = creator
    const { loggedUser } = store.getState()

    const mentionText = `@${loggedUser.displayName.replaceAll(' ', MENTION_SPACE_CODE)}`
    const mextionTextExtended = `${mentionText}#${loggedUser.uid}`

    const chatName = `${translate('Welcome')} ${mextionTextExtended}`

    const chatId = getId()
    await createChat(
        chatId,
        guideId,
        creatorId,
        '',
        'topics',
        chatName,
        [FEED_PUBLIC_FOR_ALL],
        '#FFFFFF',
        null,
        null,
        '',
        assistantId,
        STAYWARD_COMMENT,
        creatorId
    )

    return chatId
}

async function addWelcomeMessageToGuideUser(
    guideId,
    projectName,
    chatId,
    projectUserIds,
    templateCreatorId,
    assistantId
) {
    const { loggedUser, administratorUser, defaultAssistant } = store.getState()

    const userIdsToNotify = uniq([...projectUserIds, loggedUser.uid, administratorUser.uid, templateCreatorId])

    await runHttpsCallableFunction('generateBotWelcomeMessageToUserSecondGen', {
        projectId: guideId,
        objectId: chatId,
        userIdsToNotify,
        guideName: projectName,
        language: window.navigator.language,
        userId: loggedUser.uid,
        userName: HelperFunctions.getFirstName(loggedUser.displayName),
        taskListUrlOrigin: window.location.origin,
        assistantId: assistantId || defaultAssistant.uid,
    })
}

async function createWelcomeChatToGuide(guideId, creator, followerIds, assistantId) {
    const { uid: creatorId } = creator

    const days = 99 * 365

    await createChat(
        GUIDE_MAIN_CHAT_ID,
        guideId,
        creatorId,
        '',
        'topics',
        'Team Chat',
        [FEED_PUBLIC_FOR_ALL],
        '#FFFFFF',
        { days, stickyEndDate: moment().add(days, 'days').valueOf() },
        followerIds,
        '',
        assistantId,
        STAYWARD_COMMENT,
        creatorId
    )
}

async function addWelcomeMessageToGuide(guideId, projectName, chatId, projectUserIds, templateCreatorId, assistantId) {
    const { loggedUser, administratorUser, defaultAssistant } = store.getState()

    const userIdsToNotify = uniq([...projectUserIds, loggedUser.uid, administratorUser.uid, templateCreatorId])

    await runHttpsCallableFunction('generateBotWelcomeMessageSecondGen', {
        projectId: guideId,
        objectId: chatId,
        userIdsToNotify,
        guideName: projectName,
        language: 'english',
        assistantId: assistantId || defaultAssistant.uid,
    })
}

async function addWelcomeChatToGuide(guide, projectName, templateCreatorId) {
    const creator = await getUserData(templateCreatorId, false)

    const { loggedUser, administratorUser } = store.getState()

    const followerIds = uniq([...guide.userIds, creator.uid, administratorUser.uid, loggedUser.uid])

    await createWelcomeChatToGuide(guide.id, creator, followerIds, guide.assistantId)
    await addWelcomeMessageToGuide(
        guide.id,
        projectName,
        GUIDE_MAIN_CHAT_ID,
        guide.userIds,
        templateCreatorId,
        guide.assistantId
    )
}

async function addWelcomeChatToGuideUser(guideId, projectName, templateCreatorId, projectUserIds, assistantId) {
    const creator = await getUserData(templateCreatorId, false)
    const chatId = await createWelcomeChatToGuideUser(guideId, creator, assistantId)
    await addWelcomeMessageToGuideUser(guideId, projectName, chatId, projectUserIds, templateCreatorId, assistantId)
}

function logGuideConversionEvent() {
    trackEvent('generate_lead', { source: 'guide' })
}

/**
 * Adds the logged user to a template: the administrator joins the template itself, everybody else a
 * guide of it with room, or a new guide. Which guide, and the membership of the user, the template's
 * creator and the administrator, are decided and written by joinProjectSecondGen; a user who is not
 * yet a member could not write any of it (firestore.rules). What follows here is written as a member
 * of the guide: feeds, followers, the welcome chats and the copy of the template's objects.
 */
export async function addUserToTemplate(userId, template, unlockedTemplate) {
    const { loggedUser } = store.getState()
    setLanguage(loggedUser.language)

    const result = await joinProjectOnServer(template.id, {
        startGuide: true,
        timezone: loggedUser.preferredTimezone || momentTz.tz.guess(),
    })
    const joinedProjectId = result?.projectId || template.id
    await loadJoinedProjectIntoStore(joinedProjectId)

    const addedUserIds = Array.isArray(result?.addedUserIds) ? result.addedUserIds : []
    if (!addedUserIds.includes(userId)) return

    if (joinedProjectId === template.id) {
        await createProjectJoinFeeds(userId, { ...template, userIds: result.previousUserIds || [] }, template.id)
        return
    }

    await setUpJoinedGuide(userId, template, joinedProjectId, result, unlockedTemplate)
}

async function setUpJoinedGuide(userId, template, guideId, result, unlockedTemplate) {
    const { administratorUser } = store.getState()
    const { templateCreatorId } = template
    const isNewGuide = !!result.isNewGuide
    const previousUserIds = result.previousUserIds || []

    const guideData = await getProjectData(guideId)
    const guide = { ...guideData, id: guideId }
    const guideBeforeJoin = { ...guide, userIds: previousUserIds }

    const projectUsersIdsForSpecialFeeds = uniq([...previousUserIds, userId, administratorUser.uid, templateCreatorId])
    const specialUserIds = isNewGuide ? [...projectUsersIdsForSpecialFeeds] : null

    const mainChat = isNewGuide ? null : await getChatMeta(guideId, GUIDE_MAIN_CHAT_ID)

    if (isNewGuide) await createGuideCreatedFeedChain(guide, projectUsersIdsForSpecialFeeds)

    addFollowerWithoutFeeds(guideId, userId, 'topics', GUIDE_MAIN_CHAT_ID, null, null)
    addFollowerToChat(guideId, GUIDE_MAIN_CHAT_ID, userId)
    await Promise.all(
        result.addedUserIds.map(addedUserId =>
            createProjectJoinFeeds(
                addedUserId,
                guideBeforeJoin,
                guideId,
                projectUsersIdsForSpecialFeeds,
                specialUserIds
            ).catch(error => console.warn('[Guides] Could not write the join activity:', error))
        )
    )

    const promises = []
    promises.push(copyTemplateObjects(template, guideId, unlockedTemplate, isNewGuide))
    promises.push(sendUserJoinsToGuideEmail(templateCreatorId, guideId, userId))
    await addWelcomeChatToGuideUser(guideId, template.name, templateCreatorId, previousUserIds, guide.assistantId)
    await Promise.all(promises)

    logGuideConversionEvent()

    if (!mainChat) await addWelcomeChatToGuide(guideBeforeJoin, template.name, templateCreatorId)
}

export async function checkIfUserIsAlreadyInTemplateGuide(userId, templateId) {
    const projectDocs = (
        await getDb()
            .collection('projects')
            .where('parentTemplateId', '==', templateId)
            .where('userIds', 'array-contains', userId)
            .limit(1)
            .get()
    ).docs
    return projectDocs.length > 0
}
