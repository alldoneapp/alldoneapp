import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../Icon', () => () => null)

import CommentPopupFooter from './CommentPopupFooter'

function mount(props) {
    let component
    act(() => {
        component = renderer.create(<CommentPopupFooter {...props} />)
    })
    return component
}

const links = component =>
    component.root.findAllByType(TouchableOpacity).map(link => ({
        label: link.findByType(Text).props.children,
        press: () => act(() => link.props.onPress()),
    }))

describe('CommentPopupFooter', () => {
    it('only offers "open chat" in an ordinary comment popup', () => {
        expect(links(mount({ onOpenChat: jest.fn() })).map(link => link.label)).toEqual(['open chat'])
    })

    it('adds "All chats" next to it when the popup can lead to the Chats list (AT-3020)', () => {
        const onOpenChat = jest.fn()
        const onOpenAllChats = jest.fn()
        const [openChat, allChats] = links(mount({ onOpenChat, onOpenAllChats }))

        expect([openChat.label, allChats.label]).toEqual(['open chat', 'All chats'])

        allChats.press()
        expect(onOpenAllChats).toHaveBeenCalledTimes(1)
        expect(onOpenChat).not.toHaveBeenCalled()

        openChat.press()
        expect(onOpenChat).toHaveBeenCalledTimes(1)
    })
})
