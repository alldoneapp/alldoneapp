import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    activeModalInFeed: false,
    isMiddleScreen: false,
    smallScreenNavigation: false,
    dateFormat: 'DD.MM.YYYY',
}
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../Icon', () => () => null)
jest.mock('../FollowSwitchableTag/NewFeedDot', () => () => null)
jest.mock('../../AssistantProfile/AssistantProfileChangeModal', () => () => null)
jest.mock(
    '../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide' }),
    showFloatPopup: () => ({ type: 'show' }),
    navigateToSettings: payload => ({ type: 'settings', payload }),
}))
jest.mock('../../../i18n/TranslationService', () => {
    const en = require('../../../i18n/translations/en.json')
    return { translate: key => (en[key] !== undefined ? en[key] : key) }
})

import AssistantProfileObject from './AssistantProfileObject'

const allText = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .join('\n')

describe('AssistantProfileObject', () => {
    it('shows one line per new version, each opening what changed', async () => {
        const feeds = [
            { id: 'a', type: 'FEED_ASSISTANT_PROFILE_UPDATED', profileRevision: 4, lastChangeDate: Date.now() },
            {
                id: 'b',
                type: 'FEED_ASSISTANT_PROFILE_PAUSED',
                profileMonth: '2026-11',
                lastChangeDate: Date.now() - 1000,
            },
        ]
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantProfileObject feedObjectData={{ feeds }} feedActiveTab="ALL" />)
        })

        const text = allText(tree)
        expect(text).toContain('Assistant profile')
        expect(text).toContain('Your assistant profile was updated')
        expect(text).toContain('Assistant profile paused: the monthly Gold limit is reached')

        await act(async () => tree.root.findByProps({ testID: 'assistant-profile-feed-show-4' }).props.onPress())
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'show' })
    })

    it('renders nothing without lines, and ignores a line without a valid revision', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantProfileObject feedObjectData={{ feeds: [] }} feedActiveTab="ALL" />)
        })
        expect(tree.toJSON()).toBeNull()

        await act(async () => {
            tree.update(
                <AssistantProfileObject
                    feedObjectData={{
                        feeds: [{ id: 'x', type: 'FEED_ASSISTANT_PROFILE_UPDATED', profileRevision: 'bad' }],
                    }}
                    feedActiveTab="ALL"
                />
            )
        })
        expect(allText(tree)).not.toContain('Your assistant profile was updated')
    })
})
