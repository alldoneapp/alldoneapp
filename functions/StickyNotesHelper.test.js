const { checkStickyNotes } = require('./StickyNotesHelper')

const NOW = 1_800_000_000_000

const createAdmin = ({ markers, notes }) => {
    const writes = []
    const db = {
        collection: name => ({
            where: (field, op, value) => ({
                get: async () => {
                    expect([name, field, op, value]).toEqual(['stickyNotesData', 'stickyEndDate', '<', NOW])
                    return {
                        docs: Object.entries(markers).map(([id, data]) => ({ id, data: () => data })),
                    }
                },
            }),
        }),
        doc: path => ({
            get: async () => ({ id: path.split('/').pop(), data: () => notes[path] }),
            update: async data => writes.push(['update', path, data]),
            set: async data => writes.push(['set', path, data]),
            delete: async () => writes.push(['delete', path]),
        }),
    }
    return { admin: { firestore: () => db }, writes }
}

describe('checkStickyNotes', () => {
    it('demotes a note whose own sticky period is over and drops its marker', async () => {
        const { admin, writes } = createAdmin({
            markers: { n1: { projectId: 'p1', stickyEndDate: NOW - 1 } },
            notes: { 'noteItems/p1/notes/n1': { stickyData: { days: 3, stickyEndDate: NOW - 1 } } },
        })
        await checkStickyNotes(admin, NOW)
        expect(writes).toEqual([
            ['update', 'noteItems/p1/notes/n1', { stickyData: { days: 0, stickyEndDate: 0 } }],
            ['delete', 'stickyNotesData/n1'],
        ])
    })

    // security audit 2026-11 (NV-13): a marker rewritten to an earlier date must not unstick a note
    // that is still sticky by its own data.
    it('keeps a note that is still sticky by its own end date and re-arms its marker', async () => {
        const { admin, writes } = createAdmin({
            markers: { n1: { projectId: 'p1', stickyEndDate: 0 } },
            notes: { 'noteItems/p1/notes/n1': { stickyData: { days: 7, stickyEndDate: NOW + 1000 } } },
        })
        await checkStickyNotes(admin, NOW)
        expect(writes).toEqual([['set', 'stickyNotesData/n1', { projectId: 'p1', stickyEndDate: NOW + 1000 }]])
    })

    it('only drops markers of notes that are missing or no longer sticky', async () => {
        const { admin, writes } = createAdmin({
            markers: {
                gone: { projectId: 'p1', stickyEndDate: 1 },
                unstuck: { projectId: 'p1', stickyEndDate: 1 },
                broken: { stickyEndDate: 1 },
            },
            notes: { 'noteItems/p1/notes/unstuck': { stickyData: { days: 0, stickyEndDate: 0 } } },
        })
        await checkStickyNotes(admin, NOW)
        expect(writes).toEqual([
            ['delete', 'stickyNotesData/gone'],
            ['delete', 'stickyNotesData/unstuck'],
            ['delete', 'stickyNotesData/broken'],
        ])
    })
})
