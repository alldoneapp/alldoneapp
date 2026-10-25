/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TaskCommentsWrapper from './TaskCommentsWrapper'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { awaitWriteAck } from '../../utils/backends/offlineWriteAck'

let mockConnectionHealth = 'reconnecting'
let mockHealthListeners
const mockPopupLock = { acquire: jest.fn(), release: jest.fn() }

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            openModals: {},
            assistantEnabled: false,
            isQuillTagEditorOpen: false,
        }),
}))
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ connectionState: '', connectionHealth: mockConnectionHealth }),
    },
}))
jest.mock('../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) => (
        <React.Fragment>
            {children}
            {isOpen ? content : null}
        </React.Fragment>
    )
})
jest.mock('./TaskCommentsTag', () => 'TaskCommentsTag')
jest.mock('../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => 'RichCommentModal')
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 'STAYWARD_COMMENT' }))
jest.mock('../../utils/HelperFunctions', () => ({
    popoverToTop: jest.fn(),
    popoverToTopContainerStyle: {},
}))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
jest.mock('../ModalsManager/modalsManager', () => ({
    BOT_OPTION_MODAL_ID: 'bot-option',
    BOT_WARNING_MODAL_ID: 'bot-warning',
    MENTION_MODAL_ID: 'mention',
    RUN_OUT_OF_GOLD_MODAL_ID: 'run-out-of-gold',
}))
jest.mock('../../hooks/useFloatPopupLock', () => ({
    __esModule: true,
    default: () => mockPopupLock,
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../../utils/connectionHealth', () => ({
    markServerContact: jest.fn(),
    startConnectionLatencySample: jest.fn(() => jest.fn()),
    subscribeConnectionHealth: jest.fn(listener => {
        mockHealthListeners.add(listener)
        return () => mockHealthListeners.delete(listener)
    }),
}))

describe('TaskCommentsWrapper submission during Firestore recovery', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        mockConnectionHealth = 'reconnecting'
        mockHealthListeners = new Set()
        Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
        createObjectMessage.mockImplementation(() =>
            awaitWriteAck(new Promise(() => {}), 'createObjectMessage comment')
        )
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('keeps the queued comment and completes the popup flow when recovery becomes stale', async () => {
        let tree
        act(() => {
            tree = renderer.create(
                <TaskCommentsWrapper
                    commentsData={{ amount: 1 }}
                    projectId="project-1"
                    objectId="task-1"
                    objectType="tasks"
                    objectName="Test"
                    object={{ id: 'task-1', name: 'Test' }}
                />
            )
        })
        act(() => tree.root.findByType('TaskCommentsTag').props.onOpen())

        expect(tree.root.findByType('RichCommentModal').props.initialObject).toEqual({
            id: 'task-1',
            name: 'Test',
        })

        let submission
        act(() => {
            submission = tree.root
                .findByType('RichCommentModal')
                .props.processDone('Comment while reconnecting', [], false, false, false)
        })
        await act(async () => {
            await Promise.resolve()
        })

        expect(createObjectMessage).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'Comment while reconnecting',
            'tasks',
            'STAYWARD_COMMENT',
            null,
            null,
            false,
            false
        )
        expect(tree.root.findByType('RichCommentModal')).toBeTruthy()

        await act(async () => {
            mockConnectionHealth = 'stale'
            mockHealthListeners.forEach(listener => listener('stale'))
            await submission
            jest.runOnlyPendingTimers()
        })

        expect(tree.root.findAllByType('RichCommentModal')).toHaveLength(0)
        expect(mockPopupLock.release).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
    })
})
