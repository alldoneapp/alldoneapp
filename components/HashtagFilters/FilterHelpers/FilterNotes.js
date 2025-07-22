import store from '../../../redux/store'
import { matchSearch } from '../HashtagFiltersHelper'

/**
 * Determine if a Note match with the term list
 *
 * @param note
 * @returns {boolean}
 */
export const noteMatchHashtagFilters = note => {
    const termList = Array.from(store.getState().hashtagFilters.keys())
    return termList.length === 0 || matchSearch(note.title, termList) || matchSearch(note.preview, termList)
}

export const filterNotes = notes => {
    const newFilteredNotes = {}

    for (let dateIndex in notes) {
        const notesF = notes[dateIndex].filter(note => noteMatchHashtagFilters(note))

        if (notesF.length > 0) {
            newFilteredNotes[dateIndex] = notesF
        }
    }

    return newFilteredNotes
}

export const filterStickyNotes = notes => {
    return notes.filter(note => noteMatchHashtagFilters(note))
}
