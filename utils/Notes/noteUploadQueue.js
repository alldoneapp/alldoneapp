// Serialize uploads to a note's single Storage object, including close/reopen
// and the offline catch-up sweep. Different notes can still upload concurrently.
const uploads = new Map()
export const queueNoteUpload = (projectId, noteId, upload) => {
    const key = `${projectId}/${noteId}`
    const previous = uploads.get(key)
    const result = previous ? previous.catch(() => {}).then(upload) : Promise.resolve().then(upload)
    uploads.set(key, result)
    const remove = () => {
        if (uploads.get(key) === result) uploads.delete(key)
    }
    result.then(remove, remove)
    return result
}
