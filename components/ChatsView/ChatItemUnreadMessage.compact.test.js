/**
 * @jest-environment jsdom
 *
 * AT-2361: what the `compact` (phone-width) preview row does to the message body's indentation.
 *
 * The body is stubbed down to the one thing this is about - the container style it is handed -
 * because rendering it for real drags the whole thread text pipeline in, and that is covered by
 * ChatItemUnreadMessage.email.test.js.
 */

import React from 'react'
import { StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ChatItemUnreadMessage from './ChatItemUnreadMessage'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key, getDeviceLanguage: () => 'en' }))

jest.mock('../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    photoURL: null,
    displayName: 'Ada',
    isProjectUser: true,
    isUnknownUser: false,
    isAssistant: false,
}))

jest.mock('./Utils/ChatHelper', () => ({
    getTimestampInMilliseconds: value => value,
    parseLastEdited: () => 'now',
}))

jest.mock('./ChatDV/linkedEmailActions', () => ({ getLinkedEmailFromMessage: () => null }))
jest.mock('./ChatDV/EditorView/messageLoadingState', () => ({ resolveEffectiveMessageLoading: () => false }))
jest.mock('./ChatDV/EditorView/MessageItemHeader', () => () => null)

const mockBodyProps = []
jest.mock('./ChatDV/EditorView/MessageItemBody', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => {
        mockBodyProps.push(props)
        return <View />
    }
})

const message = { id: 'c1', commentText: 'Email from Apple', creatorId: 'user-1', lastChangeDate: 1 }

const renderRow = compact => {
    mockBodyProps.length = 0
    act(() => {
        renderer.create(
            <ChatItemUnreadMessage
                projectId="project-1"
                chat={{ id: 'chat-1', type: 'topics' }}
                objectType="topics"
                message={message}
                serverTime={2}
                compact={compact}
            />
        )
    })
    return StyleSheet.flatten(mockBodyProps[0].containerStyle)
}

describe('ChatItemUnreadMessage compact layout', () => {
    it('drops the avatar hanging indent on phone widths', () => {
        // The avatar + name + time line directly above the body is what keeps the sender legible;
        // the 36px only ever bought alignment with the avatar, and on a phone it costs a word or
        // two on every line of the subject and body.
        expect(renderRow(true).marginLeft).toBe(0)
    })

    it('keeps the thread alignment on desktop', () => {
        // 24px avatar + its 12px gutter: the same hanging indent the thread itself uses.
        expect(renderRow(false).marginLeft).toBe(36)
    })

    it('indents by default, so a caller that never heard of the compact mode is unchanged', () => {
        mockBodyProps.length = 0
        act(() => {
            renderer.create(
                <ChatItemUnreadMessage
                    projectId="project-1"
                    chat={{ id: 'chat-1', type: 'topics' }}
                    objectType="topics"
                    message={message}
                    serverTime={2}
                />
            )
        })

        expect(StyleSheet.flatten(mockBodyProps[0].containerStyle).marginLeft).toBe(36)
    })
})
