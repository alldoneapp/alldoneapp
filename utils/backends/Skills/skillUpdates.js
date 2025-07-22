import { isEqual, uniq } from 'lodash'

import {
    FEED_PUBLIC_FOR_ALL,
    FEED_SKILL_CHANGES_POINTS,
    FEED_SKILL_CREATED,
    FEED_SKILL_DELETED,
    FEED_SKILL_DESCRIPTION_CHANGED,
    FEED_SKILL_FOLLOWED,
    FEED_SKILL_HIGHLIGHTED_CHANGED,
    FEED_SKILL_PRIVACY_CHANGED,
    FEED_SKILL_PROJECT_CHANGED,
    FEED_SKILL_TITLE_CHANGED,
    FEED_SKILL_UNFOLLOWED,
    FEED_SKILL_COMPLETION_CHANGED,
    FEED_SKILL_ASSISTANT_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
import { FOLLOWER_SKILLS_TYPE } from '../../../components/Followers/FollowerConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../HelperFunctions'
import store from '.././../../redux/store'
import {
    addPrivacyForFeedObject,
    cleanInnerFeeds,
    cleanNewFeeds,
    cleanStoreFeeds,
    generateCurrentDateObject,
    generateFeedModel,
    getDb,
    getMentionedUsersIdsWhenEditText,
    getProjectUsersIds,
    globalInnerFeedsGenerator,
    increaseFeedCount,
    insertFollowersUserToFeedChain,
    loadFeedObject,
    processFollowersWhenEditTexts,
    processLocalFeeds,
    setFeedObjectLastState,
    storeOldFeeds,
    tryAddFollower,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

//COMMON

const starFollowingSkill = async (projectId, skill, batch) => {
    const { loggedUser } = store.getState()
    const followData = {
        followObjectsType: FOLLOWER_SKILLS_TYPE,
        followObjectId: skill.id,
        feedCreator: loggedUser,
        followObject: skill,
    }
    await tryAddFollower(projectId, followData, batch)
}

export function generateSkillObjectModel(currentMilliseconds, skill, objectId) {
    return {
        type: 'skill',
        lastChangeDate: currentMilliseconds,
        skillId: objectId,
        name: skill ? skill.extendedName : 'Generic update',
        isDeleted: false,
        isPublicFor: skill ? skill.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        assistantId: skill ? skill.assistantId : '',
    }
}

function updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, params, batch) {
    const { objectId, creatorId } = feed
    storeOldFeeds(projectId, currentDateFormated, objectId, skillFeedObject, feedId, feed)
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[objectId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [objectId]: [creatorId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, objectId, 'skills')
        cleanInnerFeeds(projectId, creatorId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${objectId}`)
    batch.set(feedObjectRef, skillFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'skills', objectId, skillFeedObject, batch)
    processLocalFeeds(projectId, skillFeedObject, objectId, feed, feedId, params)
}

//UPDATES

async function createSkillCreatedFeed(projectId, skill, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const skillFeedObject = generateSkillObjectModel(currentMilliseconds, skill, skill.id)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: `created skill`,
        feedCreator,
        objectId: skill.id,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [skill.id]: skillFeedObject }

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skill.id,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skill.id, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillDeletedFeed(projectId, skillId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: 'deleted skill',
        feedCreator,
        objectId: skillId,
        isPublicFor: skillFeedObject.isPublicFor,
    })

    skillFeedObject.isDeleted = true
    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)
    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillNameChangedFeed(projectId, oldName, newName, skillId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewName = TasksHelper.getTaskNameWithoutMeta(newName)
    const simpleOldName = TasksHelper.getTaskNameWithoutMeta(oldName)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed skill title • From ${simpleOldName} to ${simpleNewName}`,
        feedCreator,
        objectId: skillId,
        isPublicFor: skillFeedObject.isPublicFor,
    })

    skillFeedObject.name = newName
    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createSkillAssistantChangedFeed(projectId, assistantId, skillId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed skill assistant`,
        feedCreator,
        objectId: skillId,
        isPublicFor: skillFeedObject.isPublicFor,
    })

    skillFeedObject.assistantId = assistantId
    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillPrivacyChangedFeed(projectId, skillId, isPublicFor, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isPrivate = !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

    addPrivacyForFeedObject(projectId, isPrivate, skillFeedObject, skillId, 'skills', isPublicFor)

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: skillId,
        isPublicFor,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillDescriptionChangedFeed(projectId, oldDescription, newDescription, skilllId, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skilllId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(oldDescription, true), 50)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed skill description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedCreator,
        objectId: skilllId,
        isPublicFor: skillFeedObject.isPublicFor,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skilllId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skilllId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillHighlightedChangedFeed(projectId, skillId, hasStar, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const highlightedState = hasStar.toLowerCase() !== '#ffffff' ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} skill`,
        feedCreator,
        objectId: skillId,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillCompletionChangedFeed(projectId, skillId, completion, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_COMPLETION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed completion to ${completion}%`,
        feedCreator,
        objectId: skillId,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillPointChangedFeed(projectId, skillId, oldPoints, newPoints, externalBatch) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const entryText = `${
        newPoints > oldPoints ? 'increased' : 'decreased'
    } skill points from ${oldPoints} to ${newPoints}`

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_CHANGES_POINTS,
        lastChangeDate: currentMilliseconds,
        entryText,
        feedCreator,
        objectId: skillId,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

async function createSkillProjectChangedFeed(
    projectId,
    skill,
    changeDirection,
    projectName,
    projectColor,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject =
        changeDirection === 'from'
            ? generateSkillObjectModel(currentMilliseconds, skill, skill.id)
            : await loadFeedObject(projectId, skill.id, 'skills', currentDateFormated, currentMilliseconds, batch)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_PROJECT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: skill.id,
        isPublicFor: skillFeedObject.isPublicFor,
    })
    feed.projectName = projectName
    feed.projectColor = projectColor
    feed.changeDirection = changeDirection

    if (changeDirection === 'from') {
        batch.feedObjects = { [skill.id]: skillFeedObject }
    } else {
        skillFeedObject.isDeleted = true
    }

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skill.id,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skill.id, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createSkillFollowedFeed(projectId, skillId, userFollowingId, externalBatch, creator) {
    const feedCreator =
        creator && creator?.displayName ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the skill',
        feedCreator,
        objectId: skillId,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createSkillUnfollowedFeed(projectId, skillId, externalBatch, creator) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_SKILL_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the skill',
        feedCreator,
        objectId: skillId,
    })

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkSkillFeed(projectId, objectId, objectType, skillId, feedType, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const skillFeedObject = await loadFeedObject(
        projectId,
        skillId,
        'skills',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: skillId,
    })
    feed.linkTag = objectLink

    updateSkillFeedObject(projectId, currentDateFormated, skillFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'skills',
        skillId,
        batch,
        feedId,
        feed,
        skillFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'skills', skillId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

//CHAINS

export async function createSkillUpdatesChain(projectId, skill, isUpdatingProject, oldProject) {
    const mentionedUserIds = uniq([
        ...TasksHelper.getMentionIdsFromTitle(skill.extendedName),
        ...TasksHelper.getMentionIdsFromTitle(skill.description),
    ])

    const batch = new BatchWrapper(getDb())
    insertFollowersUserToFeedChain(mentionedUserIds, [], [skill.userId], skill.id, batch)

    isUpdatingProject
        ? await createSkillProjectChangedFeed(projectId, skill, 'from', oldProject.name, oldProject.color, batch)
        : await createSkillCreatedFeed(projectId, skill, batch)

    if (!skill.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        await createSkillPrivacyChangedFeed(projectId, skill.id, skill.isPublicFor, batch)
    }
    if (skill.description) {
        await createSkillDescriptionChangedFeed(projectId, '', skill.description, skill.id, batch)
    }
    if (skill.hasStar.toLowerCase() !== '#ffffff') {
        await createSkillHighlightedChangedFeed(projectId, skill.id, skill.hasStar, batch)
    }
    await processFollowersWhenEditTexts(projectId, FOLLOWER_SKILLS_TYPE, skill.id, skill, mentionedUserIds, true, batch)
    batch.commit()
}

export const updateSkillFeedsChain = async (projectId, updatedSkill, oldSkill, avoidFollow) => {
    const mentionedUserIds = uniq([
        ...getMentionedUsersIdsWhenEditText(updatedSkill.extendedName, oldSkill.extendedName),
        ...getMentionedUsersIdsWhenEditText(updatedSkill.description, oldSkill.description),
    ])

    const batch = new BatchWrapper(getDb())
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], updatedSkill.id, batch)

    if (!isEqual(updatedSkill.isPublicFor, oldSkill.isPublicFor)) {
        await createSkillPrivacyChangedFeed(projectId, updatedSkill.id, updatedSkill.isPublicFor, batch)
    }

    if (updatedSkill.extendedName !== oldSkill.extendedName) {
        await createSkillNameChangedFeed(
            projectId,
            oldSkill.extendedName,
            updatedSkill.extendedName,
            updatedSkill.id,
            batch
        )
    }

    if (updatedSkill.description !== oldSkill.description) {
        await createSkillDescriptionChangedFeed(
            projectId,
            oldSkill.description,
            updatedSkill.description,
            updatedSkill.id,
            batch
        )
    }

    if (updatedSkill.hasStar !== oldSkill.hasStar) {
        await createSkillHighlightedChangedFeed(projectId, updatedSkill.id, updatedSkill.hasStar, batch)
    }

    if (updatedSkill.completion !== oldSkill.completion) {
        await createSkillCompletionChangedFeed(projectId, updatedSkill.id, updatedSkill.completion, batch)
    }

    if (updatedSkill.points !== oldSkill.points) {
        await createSkillPointChangedFeed(projectId, updatedSkill.id, oldSkill.points, updatedSkill.points, batch)
    }

    await processFollowersWhenEditTexts(
        projectId,
        FOLLOWER_SKILLS_TYPE,
        updatedSkill.id,
        updatedSkill,
        mentionedUserIds,
        !avoidFollow,
        batch
    )
    batch.commit()
}

export async function deleteSkillUpdatesChain(projectId, skill, movingToOtherProjectId, newProject) {
    const batch = new BatchWrapper(getDb())
    movingToOtherProjectId
        ? await createSkillProjectChangedFeed(projectId, skill, 'to', newProject.name, newProject.color, batch)
        : await createSkillDeletedFeed(projectId, skill.id, batch)

    await starFollowingSkill(projectId, skill, batch)
    batch.commit()
}

export async function skillNameChangedUpdatesChain(projectId, skill, oldName, newName) {
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(newName, oldName)
    const batch = new BatchWrapper(getDb())
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], skill.id, batch)
    await createSkillNameChangedFeed(projectId, oldName, newName, skill.id, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_SKILLS_TYPE, skill.id, skill, mentionedUserIds, true, batch)
    batch.commit()
}

export async function skillPrivacyChangedUpdatesChain(projectId, skill, isPublicFor) {
    const batch = new BatchWrapper(getDb())
    await createSkillPrivacyChangedFeed(projectId, skill.id, isPublicFor, batch)
    await starFollowingSkill(projectId, skill, batch)
    batch.commit()
}

export async function skillDescriptionChangedUpdatesChain(projectId, skill, oldDescription, newDescription) {
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(newDescription, oldDescription)
    const batch = new BatchWrapper(getDb())
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], skill.id, batch)
    await createSkillDescriptionChangedFeed(projectId, oldDescription, newDescription, skill.id, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_SKILLS_TYPE, skill.id, skill, mentionedUserIds, true, batch)
    batch.commit()
}

export async function skillHighlightChangdeUpdatesChain(projectId, skill, hasStar) {
    const batch = new BatchWrapper(getDb())
    await createSkillHighlightedChangedFeed(projectId, skill.id, hasStar, batch)
    await starFollowingSkill(projectId, skill, batch)
    batch.commit()
}

export async function skillCompletionChangedUpdatesChain(projectId, skill, completion) {
    const batch = new BatchWrapper(getDb())
    await createSkillCompletionChangedFeed(projectId, skill.id, completion, batch)
    await starFollowingSkill(projectId, skill, batch)
    batch.commit()
}

export async function skillPointsChangdeUpdatesChain(projectId, skill, oldPoints, newPoints) {
    const batch = new BatchWrapper(getDb())
    await createSkillPointChangedFeed(projectId, skill.id, oldPoints, newPoints, batch)
    await starFollowingSkill(projectId, skill, batch)
    batch.commit()
}
