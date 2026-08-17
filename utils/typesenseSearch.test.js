import { adaptTypesenseHit } from './typesenseSearch'

describe('adaptTypesenseHit', () => {
    it('restores the numeric public sentinel while preserving user ids', () => {
        const hit = adaptTypesenseHit({
            document: {
                id: 'goal-1project-1',
                projectId: 'project-1',
                isPublicFor: ['0', 'user-1'],
            },
        })

        expect(hit).toEqual(
            expect.objectContaining({
                id: 'goal-1',
                objectID: 'goal-1project-1',
                isPublicFor: [0, 'user-1'],
            })
        )
    })

    it('keeps already normalized and missing privacy data unchanged', () => {
        expect(adaptTypesenseHit({ document: { id: 'goal-1', isPublicFor: [0] } }).isPublicFor).toEqual([0])
        expect(adaptTypesenseHit({ document: { id: 'goal-2' } })).not.toHaveProperty('isPublicFor')
    })
})
