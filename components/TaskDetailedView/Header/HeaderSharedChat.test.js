import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Header from './Header'
import SharedHelper from '../../../utils/SharedHelper'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: jest.fn() }))
jest.mock('../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'workstream-' }))
jest.mock('./TaskTitle', () => ({ __esModule: true, default: () => null, TITLE_TASK: 'task' }))
jest.mock('./Indicator', () => () => null)
jest.mock('./TagList', () => () => null)
jest.mock('./BackButton', () => () => null)
jest.mock('../../UIControls/DVHamburgButton', () => () => null)
jest.mock('../../../assets/svg/SVGGenericUser', () => () => null)
jest.mock('../../Icon', () => () => null)
jest.mock('../../ChatsView/ChatDV/BotLine/BotLine', () => 'BotLine')

const task = { id: 'task-1', name: 'Shared task' }

const renderHeader = (isFullscreen, accessGranted) => {
    useSelector.mockImplementation(selector =>
        selector({
            loggedUser: { isAnonymous: !accessGranted },
            assignee: {},
            isMiddleScreen: false,
            smallScreenNavigation: false,
            taskTitleInEditMode: false,
            selectedNavItem: DV_TAB_TASK_CHAT,
        })
    )
    SharedHelper.accessGranted.mockReturnValue(accessGranted)

    return renderer.create(
        <Header projectId="project-1" task={task} isFullscreen={isFullscreen} setFullscreen={jest.fn()} />
    )
}

describe('task header on a shared chat link', () => {
    it('releases the reserved assistant-bar height after scrolling into fullscreen', () => {
        const tree = renderHeader(true, false)
        const headerStyle = StyleSheet.flatten(tree.root.findByType(View).props.style)

        expect(headerStyle.minHeight).toBe(0)
        expect(tree.root.findAllByType('BotLine')).toHaveLength(0)
    })

    it('keeps the assistant bar and its space for project members', () => {
        const tree = renderHeader(true, true)
        const headerStyle = StyleSheet.flatten(tree.root.findByType(View).props.style)

        expect(headerStyle.minHeight).toBe(140)
        expect(tree.root.findAllByType('BotLine')).toHaveLength(1)
    })

    it('keeps the normal header layout before a shared viewer scrolls', () => {
        const tree = renderHeader(false, false)
        const headerStyle = StyleSheet.flatten(tree.root.findByType(View).props.style)

        expect(headerStyle.minHeight).toBe(140)
    })
})
