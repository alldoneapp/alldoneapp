import { firebase } from '@firebase/app'

import {
    addContactFeedsChain,
    deleteFolderFilesInStorage,
    getDb,
    getId,
    getObjectFollowersIds,
    globalWatcherUnsub,
    logEvent,
    mapContactData,
    proccessPictureForAvatar,
    tryAddFollower,
    updateContactPhotoFeedsChain,
    uploadAvatarPhotos,
} from '../firestore'
import {
    createContactAssistantChangedFeed,
    createContactCompanyChangedFeed,
    createContactDeletedFeed,
    createContactDescriptionChangedFeed,
    createContactEmailChangedFeed,
    createContactHighlightChangedFeed,
    createContactNameChangedFeed,
    createContactPhoneNumberChangedFeed,
    createContactPrivacyChangedFeed,
    createContactRoleChangedFeed,
} from './contactUpdates'
import store from '../../../redux/store'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { FOLLOWER_CONTACTS_TYPE } from '../../../components/Followers/FollowerConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { updateNotePrivacy, updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import {
    updateChatAssistantWithoutFeeds,
    updateChatPrivacy,
    updateChatTitleWithoutFeeds,
} from '../Chats/chatsFirestore'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

//ACCESS FUNCTIONS

export async function watchProjectContacts(projectId, callback, watcherKey) {
    const { loggedUser } = store.getState()
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUser.uid]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`/projectsContacts/${projectId}/contacts`)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .onSnapshot(async contactList => {
            const contacts = []
            contactList.forEach(contact => {
                contacts.push(mapContactData(contact.id, contact.data()))
            })
            callback(contacts)
        })
}

export async function watchContactData(projectId, contactId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`projectsContacts/${projectId}/contacts/${contactId}`)
        .onSnapshot(doc => {
            const contactData = doc.data()
            const contact = contactData ? mapContactData(contactId, contactData) : null
            callback(contact)
        })
}

export async function getContactData(projectId, contactId) {
    const contact = (await getDb().doc(`/projectsContacts/${projectId}/contacts/${contactId}`).get()).data()
    return contact ? mapContactData(contactId, contact) : null
}

export async function getProjectContacts(projectId) {
    const { loggedUser } = store.getState()
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUser.uid]

    const contactDocs = (
        await getDb()
            .collection(`/projectsContacts/${projectId}/contacts`)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .get()
    ).docs

    const contacts = []
    contactDocs.forEach(doc => {
        const contact = mapContactData(doc.id, doc.data())
        contacts.push(contact)
    })

    return contacts
}

//EDTION AND ADITION FUNCTIONS

export const updateContactEditionData = async (projectId, contactId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`projectsContacts/${projectId}/contacts/${contactId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

async function updateContactData(projectId, contactId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`projectsContacts/${projectId}/contacts/${contactId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function addContactToProject(projectId, contact, onComplete) {
    updateEditionData(contact)

    const contactId = getId()

    const contactToStore = { ...contact }
    let feedPhotoUrl = contact.photoURL

    if (contact.photoURL) {
        const pictures = [contact.photoURL, contact.photoURL50, contact.photoURL300]
        const urlList = await uploadAvatarPhotos(
            pictures,
            `projectsContacts/${projectId}/${contactId}/${contactId}@${Date.now()}`,
            `feeds/${projectId}/${contactId}_${getId()}@${Date.now()}`
        )

        contactToStore.photoURL = urlList[0]
        contactToStore.photoURL50 = urlList[1]
        contactToStore.photoURL300 = urlList[2]
        feedPhotoUrl = urlList[3]
    }

    await getDb().doc(`projectsContacts/${projectId}/contacts/${contactId}`).set(contactToStore)
    if (onComplete) onComplete({ uid: contactId, ...contactToStore })

    addContactFeedsChain(projectId, contact, feedPhotoUrl, contactId)

    logEvent('new_contact', {
        id: contactId,
        email: contact.email,
    })
}

export async function deleteProjectContact(projectId, contact, contactId) {
    const batch = new BatchWrapper(getDb())
    await createContactDeletedFeed(projectId, contact, contactId, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.delete(getDb().doc(`projectsContacts/${projectId}/contacts/${contactId}`))
    batch.commit()
}

export const setContactAssistant = async (projectId, contactId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateContactData(projectId, contactId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, contactId, assistantId, batch)
    batch.commit()
    if (needGenerateUpdate) createContactAssistantChangedFeed(projectId, assistantId, contactId, null, null)
}

export const updateContactNote = async (projectId, contactId, noteId) => {
    await updateContactData(projectId, contactId, { noteId }, null)
}

export const updateContactLastCommentData = async (projectId, contactId, lastComment, lastCommentType) => {
    getDb()
        .doc(`projectsContacts/${projectId}/contacts/${contactId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export async function setProjectContactName(projectId, contact, contactId, newName, oldName) {
    let batch = new BatchWrapper(getDb())
    updateContactData(projectId, contactId, { displayName: newName }, batch)
    if (contact.noteId) await updateNoteTitleWithoutFeed(projectId, contact.noteId, newName, batch)
    await updateChatTitleWithoutFeeds(projectId, contact.uid, newName, batch)
    batch.commit()

    batch = new BatchWrapper(getDb())
    await createContactNameChangedFeed(projectId, contact, contactId, newName, oldName, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactCompany(projectId, contact, contactId, newCompany, oldCompany) {
    await updateContactData(projectId, contactId, { company: newCompany }, null)

    const batch = new BatchWrapper(getDb())
    await createContactCompanyChangedFeed(projectId, contact, contactId, newCompany, oldCompany, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactRole(projectId, contact, contactId, newRole, oldRole) {
    await updateContactData(projectId, contactId, { role: newRole }, null)

    const batch = new BatchWrapper(getDb())
    await createContactRoleChangedFeed(projectId, contact, contactId, newRole, oldRole, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactDescription(projectId, contact, contactId, newDescription, oldDescription) {
    await updateContactData(
        projectId,
        contactId,
        { description: TasksHelper.getTaskNameWithoutMeta(newDescription), extendedDescription: newDescription },
        null
    )

    const batch = new BatchWrapper(getDb())
    await createContactDescriptionChangedFeed(projectId, contact, contactId, newDescription, oldDescription, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactPicture(projectId, contact, contactId, pictureFile) {
    const pictures = await proccessPictureForAvatar(pictureFile)

    if (pictures.length > 0) {
        store.dispatch(startLoadingData())
        await deleteFolderFilesInStorage(`projectsContacts/${projectId}/${contactId}`)
        const urlList = await uploadAvatarPhotos(
            pictures,
            `projectsContacts/${projectId}/${contactId}/${contactId}@${Date.now()}`,
            `feeds/${projectId}/${contactId}_${getId()}@${Date.now()}`
        )

        const contactToStore = {
            ...contact,
            photoURL: urlList[0],
            photoURL50: urlList[1],
            photoURL300: urlList[2],
        }

        await updateContactData(projectId, contactId, contactToStore, null)

        updateContactPhotoFeedsChain(projectId, contact, contactId, urlList)
        store.dispatch(stopLoadingData())
    }
}

export async function setProjectContactPhone(projectId, contact, contactId, newPhoneNumber, oldPhoneNumber) {
    await updateContactData(projectId, contactId, { phone: newPhoneNumber }, null)

    const batch = new BatchWrapper(getDb())
    await createContactPhoneNumberChangedFeed(projectId, contact, contactId, newPhoneNumber, oldPhoneNumber, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactEmail(projectId, contact, contactId, newEmail, oldEmail) {
    await updateContactData(projectId, contactId, { email: newEmail }, null)

    const batch = new BatchWrapper(getDb())
    await createContactEmailChangedFeed(projectId, contact, contactId, newEmail, oldEmail, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactPrivacy(projectId, contact, contactId, privacy, isPublicFor) {
    updateContactData(projectId, contactId, { isPrivate: privacy, isPublicFor: isPublicFor }, null)

    if (contact.noteId) {
        const followersIds = await getObjectFollowersIds(projectId, 'contacts', contact.uid)
        updateNotePrivacy(projectId, contact.noteId, privacy, isPublicFor, followersIds, false, null)
    }
    updateChatPrivacy(projectId, contactId, 'contacts', isPublicFor)

    const batch = new BatchWrapper(getDb())
    await createContactPrivacyChangedFeed(projectId, contact, contactId, privacy, isPublicFor, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export async function setProjectContactHighlight(projectId, contact, contactId, highlightColor) {
    updateContactData(projectId, contactId, { hasStar: highlightColor }, null)

    const batch = new BatchWrapper(getDb())
    await createContactHighlightChangedFeed(projectId, contact, contactId, highlightColor, batch)
    const followContactData = {
        followObjectsType: FOLLOWER_CONTACTS_TYPE,
        followObjectId: contactId,
        followObject: contact,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followContactData, batch)
    batch.commit()
}

export function setContactLastVisitedBoardDate(projectId, contactId, lastVisitBoardProperty) {
    const { loggedUser } = store.getState()
    updateContactData(
        projectId,
        contactId,
        { [`${lastVisitBoardProperty}.${projectId}.${loggedUser.uid}`]: Date.now() },
        null
    )
}
