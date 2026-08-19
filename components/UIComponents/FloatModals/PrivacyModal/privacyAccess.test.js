import { mergeRequiredPrivateAccess } from './privacyAccess'

describe('mergeRequiredPrivateAccess', () => {
    it('keeps a non-owner editor alongside the owner when making an object private', () => {
        expect(mergeRequiredPrivateAccess(['owner-id'], ['owner-id'], 'editor-id')).toEqual(['owner-id', 'editor-id'])
    })

    it('does not duplicate already-selected required users', () => {
        expect(mergeRequiredPrivateAccess(['editor-id', 'owner-id'], ['owner-id'], 'editor-id')).toEqual([
            'editor-id',
            'owner-id',
        ])
    })

    it('does not mutate the current selection', () => {
        const selectedUserIds = ['collaborator-id']

        mergeRequiredPrivateAccess(selectedUserIds, ['owner-id'], 'editor-id')

        expect(selectedUserIds).toEqual(['collaborator-id'])
    })
})
