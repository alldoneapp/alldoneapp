/**
 * @jest-environment jsdom
 */

// An unregistered visitor opening a public note must get through the anonymous boot without
// reading the note creator's private /users document. Firestore correctly rejects that read.

import { getNoteMeta, getProjectData, loginWithGoogleWebAnonymously } from '../../utils/backends/firestore'
import { getUserData } from '../../utils/backends/Users/usersFirestore'
import SharedHelper from '../../utils/SharedHelper'

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
    getNoteMeta: jest.fn(),
    getProjectData: jest.fn(),
    loginWithGoogleWebAnonymously: jest.fn(),
}))

jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Users/usersFirestore'),
    getUserData: jest.fn(),
}))

const PUBLIC_NOTE_URL = 'https://my.alldone.app/projects/i4lHsMvjDoyqa1VjGxDO/notes/3C5Ty9yvBDok2AH01r2u/editor'
const PUBLIC_NOTE_PATH = new URL(PUBLIC_NOTE_URL).pathname
const PROJECT_ID = 'i4lHsMvjDoyqa1VjGxDO'
const NOTE_ID = '3C5Ty9yvBDok2AH01r2u'

describe('public note URL routing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        loginWithGoogleWebAnonymously.mockResolvedValue()
        getNoteMeta.mockResolvedValue({
            id: NOTE_ID,
            creatorId: 'note-creator',
            isPublicFor: [0],
        })
        getProjectData.mockResolvedValue({
            id: PROJECT_ID,
            creatorId: 'project-creator',
            isShared: 0,
            isTemplate: false,
            parentTemplateId: null,
        })
    })

    it('opens the note anonymously without reading its creator private profile', async () => {
        const onIsMember = jest.fn()
        const onIsShared = jest.fn()
        const onNotShared = jest.fn()
        const onNotMatch = jest.fn()

        expect(SharedHelper.matchesSharedResourceUrl(PUBLIC_NOTE_PATH)).toBe(true)

        await SharedHelper.processUrl(
            false,
            PUBLIC_NOTE_PATH,
            onIsMember,
            onIsShared,
            onNotShared,
            onNotMatch,
            jest.fn()
        )

        expect(loginWithGoogleWebAnonymously).toHaveBeenCalledTimes(1)
        expect(getNoteMeta).toHaveBeenCalledWith(PROJECT_ID, NOTE_ID)
        expect(getProjectData).toHaveBeenCalledWith(PROJECT_ID)
        expect(getUserData).not.toHaveBeenCalled()
        expect(onIsShared).toHaveBeenCalledWith(
            PUBLIC_NOTE_PATH,
            {
                projectUser: expect.objectContaining({ uid: 'note-creator' }),
                currentUser: expect.objectContaining({ uid: 'note-creator' }),
            },
            expect.objectContaining({ projectId: PROJECT_ID, noteId: NOTE_ID }),
            `/projects/${PROJECT_ID}/notes/${NOTE_ID}`
        )
        expect(onIsMember).not.toHaveBeenCalled()
        expect(onNotShared).not.toHaveBeenCalled()
        expect(onNotMatch).not.toHaveBeenCalled()
    })
})
