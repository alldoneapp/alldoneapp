const checkStickyNotes = async admin => {
    const db = admin.firestore()

    const stickyNotes = (await db.collection('stickyNotesData').where('stickyEndDate', '<', Date.now()).get()).docs

    if (stickyNotes.length > 0) {
        const projectsIds = []
        let promises = []

        stickyNotes.forEach(doc => {
            const noteId = doc.id
            const { projectId } = doc.data()
            projectsIds.push(projectId)
            promises.push(db.doc(`noteItems/${projectId}/notes/${noteId}`).get())
        })

        const notesDocs = await Promise.all(promises)

        promises = []
        for (let i = 0; i < notesDocs.length; i++) {
            const doc = notesDocs[i]
            const noteId = doc.id
            const note = doc.data()
            if (note) {
                const projectId = projectsIds[i]
                const stickyData = { days: 0, stickyEndDate: 0 }
                promises.push(db.doc(`noteItems/${projectId}/notes/${noteId}`).update({ stickyData }))
            }
            promises.push(db.doc(`stickyNotesData/${noteId}`).delete())
        }
        await Promise.all(promises)
    }
}

module.exports = {
    checkStickyNotes,
}
