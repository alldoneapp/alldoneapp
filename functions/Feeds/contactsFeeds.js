const {
    generateCurrentDateObject,
    generateFeedModel,
    proccessFeed,
    loadFeedObject,
    addPrivacyForFeedObject,
} = require('./globalFeedsHelper')
const { generateContactObjectModel } = require('./contactsFeedsHelper')
const { getFirstName, FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const {
    FEED_CONTACT_ADDED,
    FEED_CONTACT_FOLLOWED,
    FEED_CONTACT_PRIVACY_CHANGED,
    FEED_CONTACT_COMPANY_CHANGED,
    FEED_CONTACT_ROLE_CHANGED,
    FEED_CONTACT_DESCRIPTION_CHANGED,
    FEED_CONTACT_HIGHLIGHT_CHANGED,
    FEED_CONTACT_PHONE_NUMBER_CHANGED,
    FEED_CONTACT_EMAIL_CHANGED,
} = require('./FeedsConstants')

async function createContactAddedFeed(
    projectId,
    contact,
    contactId,
    contactPhotoURL,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const contactFeedObject = generateContactObjectModel(currentMilliseconds, contact, contactId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_ADDED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    feed.contactName = getFirstName(contact.displayName)
    feed.contactAvatarURL = contactPhotoURL ? contactPhotoURL : ''

    batch.feedObjects = { [contactId]: contactFeedObject }

    contactFeedObject.avatarUrl = contactPhotoURL

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactFollowedFeed(projectId, contactId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the contact',
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactPrivacyChangedFeed(
    projectId,
    contact,
    contactId,
    isPrivate,
    isPublicFor,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    await addPrivacyForFeedObject(
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
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    contactFeedObject.privacy = isPrivate ? feedUser.uid : 'public'

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactCompanyChangedFeed(
    projectId,
    contactId,
    newCompany,
    oldCompany,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const parsedOldCompany = oldCompany ? oldCompany : 'Unknown'
    const parsedNewCompany = newCompany ? newCompany : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_COMPANY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed company • From ${parsedOldCompany} to ${parsedNewCompany}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactRoleChangedFeed(
    projectId,
    contactId,
    newRole,
    oldRole,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const parsedOldRole = oldRole ? oldRole : 'Unknown'
    const parsedNewRole = newRole ? newRole : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_ROLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed role • From ${parsedOldRole} to ${parsedNewRole}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactDescriptionChangedFeed(
    projectId,
    contactId,
    neDescription,
    oldDescription,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const parsedOldDescription = oldDescription ? oldDescription : 'Unknown'
    const parsedNewDescription = neDescription ? neDescription : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed description • From ${parsedOldDescription} to ${parsedNewDescription}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactHighlightChangedFeed(
    projectId,
    contact,
    contactId,
    highlightColor,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const isHighlighted = highlightColor.toLowerCase() !== '#ffffff'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_HIGHLIGHT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${isHighlighted ? 'highlighted' : 'unhighlighted'} contact ${contact.displayName}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactPhoneNumberChangedFeed(
    projectId,
    contactId,
    newPhoneNumber,
    oldPhoneNumber,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const parsedOldPhoneNumber = oldPhoneNumber ? oldPhoneNumber : 'Unknown'
    const parsedNewPhoneNumber = newPhoneNumber ? newPhoneNumber : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_PHONE_NUMBER_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed phone number • From ${parsedOldPhoneNumber} to ${parsedNewPhoneNumber}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createContactEmailChangedFeed(
    projectId,
    contactId,
    newEmail,
    oldEmail,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const contactFeedObject = await loadFeedObject(projectId, contactId, 'contacts', currentMilliseconds, batch)
    if (!contactFeedObject) return

    const parsedOldEmail = oldEmail ? oldEmail : 'Unknown'
    const parsedNewEmail = newEmail ? newEmail : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_CONTACT_EMAIL_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed email • From ${parsedOldEmail} to ${parsedNewEmail}`,
        feedUser,
        objectId: contactId,
        isPublicFor: contactFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        contactId,
        'contacts',
        contactFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

module.exports = {
    createContactAddedFeed,
    createContactFollowedFeed,
    createContactPrivacyChangedFeed,
    createContactCompanyChangedFeed,
    createContactRoleChangedFeed,
    createContactDescriptionChangedFeed,
    createContactHighlightChangedFeed,
    createContactPhoneNumberChangedFeed,
    createContactEmailChangedFeed,
}
