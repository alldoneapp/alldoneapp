const admin = require('firebase-admin')

const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { FieldValue } = require('firebase-admin/firestore')

const updateSkillPoints = async (userId, points) => {
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (userDoc.exists) {
        await admin
            .firestore()
            .doc(`users/${userId}`)
            .update({
                skillPoints: FieldValue.increment(points),
            })
    }
}

const onDeleteSkill = async (projectId, skill) => {
    const { id: skillId, noteId, userId, points, movingToOtherProjectId } = skill

    const promises = []
    promises.push(deleteChat(admin, projectId, skillId))
    if (noteId) promises.push(deleteNote(projectId, noteId, movingToOtherProjectId, admin))
    // A project move keeps the same skill and therefore must not change the
    // user's aggregate points. The destination write is no longer a client
    // "create" that compensates this increment.
    if (points && !movingToOtherProjectId) promises.push(updateSkillPoints(userId, points))
    if (!movingToOtherProjectId)
        promises.push(removeObjectFromBacklinks(projectId, 'linkedParentSkillsIds', skillId, admin))
    await Promise.all(promises)
}

module.exports = {
    onDeleteSkill,
}
