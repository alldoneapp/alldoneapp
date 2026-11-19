/**
 * @jest-environment jsdom
 */

// An unregistered visitor opening a public note must get through the anonymous boot without
// reading the note creator's private /users document. Firestore correctly rejects that read.

import { getNoteMeta, getProjectData, loginWithGoogleWebAnonymously } from '../../utils/backends/firestore'
import { getUserData } from '../../utils/backends/Users/usersFirestore'
import SharedHelper, { ANONYMOUS_USER_DATA } from '../../utils/SharedHelper'

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
    getNoteMeta: jest.fn(),
    getProjectData: jest.fn(),
    loginWithGoogleWebAnonymously: jest.fn(),
    mapProjectData: (projectId, project, customData) => ({ id: projectId, ...project, ...customData }),
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
            `/projects/${PROJECT_ID}/notes/${NOTE_ID}`,
            { publicLinkProject: null }
        )
        expect(onIsMember).not.toHaveBeenCalled()
        expect(onNotShared).not.toHaveBeenCalled()
        expect(onNotMatch).not.toHaveBeenCalled()
    })

    describe('a note public link in a private project', () => {
        const denied = () =>
            Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
        const run = async () => {
            const callbacks = { onIsShared: jest.fn(), onNotShared: jest.fn() }
            await SharedHelper.processUrl(
                false,
                PUBLIC_NOTE_PATH,
                jest.fn(),
                callbacks.onIsShared,
                callbacks.onNotShared,
                jest.fn(),
                jest.fn()
            )
            return callbacks
        }

        beforeEach(() => {
            // The visitor may not read the private project at all.
            getProjectData.mockRejectedValue(denied())
        })

        it('opens a private note whose public link is on, with a stand-in project', async () => {
            getNoteMeta.mockResolvedValue({
                id: NOTE_ID,
                creatorId: 'note-creator',
                isPublicFor: ['note-creator'],
                publicLinkEnabled: true,
            })

            const { onIsShared, onNotShared } = await run()

            expect(onNotShared).not.toHaveBeenCalled()
            expect(onIsShared).toHaveBeenCalledTimes(1)
            const [, users, , , options] = onIsShared.mock.calls[0]
            expect(users.projectUser.uid).toBe('note-creator')
            expect(options.publicLinkProject).toEqual(
                expect.objectContaining({ id: PROJECT_ID, isShared: 2, userIds: [], publicNoteLinkOnly: true })
            )
        })

        it('sends the visitor to the private-resource page when the link is off', async () => {
            getNoteMeta.mockRejectedValue(denied())

            const { onIsShared, onNotShared } = await run()

            expect(onIsShared).not.toHaveBeenCalled()
            expect(onNotShared).toHaveBeenCalledTimes(1)
        })

        it('counts only a literal true as an open link', async () => {
            getNoteMeta.mockResolvedValue({ id: NOTE_ID, isPublicFor: ['note-creator'], publicLinkEnabled: 'true' })

            const { onIsShared, onNotShared } = await run()

            expect(onIsShared).not.toHaveBeenCalled()
            expect(onNotShared).toHaveBeenCalledTimes(1)
        })

        it('uses the real project when it is readable and only the note is private', async () => {
            getProjectData.mockResolvedValue({ id: PROJECT_ID, creatorId: 'p', isShared: 0, isTemplate: false })
            getNoteMeta.mockResolvedValue({ id: NOTE_ID, isPublicFor: ['note-creator'], publicLinkEnabled: true })

            const { onIsShared } = await run()

            expect(onIsShared.mock.calls[0][4]).toEqual({ publicLinkProject: null })
        })
    })

    it('gives anonymous embed renderers a complete free-plan user shape', () => {
        expect(ANONYMOUS_USER_DATA).toEqual(
            expect.objectContaining({
                premium: { status: 'free' },
                monthlyTraffic: 0,
                monthlyXp: 0,
            })
        )
    })
})
