import store from '.././../../redux/store'
import {
    cleanInnerFeeds,
    cleanNewFeeds,
    cleanStoreFeeds,
    generateCurrentDateObject,
    generateFeedModel,
    getDb,
    getProjectData,
    getProjectUsersIds,
    globalInnerFeedsGenerator,
    increaseFeedCount,
    loadFeedObject,
    processLocalFeeds,
    setFeedObjectLastState,
    storeOldFeeds,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    FEED_PROJECT_ARCHIVED_UNARCHIVED,
    FEED_PROJECT_BACKLINK,
    FEED_PROJECT_COLOR_CHANGED,
    FEED_PROJECT_CREATED,
    FEED_PROJECT_DECLINED_INVITATION,
    FEED_PROJECT_DESCRIPTION_CHANGED,
    FEED_PROJECT_FOLLOWED,
    FEED_PROJECT_GUIDE_CHANGED,
    FEED_PROJECT_KICKED_MEMBER,
    FEED_PROJECT_PRIVACY_CHANGED,
    FEED_PROJECT_SENT_INVITATION,
    FEED_PROJECT_TITLE_CHANGED,
    FEED_PROJECT_UNFOLLOWED,
    FEED_PROJECT_ESTIMATION_TYPE_CHANGED,
    FEED_PROJECT_ASSISTANT_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../HelperFunctions'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { ESTIMATION_TYPE_POINTS } from '../../EstimationHelper'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_ARCHIVED,
} from '../../../components/SettingsView/ProjectsSettings/ProjectsSettings'

//COMMON

export function generateProjectObjectModel(currentMilliseconds, project = {}) {
    return {
        type: 'project',
        lastChangeDate: currentMilliseconds,
        name: project.name,
        color: project.color,
    }
}

function updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, params, batch) {
    storeOldFeeds(projectId, currentDateFormated, projectId, projectFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[projectId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [projectId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, projectId, 'projects')
        cleanInnerFeeds(projectId, loggedUserId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${projectId}`)
    batch.set(feedObjectRef, projectFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'projects', projectId, projectFeedObject, batch)
    processLocalFeeds(projectId, projectFeedObject, projectId, feed, feedId, params)
}

//UPDATES

export async function createProjectCreatedFeed(
    projectId,
    project,
    externalBatch,
    creator,
    projectUsersIdsForSpecialFeeds
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: 'created project',
        feedCreator,
        objectId: projectId,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    const projectFeedObject = generateProjectObjectModel(currentMilliseconds, project)
    batch.feedObjects = { [projectId]: projectFeedObject }

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        projectUsersIdsForSpecialFeeds ? projectUsersIdsForSpecialFeeds : [feedCreator.uid],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectSharedChangedFeed(
    projectId,
    project,
    isShared,
    oldProjectShared,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const oldPrivacy = ProjectHelper.getProjectIsSharedTitle(oldProjectShared)
    const newPrivacy = ProjectHelper.getProjectIsSharedTitle(isShared)
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed project privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)
    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectEstimationTypeChangedFeed(
    projectId,
    project,
    newType,
    oldType,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const oldTypeText = oldType === ESTIMATION_TYPE_POINTS ? 'Points' : 'Time'
    const newTypeText = newType === ESTIMATION_TYPE_POINTS ? 'Points' : 'Time'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_ESTIMATION_TYPE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed the estimation type of the project • From ${oldTypeText} to ${newTypeText}`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)
    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectColorChangedFeed(projectId, project, oldColor, newColor, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_COLOR_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: projectId,
    })
    feed.oldColor = oldColor
    feed.newColor = newColor

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    projectFeedObject.color = newColor
    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectDescriptionChangedFeed(
    projectId,
    project,
    newDescription,
    oldDescription,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed description • From "${oldDescription}" to "${newDescription}"`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)
    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectGuideIdChangedFeed(projectId, guideProjectId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_GUIDE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: projectId,
    })

    if (guideProjectId) {
        const guideProject = await getProjectData(guideProjectId)
        feed.guideProjectId = guideProjectId
        feed.projectName = guideProject.name
        feed.projectColor = guideProject.color
    }

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectTitleChangedFeed(projectId, project, oldTitle, newTitle, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed title • From ${oldTitle} to ${newTitle}`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createChangeProjectStatusFeed(projectId, project, projectStatus, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const projectTypeText =
        projectStatus === PROJECT_TYPE_ACTIVE
            ? 'normal'
            : projectStatus === PROJECT_TYPE_ARCHIVED
            ? 'archived'
            : 'template'

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_ARCHIVED_UNARCHIVED,
        lastChangeDate: currentMilliseconds,
        entryText: `update project status to ${projectTypeText}`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectInvitationSentFeed(projectId, email, project, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_SENT_INVITATION,
        lastChangeDate: currentMilliseconds,
        entryText: `sent invitation • To ${email}`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectKickedMemberFeed(projectId, project, kickedUser, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_KICKED_MEMBER,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: projectId,
    })
    feed.kickedUserId = kickedUser.uid

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    const usersToNotifyIds = getProjectUsersIds(projectId).filter(id => {
        id !== kickedUser.uid
    })

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds,
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
            kickedUserName: HelperFunctions.getFirstName(kickedUser.displayName),
            kickedUserAvatarURL: kickedUser.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectAssistantChangedFeed(projectId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed project assistant`,
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectDeclinedInvitationFeed(projectId, project, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_DECLINED_INVITATION,
        lastChangeDate: currentMilliseconds,
        entryText: 'declined an invitation to project',
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        project.userIds,
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectFollowedFeed(projectId, project, userFollowingId, externalBatch, creator) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the project',
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    let usersToNotifyIds = project ? project.userIds : getProjectUsersIds(projectId)

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds,
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createProjectUnfollowedFeed(projectId, project, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the project',
        feedCreator,
        objectId: projectId,
    })

    globalInnerFeedsGenerator(projectId, 'projects', projectId, feed, feedId, feedCreator.uid, batch)

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkProjectFeed(projectId, objectId, objectType, link, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const projectFeedObject = await loadFeedObject(
        projectId,
        projectId,
        'projects',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: projectId,
        isPublicFor: projectFeedObject.isPublicFor,
    })
    feed.linkTag = objectLink

    updateProjectFeedObject(projectId, currentDateFormated, projectFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'project',
        projectId,
        batch,
        feedId,
        feed,
        projectFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'tasks', projectId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
