// A note marked sticky for N days writes a marker stickyNotesData/{noteId} = { projectId,
// stickyEndDate } (utils/backends/firestore.js trackStickyNote); this job demotes the note once the
// marker's end date has passed. The marker is only a pointer into the scan: whether the note is
// still sticky, and until when, is read from the note itself before anything is changed, so a marker
// that disagrees with its note (written before firestore.rules bound markers to project members,
// security audit 2026-11) can never unstick a note early.

// A note without a numeric end date predates stickyEndDate; it is sticky while `days` says so and
// is demoted as before.
const getNoteStickyEndDate = (note, now) => {
    const stickyData = note?.stickyData || {}
    const stickyEndDate = Number(stickyData.stickyEndDate)
    if (stickyData.stickyEndDate !== undefined && stickyData.stickyEndDate !== null && Number.isFinite(stickyEndDate)) {
        return stickyEndDate
    }
    return Number(stickyData.days) > 0 ? now : 0
}

const checkStickyNotes = async (admin, now = Date.now()) => {
    const db = admin.firestore()

    const stickyNotes = (await db.collection('stickyNotesData').where('stickyEndDate', '<', now).get()).docs

    if (stickyNotes.length === 0) return

    const markers = stickyNotes.map(doc => ({ noteId: doc.id, projectId: doc.data().projectId }))
    const notesDocs = await Promise.all(
        markers.map(({ noteId, projectId }) =>
            typeof projectId === 'string' && projectId
                ? db.doc(`noteItems/${projectId}/notes/${noteId}`).get()
                : Promise.resolve(null)
        )
    )

    const promises = []
    markers.forEach(({ noteId, projectId }, index) => {
        const note = notesDocs[index]?.data?.()
        const markerRef = db.doc(`stickyNotesData/${noteId}`)
        const noteEndDate = getNoteStickyEndDate(note, now)

        if (note && noteEndDate > now) {
            // The note itself is still sticky: keep watching it until its own end date.
            promises.push(markerRef.set({ projectId, stickyEndDate: noteEndDate }))
            return
        }
        if (note && noteEndDate > 0) {
            promises.push(
                db.doc(`noteItems/${projectId}/notes/${noteId}`).update({ stickyData: { days: 0, stickyEndDate: 0 } })
            )
        }
        promises.push(markerRef.delete())
    })
    await Promise.all(promises)
}

module.exports = {
    checkStickyNotes,
}
