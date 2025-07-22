const trackStickyNote = async (appAdmin, projectId, noteId, stickyEndDate) => {
    await appAdmin.firestore().doc(`stickyNotesData/${noteId}`).set({ projectId, stickyEndDate })
}

module.exports = { trackStickyNote }
