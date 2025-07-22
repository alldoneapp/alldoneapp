import {
    FEED_PUBLIC_FOR_ALL,
    FEED_ASSISTANT_CREATED,
    FEED_ASSISTANT_DELETED,
    FEED_ASSISTANT_NAME_CHANGED,
    FEED_ASSISTANT_DESCRIPTION_CHANGED,
    FEED_ASSISTANT_FOLLOWED,
    FEED_ASSISTANT_UNFOLLOWED,
    FEED_ASSISTANT_PICTURE_CHANGED,
    FEED_ASSISTANT_TYPE_CHANGED,
    FEED_ASSISTANT_INSTRUCTIONS_CHANGED,
    FEED_ASSISTANT_MODEL_CHANGED,
    FEED_ASSISTANT_TEMPERATURE_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
import { FOLLOWER_ASSISTANTS_TYPE } from '../../../components/Followers/FollowerConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../HelperFunctions'
import store from '.././../../redux/store'
import {
    cleanInnerFeeds,
    cleanNewFeeds,
    cleanStoreFeeds,
    generateCurrentDateObject,
    generateFeedModel,
    getDb,
    getProjectUsersIds,
    globalInnerFeedsGenerator,
    increaseFeedCount,
    loadFeedObject,
    processLocalFeeds,
    setFeedObjectLastState,
    storeOldFeeds,
    tryAddFollower,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    MODEL_GPT3_5,
    MODEL_GPT4,
    MODEL_GPT4O,
    TEMPERATURE_HIGH,
    TEMPERATURE_LOW,
    TEMPERATURE_NORMAL,
    TEMPERATURE_VERY_HIGH,
    TEMPERATURE_VERY_LOW,
    TYPE_3RD_PARTY,
    TYPE_PROMPT_BASED,
    isGlobalAssistant,
    MODEL_SONAR,
    MODEL_SONAR_PRO,
    MODEL_SONAR_REASONING,
    MODEL_SONAR_REASONING_PRO,
    MODEL_SONAR_DEEP_RESEARCH,
} from '../../../components/AdminPanel/Assistants/assistantsHelper'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

//COMMON

const starFollowingAssistant = async (projectId, assistant, batch) => {
    const { loggedUser } = store.getState()
    const followData = {
        followObjectsType: FOLLOWER_ASSISTANTS_TYPE,
        followObjectId: assistant.uid,
        feedCreator: loggedUser,
        followObject: assistant,
    }
    await tryAddFollower(projectId, followData, batch)
}

export function generateAssistantObjectModel(currentMilliseconds, assistant, objectId) {
    return {
        type: 'assistant',
        lastChangeDate: currentMilliseconds,
        name: assistant ? assistant.displayName : 'Generic update',
        isDeleted: false,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        assistantId: objectId,
        photoURL: assistant ? assistant.photoURL50 : '',
    }
}

function updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, params, batch) {
    const { objectId, creatorId } = feed
    storeOldFeeds(projectId, currentDateFormated, objectId, assistantFeedObject, feedId, feed)
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[objectId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [objectId]: [creatorId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, objectId, 'assistants')
        cleanInnerFeeds(projectId, creatorId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${objectId}`)
    batch.set(feedObjectRef, assistantFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'assistants', objectId, assistantFeedObject, batch)
    processLocalFeeds(projectId, assistantFeedObject, objectId, feed, feedId, params)
}

//UPDATES

async function createAssistantCreatedFeed(projectId, assistant, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const assistantFeedObject = generateAssistantObjectModel(currentMilliseconds, assistant, assistant.uid)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: `created assistant`,
        feedCreator,
        objectId: assistant.uid,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [assistant.uid]: assistantFeedObject }

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistant.uid,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistant.uid, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createAssistantDeletedFeed(projectId, assistantId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: 'deleted assistant',
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    assistantFeedObject.isDeleted = true
    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createAssistantNameChangedFeed(projectId, oldName, newName, assistantId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_NAME_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant name • From ${oldName} to ${newName}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    assistantFeedObject.displayName = newName
    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createAssistantDescriptionChangedFeed(
    projectId,
    oldDescription,
    newDescription,
    assistantId,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(oldDescription, true), 50)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createAssistantPictureChangedFeed(projectId, assistantId, photoURL, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_PICTURE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })
    feed.newPhotoURL = photoURL
    feed.oldPhotoURL = assistantFeedObject.photoURL
    assistantFeedObject.photoURL = photoURL
    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

const getTypeText = typeKey => {
    if (typeKey === TYPE_PROMPT_BASED) return 'Prompt based'
    if (typeKey === TYPE_3RD_PARTY) return '3rd party'
    return ''
}

async function createAssistantTypeChangedFeed(projectId, oldType, newType, assistantId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_TYPE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant type • From ${getTypeText(oldType)} to ${getTypeText(newType)}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createAssistantInstructionsChangedFeed(
    projectId,
    oldInstructions,
    newInstructions,
    assistantId,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_INSTRUCTIONS_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant instructions • From ${oldInstructions} to ${newInstructions}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

const getModelText = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 'GPT 3_5'
    if (modelKey === MODEL_GPT4) return 'GPT 4'
    if (modelKey === MODEL_GPT4O) return 'GPT 4o'
    if (modelKey === MODEL_SONAR) return 'Sonar'
    if (modelKey === MODEL_SONAR_PRO) return 'Sonar Pro'
    if (modelKey === MODEL_SONAR_REASONING) return 'Sonar Reasoning'
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 'Sonar Reasoning Pro'
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 'Sonar Deep Research'

    return modelKey || ''
}

async function createAssistantModelChangedFeed(projectId, oldModel, newModel, assistantId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_MODEL_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant model • From ${getModelText(oldModel)} to ${getModelText(newModel)}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

const getTemperature = temperatureKey => {
    if (temperatureKey === TEMPERATURE_VERY_LOW) return 0.2
    else if (temperatureKey === TEMPERATURE_LOW) return 0.5
    else if (temperatureKey === TEMPERATURE_NORMAL) return 0.7
    else if (temperatureKey === TEMPERATURE_HIGH) return 1
    else if (temperatureKey === TEMPERATURE_VERY_HIGH) return 1.3
    return ''
}

async function createAssistantTemperatureChangedFeed(
    projectId,
    oldTemperature,
    newTemperature,
    assistantId,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_TEMPERATURE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant temperature • From ${getTemperature(oldTemperature)} to ${getTemperature(
            newTemperature
        )}`,
        feedCreator,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkAssistantFeed(
    projectId,
    objectId,
    objectType,
    assistantId,
    feedType,
    externalBatch
) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: assistantId,
    })
    feed.linkTag = objectLink

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createAssistantFollowedFeed(projectId, assistantId, userFollowingId, externalBatch, creator) {
    const feedCreator =
        creator && creator?.displayName ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the assistant',
        feedCreator,
        objectId: assistantId,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createAssistantUnfollowedFeed(projectId, assistantId, externalBatch, creator) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const assistantFeedObject = await loadFeedObject(
        projectId,
        assistantId,
        'assistants',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the assistant',
        feedCreator,
        objectId: assistantId,
    })

    updateAssistantFeedObject(projectId, currentDateFormated, assistantFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'assistants',
        assistantId,
        batch,
        feedId,
        feed,
        assistantFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'assistants', assistantId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

//CHAINS

export async function createAssistantUpdatesChain(projectId, assistant) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantCreatedFeed(projectId, assistant, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export const updateAssistantFeedsChain = async (projectId, updatedAssistant, oldAssistant) => {
    if (isGlobalAssistant(updatedAssistant)) return

    const batch = new BatchWrapper(getDb())

    if (updatedAssistant.displayName !== oldAssistant.displayName) {
        await createAssistantNameChangedFeed(
            projectId,
            oldAssistant.displayName,
            updatedAssistant.displayName,
            updatedAssistant.uid,
            batch
        )
    }
    await starFollowingAssistant(projectId, updatedAssistant, batch)

    batch.commit()
}

export async function deleteAssistantUpdatesChain(projectId, assistant) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantDeletedFeed(projectId, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantNameChangedUpdatesChain(projectId, assistant, oldName, newName) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantNameChangedFeed(projectId, oldName, newName, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantDescriptionChangedUpdatesChain(projectId, assistant, oldDescription, newDescription) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantDescriptionChangedFeed(projectId, oldDescription, newDescription, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantPictureChangedUpdatesChain(projectId, assistant, photoURL) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantPictureChangedFeed(projectId, assistant.uid, photoURL, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantTypeChangedUpdatesChain(projectId, assistant, oldType, newType) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantTypeChangedFeed(projectId, oldType, newType, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantInstructionsChangedUpdatesChain(projectId, assistant, oldIstructions, newInstructions) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantInstructionsChangedFeed(projectId, oldIstructions, newInstructions, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantModelChangedUpdatesChain(projectId, assistant, oldModel, newModel) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantModelChangedFeed(projectId, oldModel, newModel, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}

export async function assistantTemperatureChangedUpdatesChain(projectId, assistant, oldTemperature, newTemperature) {
    if (isGlobalAssistant(assistant)) return

    const batch = new BatchWrapper(getDb())
    await createAssistantTemperatureChangedFeed(projectId, oldTemperature, newTemperature, assistant.uid, batch)
    await starFollowingAssistant(projectId, assistant, batch)
    batch.commit()
}
