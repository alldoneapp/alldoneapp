import {
    beginLocalContactMove,
    finishLocalContactMove,
    isLocalContactMovePending,
    isProjectMovePending,
    subscribeLocalContactMoves,
    SUPPORTED_PROJECT_MOVE_TYPES,
} from './projectMoveState'

describe('project move list state', () => {
    it('covers every object type exposed by the project picker', () => {
        expect(SUPPORTED_PROJECT_MOVE_TYPES).toEqual(['task', 'note', 'goal', 'contact', 'chat', 'skill'])
    })

    it('stays pending for a source marker or an active durable move', () => {
        expect(isProjectMovePending({ movingToOtherProjectId: 'project-b' })).toBe(true)
        expect(isProjectMovePending({ projectMove: { status: 'moving' } })).toBe(true)
    })

    it('stops for completed and failed moves', () => {
        expect(isProjectMovePending({ projectMove: { status: 'completed' } })).toBe(false)
        expect(isProjectMovePending({ projectMove: { status: 'failed' } })).toBe(false)
        expect(isProjectMovePending({ movingToOtherProjectId: 'project-b', projectMove: { status: 'failed' } })).toBe(
            false
        )
        expect(isProjectMovePending({})).toBe(false)
    })

    it('shows local contact progress before the worker marker and clears it on settlement', () => {
        const listener = jest.fn()
        const unsubscribe = subscribeLocalContactMoves(listener)
        const finish = beginLocalContactMove('source', 'contact')
        expect(isLocalContactMovePending('source', 'contact')).toBe(true)
        expect(isLocalContactMovePending('target', 'contact')).toBe(false)
        expect(isLocalContactMovePending('source', 'other')).toBe(false)
        finishLocalContactMove('source', 'contact')
        expect(isLocalContactMovePending('source', 'contact')).toBe(false)
        finish()
        expect(listener).toHaveBeenCalledTimes(2)
        unsubscribe()
    })

    it('keeps a second pending request and expires abandoned local progress', () => {
        jest.useFakeTimers()
        try {
            const finishFirst = beginLocalContactMove('source', 'contact')
            const finishSecond = beginLocalContactMove('source', 'contact')
            finishFirst()
            expect(isLocalContactMovePending('source', 'contact')).toBe(true)
            jest.advanceTimersByTime(300000)
            expect(isLocalContactMovePending('source', 'contact')).toBe(false)
            finishSecond()
        } finally {
            jest.useRealTimers()
        }
    })
})
