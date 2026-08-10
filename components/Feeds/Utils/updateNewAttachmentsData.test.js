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
import { updateNewAttachmentsData, ATTACHMENT_TRIGGER, IMAGE_TRIGGER } from './HelperFunctions'

const NEW = '1'
const newImageToken = (uri, name) =>
    `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${name}${IMAGE_TRIGGER}${NEW}`
const newAttachmentToken = (uri, name) =>
    `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}${NEW}`

const loadingDelta = () =>
    mockDispatch.mock.calls
        .map(([action]) => action && action.type)
        .reduce((total, type) => {
            if (type === 'Start loading data') return total + 1
            if (type === 'Stop loading data') return total - 1
            return total
        }, 0)

describe('updateNewAttachmentsData', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        Backend.storeAttachment.mockReset()
    })

    it('rewrites an uploaded image to its remote uri and balances the loading spinner', async () => {
        Backend.storeAttachment.mockResolvedValue('https://storage/img.png')

        const result = await updateNewAttachmentsData('project-1', `hello ${newImageToken('blob:img', 'shot.png')}`)

        expect(result).toContain('https://storage/img.png')
        expect(result).not.toContain('blob:img')
        expect(loadingDelta()).toBe(0)
    })

    it('releases the loading spinner when an upload fails', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        await expect(
            updateNewAttachmentsData('project-1', `hello ${newAttachmentToken('blob:doc', 'notes.pdf')}`)
        ).resolves.toEqual(expect.any(String))

        expect(loadingDelta()).toBe(0)
    })

    it('keeps the rest of the comment when one attachment fails to upload', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        const result = await updateNewAttachmentsData(
            'project-1',
            `keep this text ${newAttachmentToken('blob:doc', 'notes.pdf')}`
        )

        expect(result).toContain('keep this text')
        expect(loadingDelta()).toBe(0)
    })

    it('does not mark a failed image upload as already stored', async () => {
        Backend.storeAttachment.mockRejectedValue(new Error('network down'))

        const result = await updateNewAttachmentsData('project-1', newImageToken('blob:img', 'shot.png'))

        // Stamping OLD_ATTACHMENT ('0') here would persist the local blob uri as a remote
        // one and render as a permanently broken image.
        expect(result.endsWith(`${IMAGE_TRIGGER}${NEW}`)).toBe(true)
        expect(loadingDelta()).toBe(0)
    })
})
