jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: { uid: 'bob' } }), dispatch: jest.fn() },
}))

const { buildOwnActivationUpdate } = require('./assistantsFirestore')

describe('buildOwnActivationUpdate (security audit 2026-11)', () => {
    const stored = {
        prompt: 'Summarize my day',
        creatorUserId: 'ann',
        activatorUserId: 'ann',
        activatedUserIds: ['ann'],
        recurrenceByUser: { ann: 'daily' },
        lastExecutedByUser: { ann: 1000 },
    }

    it("adds only the editor's own activation to the stored state, whatever the modal loaded", () => {
        const update = buildOwnActivationUpdate({
            currentTask: stored,
            // A stale modal copy that still lists a user who has since switched off.
            editedTask: {
                activatorUserId: 'bob',
                activatedUserIds: ['ann', 'carl', 'bob'],
                recurrenceByUser: { ann: 'weekly', carl: 'daily', bob: 'daily' },
                lastExecutedByUser: { ann: 1 },
            },
            userId: 'bob',
            payload: { prompt: 'Summarize my day', activatedUserIds: ['ann', 'carl', 'bob'], lastExecutedByUser: {} },
        })

        expect(update.activatedUserIds).toEqual(['ann', 'bob'])
        expect(update.recurrenceByUser).toEqual({ ann: 'daily', bob: 'daily' })
        expect(update).not.toHaveProperty('lastExecutedByUser')
        expect(update.activatorUserId).toBe('bob')
        expect(update).not.toHaveProperty('creatorUserId')
        expect(update.prompt).toBe('Summarize my day')
    })

    it("removes only the editor's own activation", () => {
        const update = buildOwnActivationUpdate({
            currentTask: {
                ...stored,
                activatedUserIds: ['ann', 'bob'],
                recurrenceByUser: { ann: 'daily', bob: 'daily' },
            },
            editedTask: { activatorUserId: 'bob', activatedUserIds: [], recurrenceByUser: {} },
            userId: 'bob',
            payload: {},
        })

        expect(update.activatedUserIds).toEqual(['ann'])
        expect(update.recurrenceByUser).toEqual({ ann: 'daily' })
    })
})
