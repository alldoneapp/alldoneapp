/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import Header, { GLOBAL_SEARCH_TAB_ORDER, getNextGlobalSearchTab } from './Header'
import HeaderTab from './HeaderTab'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../../Feeds/CommentsTextInput/textInputHelper'
import { GLOBAL_SEARCH_ARTIFACTS_TAB, GLOBAL_SEARCH_WIKI_TAB } from '../searchIndexes'

jest.mock('./HeaderTab', () => 'HeaderTab')

const renderHeader = props => {
    let component
    act(() => {
        component = renderer.create(<Header activeTab={MENTION_MODAL_TASKS_TAB} setActiveTab={jest.fn()} {...props} />)
    })
    return component
}

const labels = component => component.root.findAllByType(HeaderTab).map(tab => tab.props.text)

describe('global search tabs (AT-2905)', () => {
    test('show Artifacts before Chats, like the main navigation', () => {
        const component = renderHeader()
        expect(labels(component)).toEqual(['Tasks', 'Goals', 'Notes', 'Contacts', 'Artifacts', 'Chats', 'Wiki'])
        act(() => component.unmount())
    })

    test('every tab appears exactly once', () => {
        expect(new Set(GLOBAL_SEARCH_TAB_ORDER).size).toBe(7)
    })

    test('the Tab key walks the shown order and wraps around', () => {
        expect(getNextGlobalSearchTab(MENTION_MODAL_CONTACTS_TAB)).toBe(GLOBAL_SEARCH_ARTIFACTS_TAB)
        expect(getNextGlobalSearchTab(GLOBAL_SEARCH_ARTIFACTS_TAB)).toBe(MENTION_MODAL_TOPICS_TAB)
        expect(getNextGlobalSearchTab(MENTION_MODAL_TOPICS_TAB)).toBe(GLOBAL_SEARCH_WIKI_TAB)
        expect(getNextGlobalSearchTab(GLOBAL_SEARCH_WIKI_TAB)).toBe(MENTION_MODAL_TASKS_TAB)

        const setActiveTab = jest.fn()
        const component = renderHeader({ activeTab: MENTION_MODAL_CONTACTS_TAB, setActiveTab })
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
        })
        expect(setActiveTab).toHaveBeenCalledWith(GLOBAL_SEARCH_ARTIFACTS_TAB)
        act(() => component.unmount())
    })

    test('the shortcut hint and badges sit on the right tabs', () => {
        const component = renderHeader({
            activeTab: GLOBAL_SEARCH_ARTIFACTS_TAB,
            artifactsResultAmount: 3,
            chatsResultAmount: 5,
        })
        const byLabel = Object.fromEntries(
            component.root.findAllByType(HeaderTab).map(tab => [tab.props.text, tab.props])
        )
        expect(byLabel.Artifacts).toEqual(expect.objectContaining({ isActive: true, badgeValue: 3 }))
        expect(byLabel.Chats).toEqual(expect.objectContaining({ isNextShortcutTab: true, badgeValue: 5 }))
        expect(Object.values(byLabel).filter(tab => tab.isNextShortcutTab)).toHaveLength(1)

        act(() => byLabel.Wiki.onPress())
        act(() => component.unmount())
    })
})
