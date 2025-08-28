import { uniq } from 'lodash'
import { firebase } from '@firebase/app'
import moment from 'moment'

import store from '../../../redux/store'
import {
    addGuideToTemplateFeedsChain,
    getDb,
    getProjectData,
    runHttpsCallableFunction,
    uploadNewGuideProject,
    getId,
    addFollowerWithoutFeeds,
    generateSortIndex,
    getAnalyticsVariables,
} from '../firestore'
import ProjectHelper, { MAX_USERS_IN_GUIDES } from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { setLanguage, translate } from '../../../i18n/TranslationService'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import HelperFunctions from '../../HelperFunctions'
import { MENTION_SPACE_CODE, STAYWARD_COMMENT } from '../../../components/Feeds/Utils/HelperFunctions'
import { addUserToProject, getUserData } from '../Users/usersFirestore'
import { createChat, addFollowerToChat } from '../Chats/chatsComments'
import { getChatMeta } from '../Chats/chatsFirestore'

export const GUIDE_MAIN_CHAT_ID = 'guideMainChatId'

async function getLastGuideProject(guideIds) {
    const lastGuideId = guideIds[guideIds.length - 1]
    return lastGuideId ? await getProjectData(lastGuideId) : null
}

function checkIfThereIsSpaceForNewUsersInLastGuide(template, lastGuide) {
    if (!lastGuide) return false

    const { administratorUser } = store.getState()
    const { templateCreatorId } = template
    const creatorIsInGuide = lastGuide.userIds.includes(templateCreatorId)
    const adminIsNotCreator = administratorUser.uid !== templateCreatorId
    const adminIsInGuideAndIsNotCreator = adminIsNotCreator && template.userIds.includes(administratorUser.uid)

    let maxUsers = MAX_USERS_IN_GUIDES
    if (creatorIsInGuide) maxUsers++
    if (adminIsInGuideAndIsNotCreator) maxUsers++

    const thereIsSpaceForNewUsersInLastGuide = lastGuide.userIds.length < maxUsers
    return thereIsSpaceForNewUsersInLastGuide
}

function generateGuide(template) {
    const { loggedUser } = store.getState()
    const sortIndex = generateSortIndex()
    const guide = ProjectHelper.getNewDefaultProject()
    guide.name = `${template.name} ${template.guideProjectIds.length + 1}`
    guide.color = template.color
    guide.parentTemplateId = template.id
    guide.creatorId = template.templateCreatorId
    guide.globalAssistantIds = [...template.globalAssistantIds]
    guide.workstreamIds = []
    guide.sortIndexByUser = { [template.templateCreatorId]: sortIndex, [loggedUser.uid]: sortIndex }
    return guide
}

async function addGuideToTemplate(template, guideId) {
    const db = getDb()
    const batch = new BatchWrapper(db)
    batch.update(db.doc(`projects/${guideId}`), { parentTemplateId: template.id })
    batch.update(db.doc(`projects/${template.id}`), {
        guideProjectIds: firebase.firestore.FieldValue.arrayUnion(guideId),
    })
    await batch.commit()
    addGuideToTemplateFeedsChain(template, guideId)
}

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
    const { GOOGLE_ADS_GUIDE_CONVERSION_TAG } = getAnalyticsVariables()
    if (GOOGLE_ADS_GUIDE_CONVERSION_TAG) gtag('event', 'conversion', { send_to: GOOGLE_ADS_GUIDE_CONVERSION_TAG })
}

async function tryToAddCreatorUser(guide, templateCreatorId, projectUsersIdsForSpecialFeeds, specialUserIds) {
    const needsToAddTheCreator = !guide.userIds.includes(templateCreatorId)
    if (needsToAddTheCreator) {
        await addUserToProject(
            templateCreatorId,
            guide,
            guide.id,
            false,
            projectUsersIdsForSpecialFeeds,
            specialUserIds
        )
    }
}

async function tryToAddAdminUser(guide, templateCreatorId, projectUsersIdsForSpecialFeeds, specialUserIds) {
    const { administratorUser } = store.getState()
    const needsToAddTheAdmin =
        administratorUser.uid !== templateCreatorId && !guide.userIds.includes(administratorUser.uid)
    if (needsToAddTheAdmin) {
        await addUserToProject(
            administratorUser.uid,
            guide,
            guide.id,
            false,
            projectUsersIdsForSpecialFeeds,
            specialUserIds
        )
    }
}

async function addUsersToGuide(userId, guide, template, isNewGuide) {
    const { administratorUser } = store.getState()
    const { templateCreatorId } = template
    const projectUsersIdsForSpecialFeeds = uniq([...guide.userIds, userId, administratorUser.uid, templateCreatorId])
    const specialUserIds = isNewGuide ? [...projectUsersIdsForSpecialFeeds] : null

    addFollowerWithoutFeeds(guide.id, userId, 'topics', GUIDE_MAIN_CHAT_ID, null, null)
    addFollowerToChat(guide.id, GUIDE_MAIN_CHAT_ID, userId)

    const promises = []
    promises.push(addUserToProject(userId, guide, guide.id, false, projectUsersIdsForSpecialFeeds, specialUserIds))
    promises.push(tryToAddCreatorUser(guide, templateCreatorId, projectUsersIdsForSpecialFeeds, specialUserIds))
    promises.push(tryToAddAdminUser(guide, templateCreatorId, projectUsersIdsForSpecialFeeds, specialUserIds))

    await Promise.all(promises)
}

async function setUsersAndObjectsWhenUserJoinsToAGuide(userId, template, guide, isNewGuide, unlockedTemplate) {
    await addUsersToGuide(userId, guide, template, isNewGuide)
    const promises = []
    promises.push(copyTemplateObjects(template, guide.id, unlockedTemplate, isNewGuide))
    promises.push(sendUserJoinsToGuideEmail(template.templateCreatorId, guide.id, userId))
    await addWelcomeChatToGuideUser(
        guide.id,
        template.name,
        template.templateCreatorId,
        guide.userIds,
        guide.assistantId
    )
    await Promise.all(promises)

    logGuideConversionEvent()
}

async function addUserToLastGuide(userId, template, lastGuide, unlockedTemplate) {
    const mainChat = await getChatMeta(lastGuide.id, GUIDE_MAIN_CHAT_ID)
    const promises = []
    promises.push(setUsersAndObjectsWhenUserJoinsToAGuide(userId, template, lastGuide, false, unlockedTemplate))
    await Promise.all(promises)
    if (!mainChat) await addWelcomeChatToGuide(lastGuide, template.name, template.templateCreatorId)
}

async function uploadNewGuide(template, projectUsersIdsForSpecialFeeds) {
    const guide = generateGuide(template)
    guide.id = await uploadNewGuideProject(guide, template.assistantId, projectUsersIdsForSpecialFeeds)
    return guide
}

async function addUserToNewGuide(userId, template, unlockedTemplate) {
    const { administratorUser } = store.getState()
    const guide = await uploadNewGuide(template, uniq([userId, administratorUser.uid, template.templateCreatorId]))
    await addGuideToTemplate(template, guide.id)
    const promises = []
    promises.push(setUsersAndObjectsWhenUserJoinsToAGuide(userId, template, guide, true, unlockedTemplate))
    await Promise.all(promises)
    await addWelcomeChatToGuide(guide, template.name, template.templateCreatorId)
}

async function addUserToGuide(userId, template, unlockedTemplate) {
    const lastGuide = await getLastGuideProject(template.guideProjectIds)
    const thereIsSpaceForNewUsersInLastGuide = checkIfThereIsSpaceForNewUsersInLastGuide(template, lastGuide)

    thereIsSpaceForNewUsersInLastGuide
        ? await addUserToLastGuide(userId, template, lastGuide, unlockedTemplate)
        : await addUserToNewGuide(userId, template, unlockedTemplate)
}

export async function addUserToTemplate(userId, template, unlockedTemplate) {
    const { administratorUser, loggedUser } = store.getState()
    const userIsAdministrator = administratorUser.uid === userId
    setLanguage(loggedUser.language)
    userIsAdministrator
        ? await addUserToProject(userId, template, template.id, true, null, null)
        : await addUserToGuide(userId, template, unlockedTemplate)
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
