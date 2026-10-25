jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: jest.fn(() => ({
        photoURL: 'karsten.png',
        displayName: 'Karsten Wysk',
        shortName: 'Karsten',
        isProjectUser: true,
    })),
}))

import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'
import { getFeedCreatorPresentationData } from './feedCreatorPresentation'

describe('getFeedCreatorPresentationData', () => {
    test("labels an entry the user's MCP client wrote, keeping the user's avatar", () => {
        const data = getFeedCreatorPresentationData('project-1', {
            creatorId: 'user-1',
            via: 'mcp',
            viaClient: 'Codex',
        })

        expect(getUserPresentationDataInProject).toHaveBeenCalledWith('project-1', 'user-1')
        expect(data).toEqual({
            photoURL: 'karsten.png',
            displayName: 'Karsten Wysk (via Codex)',
            shortName: 'Karsten (via Codex)',
            isProjectUser: true,
        })
    })

    test('shows an entry the user wrote themselves as before', () => {
        expect(getFeedCreatorPresentationData('project-1', { creatorId: 'user-1' })).toEqual(
            expect.objectContaining({ displayName: 'Karsten Wysk', shortName: 'Karsten' })
        )
    })
})
