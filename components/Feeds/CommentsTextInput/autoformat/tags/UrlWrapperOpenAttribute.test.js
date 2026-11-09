/**
 * @jest-environment jsdom
 *
 * security audit 2026-11 (UrlWrapper remote-embed-open-attribute-runs-performAction-on-mount):
 * a url embed's `open` attribute is shared note content. A collaborator could plant
 * `{ type: 'preConfigTask', open: true, url }` and every member who opened the note ran that
 * pre-configured prompt, with their own Gold and tool authority, without pressing anything.
 *
 * Mounting an embed must never run its action; a press must, and a prompt the viewer did not
 * write is shown to them first.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockDispatch = jest.fn()
const mockResolvePreConfigTaskLink = jest.fn()
const mockGenerateTaskFromPreConfig = jest.fn()
const mockSetIframeModalData = jest.fn((...args) => ({ type: 'setIframeModalData', args }))
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(
            'div',
            null,
            children,
            isOpen ? React.createElement('div', { 'data-popover': 'open' }, content) : null
        )
})
jest.mock('../../../../NotesView/NotesDV/EditorView/TagsInteractionPopup', () => {
    const React = require('react')
    return () => React.createElement('span', { 'data-edit-field': 'true' })
})
jest.mock('../../../../NotesView/NotesDV/EditorView/NotesEditorView', () => ({ exportRef: null }))
jest.mock('../../CustomTextInput3', () => ({ quillTextInputIsCalendarTask: {}, quillTextInputRefs: {} }))
jest.mock('../../../../../utils/LinkingHelper', () => ({
    addProtocol: url => url,
    formatUrl: url => url,
    getUrlObject: () => ({}),
    isValidPreConfigTaskLink: url => /\/preConfigTasks\//.test(url || ''),
}))
jest.mock('../../textInputHelper', () => ({ getQuillEditorRef: () => ({ editorRef: null, inNote: true }) }))
jest.mock('../../../../../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('../../../../../utils/NavigationService', () => ({}))
jest.mock('../../../../Tags/LinkTag', () => {
    const React = require('react')
    const LinkTag = ({ onPress, link }) => React.createElement('button', { 'data-chip': link, onClick: onPress })
    return { __esModule: true, default: LinkTag, getPathname: url => url }
})
jest.mock('../../../../../utils/backends/Assistants/assistantsFirestore', () => ({ getAssistantData: jest.fn() }))
jest.mock('../../../../../utils/preConfigTaskLink', () => ({
    resolvePreConfigTaskLink: (...args) => mockResolvePreConfigTaskLink(...args),
}))
jest.mock('../../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: () => null,
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: () => false,
}))
jest.mock('../../../../../redux/actions', () => ({
    setPreConfigTaskModalData: (...args) => ({ type: 'setPreConfigTaskModalData', args }),
    setIframeModalData: (...args) => mockSetIframeModalData(...args),
}))
jest.mock('../../../../../utils/assistantHelper', () => ({
    generateTaskFromPreConfig: (...args) => mockGenerateTaskFromPreConfig(...args),
}))
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    COMMENT_MODAL_ID: 'c',
    exitsOpenModals: () => false,
    FOLLOW_UP_MODAL_ID: 'f',
    getModalParams: () => null,
    MANAGE_TASK_MODAL_ID: 'm',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
    TAGS_EDIT_OBJECT_MODAL_ID: 't',
    TASK_DESCRIPTION_MODAL_ID: 'd',
    WORKFLOW_MODAL_ID: 'w',
}))
jest.mock('../../../Utils/HelperFunctions', () => ({ REGEX_URL: /^https?:\/\// }))
jest.mock('react-quill-new', () => ({ Quill: { import: () => function Delta() {} } }))
jest.mock('../../../../EditObjectsInLinks/EditObjectsInLinks', () => () => null)
jest.mock('./legacyEmailUrlFragment', () => ({ isLegacyEmailUrlFragment: () => false }))
jest.mock('../../../../../i18n/TranslationService', () => ({
    translate: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
}))

const { default: UrlWrapper, shouldOpenLinkEditorOnMount } = require('./UrlWrapper')

const ATTACKER = 'attackerUid'
const VIEWER = 'viewerUid'
const TASK_URL = 'https://my.alldone.app/projects/P/preConfigTasks/T?assistantId=ASST&name=Meeting%20notes'

const plantedEmbed = (overrides = {}) => ({
    open: true,
    type: 'preConfigTask',
    url: TASK_URL,
    id: 'tag1',
    editorId: 'NOTE',
    urlBoundary: '',
    userIdAllowedToEditTags: ATTACKER,
    ...overrides,
})

const flush = () => act(async () => {})

describe('UrlWrapper never acts on a stored `open` attribute', () => {
    let container
    let root
    let windowOpen
    let windowConfirm

    const render = value =>
        act(() => {
            root.render(<UrlWrapper value={value} objectName="Meeting notes" isShared={false} embedNode={null} />)
        })

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        jest.useFakeTimers()
        mockState = {
            virtualQuillLoaded: false,
            quillEditorProjectId: 'P',
            loggedUser: { uid: VIEWER, isAnonymous: false },
            activeNoteIsReadOnly: false,
            activeNoteId: 'NOTE',
        }
        windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null)
        windowConfirm = jest.spyOn(window, 'confirm').mockImplementation(() => false)
        jest.spyOn(window, 'alert').mockImplementation(() => {})
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        jest.runOnlyPendingTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
        mockResolvePreConfigTaskLink.mockReset()
        mockGenerateTaskFromPreConfig.mockReset()
        mockDispatch.mockReset()
        mockSetIframeModalData.mockClear()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it.each([
        ['a prompt task', { type: 'prompt', name: 'Planted', prompt: 'PLANTED PROMPT', creatorUserId: ATTACKER }],
        ['an iframe task', { type: 'iframe', name: 'Planted', link: 'https://attacker.example/embed/create-roadmap' }],
        ['a link task', { type: 'link', name: 'Planted', link: 'https://attacker.example/' }],
    ])('mounting a planted pre-configured task embed (%s) runs nothing', async (_, task) => {
        mockResolvePreConfigTaskLink.mockResolvedValue({
            task,
            assistantId: 'ASST',
            assistantProjectId: 'P',
            targetProjectId: 'P',
        })

        render(plantedEmbed())
        await flush()
        act(() => jest.advanceTimersByTime(2000))
        await flush()

        expect(mockResolvePreConfigTaskLink).not.toHaveBeenCalled()
        expect(mockGenerateTaskFromPreConfig).not.toHaveBeenCalled()
        expect(mockSetIframeModalData).not.toHaveBeenCalled()
        expect(windowOpen).not.toHaveBeenCalled()
        expect(container.querySelector('[data-popover="open"]')).toBeNull()
    })

    it('a planted embed in a read-only note runs nothing either', async () => {
        mockState.activeNoteIsReadOnly = true
        render(plantedEmbed())
        await flush()

        expect(mockResolvePreConfigTaskLink).not.toHaveBeenCalled()
        expect(mockGenerateTaskFromPreConfig).not.toHaveBeenCalled()
    })

    it('a press shows someone else’s prompt first and runs nothing when declined', async () => {
        mockResolvePreConfigTaskLink.mockResolvedValue({
            task: { type: 'prompt', name: 'Planted', prompt: 'PLANTED PROMPT', creatorUserId: ATTACKER },
            assistantId: 'ASST',
            assistantProjectId: 'P',
            targetProjectId: 'P',
        })
        render(plantedEmbed({ open: false }))

        await act(async () => {
            container.querySelector('[data-chip]').click()
        })

        expect(windowConfirm).toHaveBeenCalledTimes(1)
        expect(windowConfirm.mock.calls[0][0]).toContain('PLANTED PROMPT')
        expect(mockGenerateTaskFromPreConfig).not.toHaveBeenCalled()
    })

    it('a press runs someone else’s prompt once the viewer confirms', async () => {
        windowConfirm.mockImplementation(() => true)
        mockResolvePreConfigTaskLink.mockResolvedValue({
            task: { type: 'prompt', name: 'Planted', prompt: 'PLANTED PROMPT', creatorUserId: ATTACKER },
            assistantId: 'ASST',
            assistantProjectId: 'P',
            targetProjectId: 'P',
        })
        render(plantedEmbed({ open: false }))

        await act(async () => {
            container.querySelector('[data-chip]').click()
        })

        expect(mockGenerateTaskFromPreConfig).toHaveBeenCalledWith(
            'P',
            'Planted',
            'ASST',
            'PLANTED PROMPT',
            null,
            expect.any(Object)
        )
    })

    it('a press on a prompt the viewer approved runs it without asking', async () => {
        const {
            computeAssistantTaskContentHash,
        } = require('../../../../../functions/Assistant/assistantTaskContentHash')
        const mine = { type: 'prompt', name: 'Mine', prompt: 'MY PROMPT', creatorUserId: VIEWER }
        mockResolvePreConfigTaskLink.mockResolvedValue({
            task: { ...mine, approvedContentHashByUser: { [VIEWER]: computeAssistantTaskContentHash(mine) } },
            assistantId: 'ASST',
            assistantProjectId: 'P',
            targetProjectId: 'P',
        })
        render(plantedEmbed({ open: false, userIdAllowedToEditTags: VIEWER }))

        await act(async () => {
            container.querySelector('[data-chip]').click()
        })

        expect(windowConfirm).not.toHaveBeenCalled()
        expect(mockGenerateTaskFromPreConfig).toHaveBeenCalledTimes(1)
    })

    it('still opens the edit field of the empty link the viewer just inserted from the toolbar', () => {
        render(plantedEmbed({ type: '', url: '', userIdAllowedToEditTags: VIEWER }))

        expect(container.querySelector('[data-edit-field]')).not.toBeNull()
        expect(mockResolvePreConfigTaskLink).not.toHaveBeenCalled()
    })
})

describe('shouldOpenLinkEditorOnMount', () => {
    const fresh = { open: true, url: '', userIdAllowedToEditTags: VIEWER }

    it('opens only an empty link the viewer owns', () => {
        expect(shouldOpenLinkEditorOnMount(fresh, VIEWER)).toBe(true)
        expect(shouldOpenLinkEditorOnMount({ ...fresh, url: TASK_URL }, VIEWER)).toBe(false)
        expect(shouldOpenLinkEditorOnMount({ ...fresh, userIdAllowedToEditTags: ATTACKER }, VIEWER)).toBe(false)
        expect(shouldOpenLinkEditorOnMount({ ...fresh, open: false }, VIEWER)).toBe(false)
        expect(shouldOpenLinkEditorOnMount(fresh, VIEWER, { virtualQuillLoaded: true })).toBe(false)
        expect(shouldOpenLinkEditorOnMount(fresh, VIEWER, { inReadOnlyNote: true })).toBe(false)
        expect(shouldOpenLinkEditorOnMount(fresh, undefined)).toBe(false)
    })
})
