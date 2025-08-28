import {
    FEED_CONTACT_ADDED,
    FEED_CONTACT_BACKLINK,
    FEED_CONTACT_COMPANY_CHANGED,
    FEED_CONTACT_DELETED,
    FEED_CONTACT_DESCRIPTION_CHANGED,
    FEED_CONTACT_EMAIL_CHANGED,
    FEED_CONTACT_FOLLOWED,
    FEED_CONTACT_HIGHLIGHT_CHANGED,
    FEED_CONTACT_NAME_CHANGED,
    FEED_CONTACT_PHONE_NUMBER_CHANGED,
    FEED_CONTACT_PICTURE_CHANGED,
    FEED_CONTACT_PRIVACY_CHANGED,
    FEED_CONTACT_ROLE_CHANGED,
    FEED_CONTACT_UNFOLLOWED,
    FEED_PUBLIC_FOR_ALL,
    FEED_CONTACT_ASSISTANT_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
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
    getProjectUsersIds,
    globalInnerFeedsGenerator,
    increaseFeedCount,
    loadFeedObject,
    processLocalFeeds,
    setFeedObjectLastState,
    storeOldFeeds,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'

//COMMON

export function generateContactObjectModel(currentMilliseconds, contact = {}, contactId) {
    return {
        type: 'contact',
        lastChangeDate: currentMilliseconds,
        name: contact.displayName,
        privacy: contact.isPrivate ? contact.lastEditorId : 'public',
        avatarUrl: contact.photoURL50,
        contactId: contactId,
        isPublicFor: contact.isPrivate ? [contact.recorderUserId] : [FEED_PUBLIC_FOR_ALL],
        recorderUserId: contact.recorderUserId,
        isDeleted: false,
        assistantId: contact.assistantId || '',
    }
}

function updateContactFeedObject(
    projectId,
    currentDateFormated,
    contactId,
    contactFeedObject,
    feed,
    feedId,
    params,
    batch
) {
    storeOldFeeds(projectId, currentDateFormated, contactId, contactFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[contactId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [contactId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, contactId, 'contacts')
        cleanInnerFeeds(projectId, loggedUserId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${contactId}`)
    batch.set(feedObjectRef, contactFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'contacts', contactId, contactFeedObject, batch)
    processLocalFeeds(projectId, contactFeedObject, contactId, feed, feedId, params)
}

//UPDATES

export async function createContactAddedFeed(projectId, contact, contactId, contactPhotoURL, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const contactFeedObject = generateContactObjectModel(currentMilliseconds, contact, contactId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_ADDED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })
    feed.contactName = HelperFunctions.getFirstName(contact.displayName)
    feed.contactAvatarURL = contactPhotoURL ? contactPhotoURL : ''

    contactFeedObject.isDeleted = true

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [contactId]: contactFeedObject }

    contactFeedObject.avatarUrl = contactPhotoURL
    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactPictureChangedFeed(
    projectId,
    contact,
    contactId,
    newContactPhotoURL,
    oldContactPhotoURL,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_PICTURE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })
    feed.newContactPhotoURL = newContactPhotoURL
    feed.oldContactPhotoURL = contactFeedObject.avatarUrl

    contactFeedObject.avatarUrl = newContactPhotoURL
    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactEmailChangedFeed(
    projectId,
    contact,
    contactId,
    newEmail,
    oldEmail,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldEmail = oldEmail ? oldEmail : 'Unknown'
    const parsedNewEmail = newEmail ? newEmail : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_EMAIL_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed email • From ${parsedOldEmail} to ${parsedNewEmail}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactPhoneNumberChangedFeed(
    projectId,
    contact,
    contactId,
    newPhoneNumber,
    oldPhoneNumber,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldPhoneNumber = oldPhoneNumber ? oldPhoneNumber : 'Unknown'
    const parsedNewPhoneNumber = newPhoneNumber ? newPhoneNumber : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_PHONE_NUMBER_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed phone number • From ${parsedOldPhoneNumber} to ${parsedNewPhoneNumber}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactPrivacyChangedFeed(
    projectId,
    contact,
    contactId,
    isPrivate,
    isPublicFor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    addPrivacyForFeedObject(
        projectId,
        isPrivate,
        contactFeedObject,
        contactId,
        'contacts',
        isPublicFor || isPrivate ? [contact.recorderUserId] : [FEED_PUBLIC_FOR_ALL]
    )

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    contactFeedObject.privacy = isPrivate ? feedCreator.uid : 'public'
    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactRoleChangedFeed(
    projectId,
    contact,
    contactId,
    newRole,
    oldRole,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldRole = oldRole ? oldRole : 'Unknown'
    const parsedNewRole = newRole ? newRole : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_ROLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed role • From ${parsedOldRole} to ${parsedNewRole}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactDescriptionChangedFeed(
    projectId,
    contact,
    contactId,
    neDescription,
    oldDescription,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldDescription = oldDescription ? oldDescription : 'Unknown'
    const parsedNewDescription = neDescription ? neDescription : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed description • From ${parsedOldDescription} to ${parsedNewDescription}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactNameChangedFeed(
    projectId,
    contact,
    contactId,
    newName,
    oldName,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_NAME_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed name • From ${oldName}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    contactFeedObject.name = newName
    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactAssistantChangedFeed(projectId, assistantId, contactId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed contact assistant`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    contactFeedObject.assistantId = assistantId
    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactCompanyChangedFeed(
    projectId,
    contact,
    contactId,
    newCompany,
    oldCompany,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldCompany = oldCompany ? oldCompany : 'Unknown'
    const parsedNewCompany = newCompany ? newCompany : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_COMPANY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed company • From ${parsedOldCompany} to ${parsedNewCompany}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactHighlightChangedFeed(
    projectId,
    contact,
    contactId,
    highlightColor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isHighlighted = highlightColor.toLowerCase() !== '#ffffff'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_HIGHLIGHT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${isHighlighted ? 'highlighted' : 'unhighlighted'} contact ${contact.displayName}`,
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactDeletedFeed(projectId, contact, contactId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: 'deleted relevant person',
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactFollowedFeed(
    projectId,
    contact,
    contactId,
    userFollowingId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the contact',
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createContactUnfollowedFeed(projectId, contact, contactId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the contact',
        feedCreator,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkContactFeed(projectId, objectId, objectType, contactId, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const contactFeedObject = await loadFeedObject(
        projectId,
        contactId,
        'contacts',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: contactId,
    })

    feed.linkTag = objectLink

    updateContactFeedObject(projectId, currentDateFormated, contactId, contactFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'contacts',
        contactId,
        batch,
        feedId,
        feed,
        contactFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    globalInnerFeedsGenerator(projectId, 'contacts', contactId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
