import { getNoteFilterStateUpdate } from './noteFilterSubscription'

describe('getNoteFilterStateUpdate', () => {
    const currentState = {
        hashtagFilters: ['roadmap'],
        noteOwnerFilters: ['owner-1'],
    }

    it('skips a component update when an unrelated Redux action leaves the filters unchanged', () => {
        const storeState = {
            hashtagFilters: new Map([['roadmap', true]]),
            noteOwnerFilters: ['owner-1'],
        }

        expect(getNoteFilterStateUpdate(currentState, storeState)).toBeNull()
    })

    it('updates when either note filter changes', () => {
        const storeState = {
            hashtagFilters: new Map([
                ['roadmap', true],
                ['launch', true],
            ]),
            noteOwnerFilters: ['owner-2'],
        }

        expect(getNoteFilterStateUpdate(currentState, storeState)).toEqual({
            hashtagFilters: ['roadmap', 'launch'],
            noteOwnerFilters: ['owner-2'],
        })
    })
})
