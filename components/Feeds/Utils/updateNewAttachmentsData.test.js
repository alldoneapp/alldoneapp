/**
 * @jest-environment jsdom
 *
 * AT-2227. `updateNewAttachmentsData` uploads a comment's pending attachments when the
 * comment is submitted. It brackets the work with the global `startLoadingData` /
 * `stopLoadingData` refcount that drives `showLoadingDataSpinner`, and every caller chains
 * a bare `.then(...)` with no `.catch`. A single rejected upload therefore left that
 * spinner on screen for the rest of the session and silently dropped the comment.
 */
jest.mock('../../../utils/BackendBridge', () => ({
    storeAttachment: jest.fn(),
    storeConvertedVideos: jest.fn(),
}))
// The helper's import graph reaches the whole app shell (and through it firestore.js,
// which reads dotenv-injected build constants that do not exist under jest). Only the
// attachment-rewriting part of the module is under test, so stub the heavy edges.
jest.mock('../../../URLSystem/URLSystem', () => ({
    URL_FEEDS_FOLLOWED: '',
    URL_FEEDS_NOT_FOLLOWED: '',
    URL_PROJECT_FEEDS_FOLLOWED: '',
    URL_PROJECT_FEEDS_NOT_FOLLOWED: '',
}))
jest.mock('../../../URLSystem/URLTrigger', () => ({}))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({}))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistantInProject: jest.fn() }))
jest.mock('../../../utils/LinkingHelper', () => ({ getDvMainTabLink: jest.fn(), getDvNoteTabLink: jest.fn() }))
jest.mock('../CommentsTextInput/textInputHelper', () => ({
    LOADED_MODE: '1',
    NEW_ATTACHMENT: '1',
    OLD_ATTACHMENT: '0',
}))

const mockDispatch = jest.fn()
jest.mock('../../../redux/store', () => ({
    dispatch: (...args) => mockDispatch(...args),
    getState: () => ({}),
}))

jest.mock('../../../utils/HelperFunctions', () => ({
    __esModule: true,
    default: {
        resizeImage: jest.fn(async uri => ({ uri })),
        convertURItoBlob: jest.fn(async () => new Blob(['x'])),
    },
}))

import Backend from '../../../utils/BackendBridge'
import {
    updateNewAttachmentsData,
    hasPendingDescriptionAttachments,
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    VIDEO_TRIGGER,
} from './HelperFunctions'

const NEW = '1'
const newImageToken = (uri, name) =>
    `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${name}${IMAGE_TRIGGER}${NEW}`
const newAttachmentToken = (uri, name) =>
    `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}${NEW}`
const newVideoToken = (uri, name) => `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${name}${VIDEO_TRIGGER}${NEW}`

const expectLoadingSettled = () => {
    const actions = mockDispatch.mock.calls.flatMap(([action]) => [action].flat())
    const starts = actions.filter(action => action?.type === 'Start loading operation')
    const finishes = actions.filter(action => action?.type === 'Finish loading operation')
    expect(starts).toHaveLength(1)
    expect(finishes.map(action => action.id)).toEqual(starts.map(action => action.id))
}

describe('updateNewAttachmentsData', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        Backend.storeAttachment.mockReset()
        Backend.storeConvertedVideos.mockReset()
        global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['file']) }))
    })

    it('rewrites an uploaded image to its remote uri and balances the loading spinner', async () => {
        Backend.storeAttachment.mockResolvedValue('https://storage/img.png')

        const result = await updateNewAttachmentsData('project-1', `hello ${newImageToken('blob:img', 'shot.png')}`)

        expect(result).toContain('https://storage/img.png')
        expect(result).not.toContain('blob:img')
        expectLoadingSettled()
    })

    it('releases the loading spinner when an upload fails', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        await expect(
            updateNewAttachmentsData('project-1', `hello ${newAttachmentToken('blob:doc', 'notes.pdf')}`)
        ).resolves.toEqual(expect.any(String))

        expectLoadingSettled()
    })

    it('keeps the rest of the comment when one attachment fails to upload', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        const result = await updateNewAttachmentsData(
            'project-1',
            `keep this text ${newAttachmentToken('blob:doc', 'notes.pdf')}`
        )

        expect(result).toContain('keep this text')
        expectLoadingSettled()
    })

    it('does not mark a failed image upload as already stored', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        const result = await updateNewAttachmentsData('project-1', newImageToken('blob:img', 'shot.png'))

        // Stamping OLD_ATTACHMENT ('0') here would persist the local blob uri as a remote
        // one and render as a permanently broken image.
        expect(result.endsWith(`${IMAGE_TRIGGER}${NEW}`)).toBe(true)
        expectLoadingSettled()
    })

    it.each([
        newImageToken('blob:img', 'shot.png'),
        newAttachmentToken('blob:doc', 'notes.pdf'),
        newVideoToken('blob:video', 'clip.mp4'),
    ])('rejects failed uploads in strict autosave mode: %s', async token => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))
        await expect(updateNewAttachmentsData('project-1', token, { strict: true })).rejects.toThrow('network down')
        expectLoadingSettled()
    })

    it('detects new images, attachments and videos but ignores stored embeds', () => {
        const tokens = [
            newImageToken('blob:img', 'shot.png'),
            newAttachmentToken('blob:doc', 'notes.pdf'),
            newVideoToken('blob:video', 'clip.mp4'),
        ]
        tokens.forEach(token => {
            expect(hasPendingDescriptionAttachments(`text ${token}`)).toBe(true)
            expect(hasPendingDescriptionAttachments(token.slice(0, -1) + '0')).toBe(false)
        })
        expect(hasPendingDescriptionAttachments('ordinary text')).toBe(false)
    })

    it('retains completed uploads when a later upload fails and reuses them on retry', async () => {
        const first = newAttachmentToken('blob:first', 'first.pdf')
        const second = newAttachmentToken('blob:second', 'second.pdf')
        const uploadedTokens = new Map()
        Backend.storeAttachment
            .mockResolvedValueOnce('https://storage/first')
            .mockRejectedValueOnce(new Error('offline'))
        await expect(
            updateNewAttachmentsData('project-1', `${first} ${second}`, { strict: true, uploadedTokens })
        ).rejects.toThrow('offline')
        expect(uploadedTokens.size).toBe(1)
        Backend.storeAttachment.mockResolvedValueOnce('https://storage/second')
        const result = await updateNewAttachmentsData('project-1', `${first} ${second}`, {
            strict: true,
            uploadedTokens,
        })
        expect(Backend.storeAttachment).toHaveBeenCalledTimes(3)
        expect(result).toContain('https://storage/first')
        expect(result).toContain('https://storage/second')
        expect(result).not.toContain('blob:')
    })
})
