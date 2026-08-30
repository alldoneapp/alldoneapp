import { SERVER_ACCESS_PROJECTION_FIELDS, withoutServerAccessProjection } from './accessProjection'

describe('withoutServerAccessProjection', () => {
    it('removes every server-owned access field while preserving move data', () => {
        const source = {
            id: 'task-1',
            projectId: 'project-b',
            isPublicFor: [0],
            readerIds: [0, 'user-1'],
            roleIdsVisibleTo: { 'user-1': ['user-1'] },
            followedByVisibleTo: { 'user-1': true },
            followedReaderIds: ['user-1'],
            backlinkIdsVisibleTo: { 'user-1': ['token'] },
            nested: { keep: true },
        }

        const result = withoutServerAccessProjection(source)

        expect(result).toEqual({
            id: 'task-1',
            projectId: 'project-b',
            isPublicFor: [0],
            nested: { keep: true },
        })
        expect(SERVER_ACCESS_PROJECTION_FIELDS.every(field => !(field in result))).toBe(true)
        expect(source.readerIds).toEqual([0, 'user-1'])
    })

    it('passes through non-document values', () => {
        expect(withoutServerAccessProjection(null)).toBeNull()
        expect(withoutServerAccessProjection('value')).toBe('value')
        expect(withoutServerAccessProjection(['readerIds'])).toEqual(['readerIds'])
    })
})
