import { writeLinkedParentsIfChanged } from './linkedParentsWrite'

const LINKS = {
    linkedParentNotesIds: ['note-1'],
    linkedParentTasksIds: [],
    linkedParentContactsIds: ['contact-1'],
    linkedParentProjectsIds: [],
    linkedParentGoalsIds: [],
    linkedParentSkillsIds: [],
    linkedParentAssistantIds: [],
    linkedParentsInContentIds: { linkedParentNotesIds: ['note-1'] },
}

const makeRef = ({ cached, cacheFails = false }) => ({
    update: jest.fn(() => Promise.resolve()),
    get: jest.fn(() =>
        cacheFails
            ? Promise.reject(new Error('Failed to get document from cache.'))
            : Promise.resolve({ exists: !!cached, data: () => cached })
    ),
})

describe('writeLinkedParentsIfChanged', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => jest.restoreAllMocks())

    it('writes nothing when the backlinks are unchanged', async () => {
        // The everyday case: typing prose in a note whose links did not move.
        // This used to be a second full document write per autosave, and with it
        // a second onUpdateNote, a second note download from Storage and a
        // second search re-index.
        const ref = makeRef({ cached: { ...LINKS, preview: 'unrelated field', lastEditionDate: 1 } })

        await expect(writeLinkedParentsIfChanged(ref, LINKS)).resolves.toBe(false)

        expect(ref.update).not.toHaveBeenCalled()
    })

    it('reads only the local cache — never a billed/networked round trip', async () => {
        const ref = makeRef({ cached: { ...LINKS } })

        await writeLinkedParentsIfChanged(ref, LINKS)

        expect(ref.get).toHaveBeenCalledWith({ source: 'cache' })
    })

    it('writes when a backlink was added', async () => {
        const ref = makeRef({ cached: { ...LINKS, linkedParentTasksIds: [] } })
        const next = { ...LINKS, linkedParentTasksIds: ['task-9'] }

        await expect(writeLinkedParentsIfChanged(ref, next)).resolves.toBe(true)

        expect(ref.update).toHaveBeenCalledWith(next)
    })

    it('writes when a backlink was removed', async () => {
        const ref = makeRef({ cached: { ...LINKS } })
        const next = { ...LINKS, linkedParentNotesIds: [] }

        await expect(writeLinkedParentsIfChanged(ref, next)).resolves.toBe(true)
    })

    it('writes when a nested per-part map changed', async () => {
        const ref = makeRef({ cached: { ...LINKS } })
        const next = { ...LINKS, linkedParentsInContentIds: { linkedParentNotesIds: ['note-2'] } }

        await expect(writeLinkedParentsIfChanged(ref, next)).resolves.toBe(true)
    })

    it('writes when the document is not in the cache (uncertain ⇒ write)', async () => {
        const ref = makeRef({ cached: null, cacheFails: true })

        await expect(writeLinkedParentsIfChanged(ref, LINKS)).resolves.toBe(true)

        expect(ref.update).toHaveBeenCalledWith(LINKS)
    })

    it('writes when the cached document does not exist', async () => {
        const ref = makeRef({ cached: null })

        await expect(writeLinkedParentsIfChanged(ref, LINKS)).resolves.toBe(true)
    })

    it('force writes immediately without reading the cache', async () => {
        // The teardown / beforeunload path: the page may never run an async
        // continuation, so a write deferred behind the cache read could be lost.
        const ref = makeRef({ cached: { ...LINKS } })

        await expect(writeLinkedParentsIfChanged(ref, LINKS, { force: true })).resolves.toBe(true)

        expect(ref.get).not.toHaveBeenCalled()
        expect(ref.update).toHaveBeenCalledWith(LINKS)
    })

    it('never rejects when the write itself fails', async () => {
        const ref = makeRef({ cached: null })
        ref.update.mockRejectedValueOnce(new Error('permission denied'))

        await expect(writeLinkedParentsIfChanged(ref, LINKS)).resolves.toBe(true)
    })
})
