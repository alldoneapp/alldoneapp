/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import PendingAssistantCommentWrapper from './PendingAssistantCommentWrapper'
import { PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED, PENDING_SEND_SENDING } from '../assistantLinePendingSend'

const mockState = { openModals: {}, assistantEnabled: false, isQuillTagEditorOpen: false }
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params?.name ? `${key}:${params.name}` : key),
}))

jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))

// The popover half. Everything below is only reachable once the thread exists, and each of these
// modules drags the redux store or the comments backend into the suite.
jest.mock('../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ content, children }) => (
        <View testID="pending-popover">
            <View testID="pending-popover-content">{content}</View>
            {children}
        </View>
    )
})

const mockRichCommentProps = { current: null }
jest.mock('../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => {
        mockRichCommentProps.current = props
        return <View testID="rich-comment-modal" />
    }
})

jest.mock('../../../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'SHOW_FLOAT_POPUP' }),
    hideFloatPopup: () => ({ type: 'HIDE_FLOAT_POPUP' }),
}))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 'stayward' }))
jest.mock('../../../../utils/HelperFunctions', () => ({
    popoverToTop: () => ({ top: 80, left: 0 }),
    popoverToTopContainerStyle: {},
}))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
// Only modal-id constants are used from here, but the real module imports `redux/store`, i.e. the
// whole backend graph.
jest.mock('../../../ModalsManager/modalsManager', () => ({
    BOT_OPTION_MODAL_ID: 'bot-option',
    BOT_WARNING_MODAL_ID: 'bot-warning',
    MENTION_MODAL_ID: 'mention',
    RUN_OUT_OF_GOLD_MODAL_ID: 'run-out-of-gold',
}))
const mockCreateObjectMessage = jest.fn(() => Promise.resolve())
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    createObjectMessage: (...args) => mockCreateObjectMessage(...args),
}))

const pending = (overrides = {}) => ({
    id: 'assistant-line-send-1',
    projectId: 'project-1',
    assistantId: 'assistant-1',
    assistantName: 'Anna',
    text: 'ship the thing',
    chatId: null,
    chatTitle: '',
    status: PENDING_SEND_SENDING,
    ...overrides,
})

const created = (overrides = {}) =>
    pending({
        chatId: 'chat-1',
        chatTitle: 'Anna <> Karsten 07.09.2026 3',
        status: PENDING_SEND_AWAITING_REPLY,
        ...overrides,
    })

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(<PendingAssistantCommentWrapper pending={pending()} {...props} />)
    })
    return tree
}

const press = tree => {
    const card = tree.root.findByProps({ testID: 'assistant-pending-send' }, { deep: false })
    act(() => card.props.onPress())
}

const statusOf = tree => tree.root.findByProps({ testID: 'assistant-pending-send-status' }).props.children
const has = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length > 0

describe('PendingAssistantCommentWrapper (AT-2523)', () => {
    beforeEach(() => {
        mockState.openModals = {}
        mockState.assistantEnabled = false
        mockState.isQuillTagEditorOpen = false
        mockDispatch.mockClear()
        mockCreateObjectMessage.mockClear()
        mockRichCommentProps.current = null
    })

    it('opens the thread when the topic already exists', () => {
        const tree = render({ pending: created() })
        expect(has(tree, 'pending-popover')).toBe(false)

        press(tree)

        expect(has(tree, 'pending-popover')).toBe(true)
        expect(mockRichCommentProps.current.objectId).toBe('chat-1')
        expect(mockRichCommentProps.current.objectType).toBe('topics')
        expect(mockRichCommentProps.current.projectId).toBe('project-1')
        // The popover names the object it is commenting on; the title travels on the pending entry
        // because the thread it would otherwise be read from was created a moment ago.
        expect(mockRichCommentProps.current.objectName).toBe('Anna <> Karsten 07.09.2026 3')
        act(() => tree.unmount())
    })

    describe('the window where there is no thread yet', () => {
        it('remembers the tap instead of dropping it, and says it is opening', () => {
            const tree = render()

            // `createBotQuickTopic` is two round trips, so this is the ordinary state for about a
            // second after Enter — and the second in which a user is most likely to press.
            press(tree)

            expect(has(tree, 'pending-popover')).toBe(false)
            expect(statusOf(tree)).toBe('assistantLineOpeningThread')
            act(() => tree.unmount())
        })

        it('opens as soon as the topic exists, with no second tap', () => {
            const tree = render()
            press(tree)

            act(() => tree.update(<PendingAssistantCommentWrapper pending={created()} />))

            expect(has(tree, 'pending-popover')).toBe(true)
            expect(mockRichCommentProps.current.objectId).toBe('chat-1')
            act(() => tree.unmount())
        })

        it('does not open a thread nobody asked for', () => {
            // The same transition, without the tap. An armed intent is the ONLY thing that may open
            // this popover — otherwise every send would fling a modal open a second after Enter.
            const tree = render()
            act(() => tree.update(<PendingAssistantCommentWrapper pending={created()} />))

            expect(has(tree, 'pending-popover')).toBe(false)
            act(() => tree.unmount())
        })

        it('gives up on the armed tap when the send fails, rather than waiting forever', () => {
            const tree = render()
            press(tree)
            expect(statusOf(tree)).toBe('assistantLineOpeningThread')

            act(() =>
                tree.update(<PendingAssistantCommentWrapper pending={pending({ status: PENDING_SEND_FAILED })} />)
            )

            expect(has(tree, 'pending-popover')).toBe(false)
            // The failure notice replaces "opening", so the card explains itself rather than
            // claiming to be doing something it has given up on.
            expect(statusOf(tree)).toBe('assistantLineSendFailed')
            act(() => tree.unmount())
        })
    })

    it('is not a press target at all once the send has failed', () => {
        const tree = render({ pending: pending({ status: PENDING_SEND_FAILED }) })
        const card = tree.root.findByProps({ testID: 'assistant-pending-send' }, { deep: false })

        // There is no thread behind a failed send, so the card must not look like a door.
        expect(card.props.onPress).toBeNull()
        act(() => tree.unmount())
    })

    it('tells the area a modal is up, so the card is not pulled out from under the reader', () => {
        // The thing that ends a pending send is the assistant answering — which is not a reason to
        // close a popover the user is reading. `LastCommentArea` holds the card open on this flag.
        const setAModalIsOpen = jest.fn()
        const tree = render({ pending: created(), setAModalIsOpen })

        press(tree)

        expect(setAModalIsOpen).toHaveBeenCalledWith(true)
        act(() => tree.unmount())
    })

    it('replies into the thread the message created', async () => {
        const tree = render({ pending: created() })
        press(tree)

        await act(async () => {
            await mockRichCommentProps.current.processDone('a follow-up', null, null, null, true)
        })

        expect(mockCreateObjectMessage).toHaveBeenCalledTimes(1)
        const [projectId, objectId, comment, objectType] = mockCreateObjectMessage.mock.calls[0]
        expect([projectId, objectId, comment, objectType]).toEqual(['project-1', 'chat-1', 'a follow-up', 'topics'])
        act(() => tree.unmount())
    })

    it('never writes a comment into a thread that does not exist yet', async () => {
        const tree = render()
        press(tree)

        // Not reachable through the UI (the popover is not open), but the guard is what makes that
        // true — `createObjectMessage(projectId, undefined, …)` would write to a garbage path.
        await act(async () => {
            await tree.root.findByType(PendingAssistantCommentWrapper)
        })
        expect(mockCreateObjectMessage).not.toHaveBeenCalled()
        act(() => tree.unmount())
    })
})
