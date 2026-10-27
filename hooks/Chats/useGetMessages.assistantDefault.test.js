/**
 * @jest-environment jsdom
 */

// AT-2886: opening a chat whose last message came from the assistant switches the assistant on
// (the global `assistantEnabled` flag). That default belongs to opening the chat. Loading earlier
// messages grows `toRender`, which re-subscribes the comments listener; re-applying the default
// there switched the assistant back on right after the user had turned it off.

import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockDispatch = jest.fn()
let mockNext
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user' } }),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../redux/actions', () => ({
    setAssistantEnabled: value => ({ type: 'assistantEnabled', value }),
    setNotEnabledAssistantWhenLoadComments: value => ({ type: 'notEnabledWhenLoad', value }),
    setShowNotificationAboutTheBotBehavior: value => ({ type: 'notice', value }),
}))
jest.mock('../../redux/store', () => ({
    getState: () => ({
        loggedUser: { uid: 'user', gold: 100, noticeAboutTheBotBehavior: true },
        notEnabledAssistantWhenLoadComments: false,
    }),
}))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => null }))
jest.mock('../../utils/redux/loadingOperation', () => ({
    subscribeWithLoading: (_name, subscribe, next) => subscribe(next, jest.fn()),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    watchComments: (_project, _type, _object, _key, _limit, next) => {
        mockNext = next
    },
}))
jest.mock('../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('./usePendingChatMessages', () => messages => [...messages])

const useGetMessages = require('./useGetMessages').default

const Harness = ({ objectId = 'task-1', toRender }) => {
    useGetMessages(true, false, 'project-1', objectId, 'tasks', toRender)
    return null
}
const assistantAnsweredLast = [
    { id: 'm1', creatorId: 'user', created: 1000 },
    { id: 'm2', creatorId: 'assistant-1', fromAssistant: true, created: 2000 },
]
const enableCalls = () =>
    mockDispatch.mock.calls.filter(([action]) => action?.type === 'assistantEnabled' && action.value === true)

describe('useGetMessages assistant default (AT-2886)', () => {
    let tree
    beforeEach(() => mockDispatch.mockClear())
    afterEach(() => act(() => tree?.unmount()))

    it('switches the assistant on when a chat opens with an assistant message last', () => {
        act(() => {
            tree = renderer.create(<Harness toRender={20} />)
        })
        act(() => mockNext(assistantAnsweredLast))
        expect(enableCalls()).toHaveLength(1)
    })

    it('does not switch it on again when earlier messages are loaded', () => {
        act(() => {
            tree = renderer.create(<Harness toRender={20} />)
        })
        act(() => mockNext(assistantAnsweredLast))
        // The user switches the assistant off here, then scrolls up.
        act(() => tree.update(<Harness toRender={40} />))
        act(() => mockNext(assistantAnsweredLast))
        expect(enableCalls()).toHaveLength(1)
    })

    it('applies the default again when a different chat is opened', () => {
        act(() => {
            tree = renderer.create(<Harness toRender={20} />)
        })
        act(() => mockNext(assistantAnsweredLast))
        act(() => tree.update(<Harness objectId="task-2" toRender={20} />))
        act(() => mockNext(assistantAnsweredLast))
        expect(enableCalls()).toHaveLength(2)
    })
})
