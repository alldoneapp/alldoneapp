const { intersection, uniq } = require('lodash')

const { FOLLOWER_CONTACTS_TYPE } = require('../Followers/FollowerConstants')
const { addFollowers } = require('../Followers/followerHelper')
const {
    getMentionedUsersIdsWhenEditText,
    insertFollowersUserToFeedChain,
    cleanFeeds,
    cleanObjectFeeds,
} = require('./globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
//const {} = require('./contactsFeedsHelper')
const {
    createContactAddedFeed,
    createContactPrivacyChangedFeed,
    createContactCompanyChangedFeed,
    createContactRoleChangedFeed,
    createContactDescriptionChangedFeed,
    createContactHighlightChangedFeed,
    createContactPhoneNumberChangedFeed,
    createContactEmailChangedFeed,
} = require('./contactsFeeds')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

async function addContactFeedsChain(
    projectId,
    contact,
    photoURL,
    contactId,
    needCleanGlobalFeeds,
    needGenerateNotification
) {
    const { appAdmin, feedCreator, project } = getGlobalState()

    const batch = new BatchWrapper(appAdmin.firestore())

    const fullText = contact.displayName + ' ' + contact.description
    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

    const followerIds = uniq([...mentionedUserIds, contact.recorderUserId, feedCreator.uid])
    insertFollowersUserToFeedChain(followerIds, contact.uid, batch)

    await createContactAddedFeed(projectId, contact, contactId, photoURL, batch, feedCreator, needGenerateNotification)

    if (!contact.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        await createContactPrivacyChangedFeed(
            projectId,
            contact,
            contactId,
            contact.isPrivate,
            contact.isPublicFor,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.company) {
        await createContactCompanyChangedFeed(
            projectId,
            contactId,
            contact.company,
            '',
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.role) {
        await createContactRoleChangedFeed(
            projectId,
            contactId,
            contact.role,
            '',
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.extendedDescription) {
        await createContactDescriptionChangedFeed(
            projectId,
            contactId,
            contact.extendedDescription,
            '',
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.hasStar !== '#FFFFFF') {
        await createContactHighlightChangedFeed(
            projectId,
            contact,
            contactId,
            contact.hasStar,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.phone) {
        await createContactPhoneNumberChangedFeed(
            projectId,
            contactId,
            contact.phone,
            '',
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (contact.email) {
        await createContactEmailChangedFeed(
            projectId,
            contactId,
            contact.email,
            '',
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const followData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
    }

    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, contactId, 'contacts')
    } else {
        await cleanObjectFeeds(projectId, contactId, 'contacts')
    }
}

module.exports = { addContactFeedsChain }
