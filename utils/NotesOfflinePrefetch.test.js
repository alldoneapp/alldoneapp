import { selectNotesToPrefetch, readPrefetchMarkers, MAX_NOTES_PER_RUN } from './NotesOfflinePrefetch'

describe('selectNotesToPrefetch', () => {
    const note = (noteId, lastEditionDate, projectId = 'p1') => ({ noteId, lastEditionDate, projectId })

    it('takes the newest notes first across projects', () => {
        const selected = selectNotesToPrefetch([note('a', 100), note('b', 300, 'p2'), note('c', 200)], {})
        expect(selected.map(item => item.noteId)).toEqual(['b', 'c', 'a'])
    })

    it('skips notes whose local copy already has this edition', () => {
        const selected = selectNotesToPrefetch([note('a', 100), note('b', 300)], { a: 100 })
        expect(selected.map(item => item.noteId)).toEqual(['b'])
    })

    it('re-selects a note whose edition moved past the marker', () => {
        const selected = selectNotesToPrefetch([note('a', 150)], { a: 100 })
        expect(selected.map(item => item.noteId)).toEqual(['a'])
    })

    it('never touches the note that is open in the live editor', () => {
        const selected = selectNotesToPrefetch([note('a', 100), note('b', 300)], {}, { activeNoteId: 'b' })
        expect(selected.map(item => item.noteId)).toEqual(['a'])
    })

    it('caps the run size, keeping the newest', () => {
        const candidates = Array.from({ length: MAX_NOTES_PER_RUN + 10 }, (_, i) => note(`n${i}`, i))
        const selected = selectNotesToPrefetch(candidates, {})
        expect(selected).toHaveLength(MAX_NOTES_PER_RUN)
        expect(selected[0].noteId).toBe(`n${MAX_NOTES_PER_RUN + 9}`)
    })
})

describe('readPrefetchMarkers', () => {
    afterEach(() => localStorage.clear())

    it('returns an empty map for missing or corrupt storage', () => {
        expect(readPrefetchMarkers()).toEqual({})
        localStorage.setItem('alldone_notes_prefetch_v1', 'not-json')
        expect(readPrefetchMarkers()).toEqual({})
    })

    it('round-trips stored markers', () => {
        localStorage.setItem('alldone_notes_prefetch_v1', JSON.stringify({ a: 100 }))
        expect(readPrefetchMarkers()).toEqual({ a: 100 })
    })
})
