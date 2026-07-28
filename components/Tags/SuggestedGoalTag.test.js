/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import SuggestedGoalTag from './SuggestedGoalTag'

const mockRichGoalTitle =
    'Coordinate https://alldone.app/projects/project-1/goals/goal-2 with https://www.figma.com/file/design'
const mockLongReason =
    'The task concerns the configuration and presentation of the AI assistant and therefore belongs to this goal.'
const mockRichTitleAction = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreenNavigation: true }),
}))
jest.mock('uuid/v4', () => () => 'watcher-key')
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ content, children, isOpen, onClickOutside }) => (
        <View testID="suggested-goal-popover-shell" isOpen={isOpen} onClickOutside={onClickOutside}>
            {children}
            {isOpen ? content : null}
        </View>
    )
})
jest.mock('../Icon', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View />
})
jest.mock('../UIControls/Button', () => {
    const React = require('react')
    const { Text, View } = require('react-native')
    return props => (
        <View {...props}>
            <Text style={props.titleStyle}>{props.title}</Text>
        </View>
    )
})
jest.mock('../UIControls/SocialText/SocialText', () => {
    const React = require('react')
    const { Text, TouchableOpacity, View } = require('react-native')
    return props => (
        <View testID="rich-goal-title" socialTextProps={props}>
            <Text>{props.children}</Text>
            <TouchableOpacity testID="rich-goal-title-action" onPress={() => mockRichTitleAction(props.children)} />
        </View>
    )
})
jest.mock('../UIComponents/PopupDismissSurface', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => (
        <View testID="popup-dismiss-surface" onDismiss={props.onDismiss}>
            {props.children}
        </View>
    )
})
jest.mock('../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View />
})
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../functions/Utils/parseTextUtils', () => ({ shrinkTagText: value => value }))
jest.mock('../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../utils/backends/Goals/goalsFirestore', () => ({
    watchGoal: (projectId, goalId, watcherKey, callback) =>
        callback({ id: goalId, extendedName: mockRichGoalTitle, name: 'Plain fallback title' }),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    acceptTaskGoalSuggestion: jest.fn(),
    dismissTaskGoalSuggestion: jest.fn(),
    setTaskParentGoal: jest.fn(),
    setTaskProjectWithGoal: jest.fn(),
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(),
}))

describe('SuggestedGoalTag popup', () => {
    beforeEach(() => {
        jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 375, height: 812, scale: 1, fontScale: 1 })
        jest.spyOn(Dimensions, 'addEventListener').mockImplementation(() => undefined)
        jest.spyOn(Dimensions, 'removeEventListener').mockImplementation(() => undefined)
        mockRichTitleAction.mockClear()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    const renderPopup = () => {
        let tree
        act(() => {
            tree = renderer.create(
                <SuggestedGoalTag
                    projectId="project-1"
                    task={{
                        id: 'task-1',
                        userId: 'user-1',
                        goalSuggestion: { goalId: 'goal-1', reason: mockLongReason },
                    }}
                />
            )
        })
        act(() => tree.root.findByProps({ testID: 'suggested-goal-trigger' }).props.onPress())
        return tree
    }

    test('uses readable colors, bounded content, and a narrow-screen action layout', () => {
        const tree = renderPopup()

        const popover = tree.root.findByProps({ testID: 'suggested-goal-popover' })
        const popoverStyle = StyleSheet.flatten(popover.props.style)
        expect(popoverStyle).toEqual(
            expect.objectContaining({
                width: 343,
                padding: 16,
                backgroundColor: '#091540',
            })
        )

        const goalTitle = tree.root.findByProps({ testID: 'rich-goal-title' }).props.socialTextProps
        expect(goalTitle).toEqual(
            expect.objectContaining({
                children: mockRichGoalTitle,
                numberOfLines: 4,
                wrapText: true,
                projectId: 'project-1',
            })
        )
        expect(StyleSheet.flatten(goalTitle.style).color).toBe('#FFFFFF')
        expect(StyleSheet.flatten(goalTitle.normalStyle).color).toBe('#FFFFFF')

        const reason = tree.root.findAllByType(Text).find(node => node.props.children === mockLongReason)
        expect(reason.props.numberOfLines).toBe(5)
        expect(StyleSheet.flatten(reason.props.style).color).toBe('#B7BDC8')

        const chooseAnotherAction = tree.root.findAllByProps({ title: 'Choose another' })[0]
        expect(StyleSheet.flatten(chooseAnotherAction.props.buttonStyle).marginBottom).toBe(4)

        const primaryAction = tree.root.findByProps({ title: 'Add to goal' })
        expect(StyleSheet.flatten(primaryAction.props.buttonStyle).width).toBe('100%')
    })

    test('keeps rich title actions interactive inside the popup', () => {
        const tree = renderPopup()

        act(() => tree.root.findByProps({ testID: 'rich-goal-title-action' }).props.onPress())

        expect(mockRichTitleAction).toHaveBeenCalledWith(mockRichGoalTitle)
        expect(tree.root.findByProps({ testID: 'suggested-goal-popover-shell' }).props.isOpen).toBe(true)
    })

    test('closes through the protected dismiss surface', () => {
        const tree = renderPopup()

        act(() => tree.root.findByProps({ testID: 'popup-dismiss-surface' }).props.onDismiss())

        expect(tree.root.findByProps({ testID: 'suggested-goal-popover-shell' }).props.isOpen).toBe(false)
    })
})
