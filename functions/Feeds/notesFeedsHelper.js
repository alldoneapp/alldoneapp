const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function generateNoteObjectModel(currentMilliseconds, note, noteId) {
    return {
        type: 'note',
        lastChangeDate: currentMilliseconds,
        noteId: noteId,
        name: note.extendedTitle ? note.extendedTitle : note.title,
        privacy: note.isPrivate ? note.userId : 'public',
        isPublicFor: note.isPublicFor ? note.isPublicFor : note.isPrivate ? [note.userId] : [FEED_PUBLIC_FOR_ALL],
        userId: note.userId,
        isDeleted: false,
    }
}

module.exports = { generateNoteObjectModel }
