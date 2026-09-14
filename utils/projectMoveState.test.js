import { isProjectMovePending, SUPPORTED_PROJECT_MOVE_TYPES } from './projectMoveState'

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
        expect(isProjectMovePending({})).toBe(false)
    })
})
