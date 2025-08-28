const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function generateContactObjectModel(currentMilliseconds, contact, contactId) {
    return {
        type: 'contact',
        lastChangeDate: currentMilliseconds,
        name: contact.displayName,
        privacy: contact.isPrivate ? contact.lastEditorId : 'public',
        avatarUrl: contact.photoURL50,
        contactId: contactId,
        isPublicFor: contact.isPrivate ? [contact.recorderUserId] : [FEED_PUBLIC_FOR_ALL],
        recorderUserId: contact.recorderUserId,
    }
}

module.exports = { generateContactObjectModel }
