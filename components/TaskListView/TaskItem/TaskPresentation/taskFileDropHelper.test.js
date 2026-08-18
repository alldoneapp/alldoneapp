/**
 * @jest-environment jsdom
 */

import {
    addDroppedFilesToTaskDescription,
    appendTokensToDescription,
    buildNewAttachmentToken,
    canDropFilesOnTaskRow,
    isStoredAttachmentToken,
} from './taskFileDropHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { setTaskDescription } from '../../../../utils/backends/Tasks/tasksFirestore'
import Backend from '../../../../utils/BackendBridge'

const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'

jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    ATTACHMENT_TRIGGER: 'EbDsQTD14ahtSR5',
    IMAGE_TRIGGER: 'O2TI5plHBf1QfdY',
    VIDEO_TRIGGER: 'ptPQsef7OeB5eWd',
    updateNewAttachmentsData: jest.fn(),
}))

jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDescription: jest.fn(() => Promise.resolve()),
}))

// textInputHelper pulls the whole editor/redux/Firebase tree in; only these three leaf values
// are used here, and they are reproduced with their real values.
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp']
    const videoExtensions = ['webm', 'mp4', 'mkv', 'flv', 'mov', 'avi']
    const extensionOf = name => String(name).split('.').pop().toLowerCase()
    return {
        NEW_ATTACHMENT: '1',
        fileIsImage: name => imageExtensions.includes(extensionOf(name)),
        fileIsVideo: name => videoExtensions.includes(extensionOf(name)),
    }
})

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { getTaskData: jest.fn(() => Promise.resolve(null)) },
}))

const remoteImageToken = (name = 'photo.png') =>
    `${IMAGE_TRIGGER}https://cdn/full/${name}${IMAGE_TRIGGER}https://cdn/thumb/${name}${IMAGE_TRIGGER}${name}${IMAGE_TRIGGER}0`

const remoteFileToken = (name = 'notes.pdf') =>
    `${ATTACHMENT_TRIGGER}https://cdn/files/${name}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}false`

describe('taskFileDropHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        global.URL.revokeObjectURL = jest.fn()
        Backend.getTaskData.mockResolvedValue(null)
    })

    describe('canDropFilesOnTaskRow', () => {
        const editableRow = {
            accessGranted: true,
            loggedUserCanUpdateObject: true,
            isCalendarTask: false,
            isAssistantTask: false,
            isLocked: false,
            isActiveOrganizeMode: false,
            isSuggested: false,
            inCommentPopup: false,
        }

        it('allows a drop on an ordinary editable row', () => {
            expect(canDropFilesOnTaskRow(editableRow)).toBe(true)
        })

        it.each([
            ['the user is not a project member', 'accessGranted', false],
            ['the user may not update the task in a guide project', 'loggedUserCanUpdateObject', false],
            ['the task is calendar-sourced and read-only', 'isCalendarTask', true],
            ['the task is assigned to an assistant', 'isAssistantTask', true],
            ['the task is locked behind a guide', 'isLocked', true],
            ['the list is in organize mode and the row is a drag handle', 'isActiveOrganizeMode', true],
            ['the row is a suggested task that is not persisted yet', 'isSuggested', true],
            ['the row is the read-only echo inside the comment popup', 'inCommentPopup', true],
        ])('refuses a drop when %s', (_label, key, value) => {
            expect(canDropFilesOnTaskRow({ ...editableRow, [key]: value })).toBe(false)
        })

        it('refuses a drop when called with nothing at all', () => {
            expect(canDropFilesOnTaskRow()).toBe(false)
        })
    })

    describe('buildNewAttachmentToken', () => {
        it('encodes an image with the duplicated uri slot the editor uses for the thumbnail', () => {
            expect(buildNewAttachmentToken('photo.png', 'blob:x')).toBe(
                `${IMAGE_TRIGGER}blob:x${IMAGE_TRIGGER}blob:x${IMAGE_TRIGGER}photo.png${IMAGE_TRIGGER}1`
            )
        })

        it('encodes a video with the video trigger', () => {
            expect(buildNewAttachmentToken('clip.mp4', 'blob:v')).toBe(
                `${VIDEO_TRIGGER}blob:v${VIDEO_TRIGGER}clip.mp4${VIDEO_TRIGGER}1`
            )
        })

        it('encodes everything else as a plain file attachment', () => {
            expect(buildNewAttachmentToken('notes.pdf', 'blob:f')).toBe(
                `${ATTACHMENT_TRIGGER}blob:f${ATTACHMENT_TRIGGER}notes.pdf${ATTACHMENT_TRIGGER}1`
            )
        })
    })

    describe('isStoredAttachmentToken', () => {
        it('accepts a token whose uris are remote and whose NEW marker is gone', () => {
            expect(isStoredAttachmentToken(remoteImageToken())).toBe(true)
            expect(isStoredAttachmentToken(remoteFileToken())).toBe(true)
        })

        it('rejects an image token that still carries a local blob uri', () => {
            // This is exactly what `updateNewAttachmentsData` returns when the upload failed:
            // the word comes back untouched. Persisting it would store a permanently broken image.
            expect(
                isStoredAttachmentToken(
                    `${IMAGE_TRIGGER}blob:x${IMAGE_TRIGGER}blob:x${IMAGE_TRIGGER}photo.png${IMAGE_TRIGGER}1`
                )
            ).toBe(false)
        })

        it('rejects an image token whose thumbnail alone failed to upload', () => {
            expect(
                isStoredAttachmentToken(
                    `${IMAGE_TRIGGER}https://cdn/full/a.png${IMAGE_TRIGGER}blob:a${IMAGE_TRIGGER}a.png${IMAGE_TRIGGER}0`
                )
            ).toBe(false)
        })

        it('rejects empty and unrecognised words', () => {
            expect(isStoredAttachmentToken('')).toBe(false)
            expect(isStoredAttachmentToken(undefined)).toBe(false)
            expect(isStoredAttachmentToken('just some text')).toBe(false)
        })
    })

    describe('appendTokensToDescription', () => {
        it('preserves the existing description verbatim and separates with a line break', () => {
            const existing = 'Ship the release @user#123'
            expect(appendTokensToDescription(existing, ['TOKEN'])).toBe(`${existing}\n TOKEN`)
        })

        it('keeps each token as its own space-separated word', () => {
            expect(appendTokensToDescription('text', ['A', 'B'])).toBe('text\n A B')
        })

        it('does not add a leading break to an empty description', () => {
            expect(appendTokensToDescription('', ['TOKEN'])).toBe('TOKEN')
            expect(appendTokensToDescription('   ', ['TOKEN'])).toBe('TOKEN')
            expect(appendTokensToDescription(undefined, ['TOKEN'])).toBe('TOKEN')
        })

        it('does not double the break when the description already ends with one', () => {
            expect(appendTokensToDescription('text\n', ['TOKEN'])).toBe('text\n TOKEN')
        })

        it('returns the description untouched when there is nothing to append', () => {
            expect(appendTokensToDescription('text', [])).toBe('text')
        })
    })

    describe('addDroppedFilesToTaskDescription', () => {
        const task = { id: 'task-1', description: 'Existing description' }

        it('uploads every file and appends the stored tokens to the existing description', async () => {
            updateNewAttachmentsData
                .mockResolvedValueOnce(remoteImageToken('photo.png'))
                .mockResolvedValueOnce(remoteFileToken('notes.pdf'))

            const result = await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [
                    { name: 'photo.png', size: 1024 },
                    { name: 'notes.pdf', size: 2048 },
                ],
            })

            expect(result).toEqual({ addedCount: 2, failedCount: 0 })
            expect(setTaskDescription).toHaveBeenCalledTimes(1)
            expect(setTaskDescription).toHaveBeenCalledWith(
                'project-1',
                'task-1',
                `Existing description\n ${remoteImageToken('photo.png')} ${remoteFileToken('notes.pdf')}`,
                task,
                'Existing description'
            )
        })

        it('normalises whitespace in the file name, like every other attachment path', async () => {
            updateNewAttachmentsData.mockResolvedValueOnce(remoteImageToken('my_photo.png'))

            await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'my photo.png', size: 10 }],
            })

            expect(updateNewAttachmentsData).toHaveBeenCalledWith(
                'project-1',
                `${IMAGE_TRIGGER}blob:my photo.png${IMAGE_TRIGGER}blob:my photo.png${IMAGE_TRIGGER}my_photo.png${IMAGE_TRIGGER}1`
            )
        })

        it('never writes a description when every upload failed', async () => {
            // `updateNewAttachmentsData` resolves with the word unchanged on failure.
            updateNewAttachmentsData.mockImplementation(async (projectId, token) => token)

            const result = await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(result).toEqual({ addedCount: 0, failedCount: 1 })
            expect(setTaskDescription).not.toHaveBeenCalled()
        })

        it('still saves the files that worked when one of them failed', async () => {
            updateNewAttachmentsData
                .mockImplementationOnce(async (projectId, token) => token)
                .mockResolvedValueOnce(remoteFileToken('notes.pdf'))

            const result = await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [
                    { name: 'photo.png', size: 1024 },
                    { name: 'notes.pdf', size: 2048 },
                ],
            })

            expect(result).toEqual({ addedCount: 1, failedCount: 1 })
            expect(setTaskDescription).toHaveBeenCalledWith(
                'project-1',
                'task-1',
                `Existing description\n ${remoteFileToken('notes.pdf')}`,
                task,
                'Existing description'
            )
        })

        it('treats a thrown upload as a failure instead of propagating it', async () => {
            updateNewAttachmentsData.mockRejectedValueOnce(new Error('network down'))

            const result = await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(result).toEqual({ addedCount: 0, failedCount: 1 })
            expect(setTaskDescription).not.toHaveBeenCalled()
        })

        it('rejects oversized files through the shared size gate without touching the task', async () => {
            const result = await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'huge.png', size: 60 * 1024 * 1024 }],
            })

            expect(global.alert).toHaveBeenCalled()
            expect(updateNewAttachmentsData).not.toHaveBeenCalled()
            expect(setTaskDescription).not.toHaveBeenCalled()
            expect(result).toEqual({ addedCount: 0, failedCount: 0 })
        })

        it('releases the object urls it created', async () => {
            updateNewAttachmentsData.mockResolvedValueOnce(remoteImageToken('photo.png'))

            await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo.png')
        })

        it('appends to the freshest description rather than the snapshot the row was rendered with', async () => {
            updateNewAttachmentsData.mockResolvedValueOnce(remoteImageToken('photo.png'))
            const freshTask = { id: 'task-1', description: 'Edited while the upload was running' }
            Backend.getTaskData.mockResolvedValueOnce(freshTask)

            await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(setTaskDescription).toHaveBeenCalledWith(
                'project-1',
                'task-1',
                `Edited while the upload was running\n ${remoteImageToken('photo.png')}`,
                freshTask,
                'Edited while the upload was running'
            )
        })

        it('falls back to the row snapshot when the fresh read fails', async () => {
            updateNewAttachmentsData.mockResolvedValueOnce(remoteImageToken('photo.png'))
            Backend.getTaskData.mockRejectedValueOnce(new Error('offline'))

            await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(setTaskDescription).toHaveBeenCalledWith(
                'project-1',
                'task-1',
                `Existing description\n ${remoteImageToken('photo.png')}`,
                task,
                'Existing description'
            )
        })

        it('treats a task with no description yet as an empty one', async () => {
            updateNewAttachmentsData.mockResolvedValueOnce(remoteImageToken('photo.png'))
            const emptyTask = { id: 'task-2' }

            await addDroppedFilesToTaskDescription({
                projectId: 'project-1',
                task: emptyTask,
                files: [{ name: 'photo.png', size: 1024 }],
            })

            expect(setTaskDescription).toHaveBeenCalledWith(
                'project-1',
                'task-2',
                remoteImageToken('photo.png'),
                emptyTask,
                ''
            )
        })
    })
})
