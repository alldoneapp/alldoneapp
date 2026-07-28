/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Dimensions, StyleSheet, Text, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import SuggestedGoalTag from './SuggestedGoalTag'

const mockLongGoalName =
    'Allow configuring AI assistants at https://www.figma.com/file/a-very-long-goal-reference-that-must-not-expand-the-popup'
const mockLongReason =
    'The task concerns the configuration and presentation of the AI assistant and therefore belongs to this goal.'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreenNavigation: true }),
}))
jest.mock('uuid/v4', () => () => 'watcher-key')
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ content, children }) => (
        <View>
            {children}
            {content}
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
jest.mock('../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View />
})
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../functions/Utils/parseTextUtils', () => ({ shrinkTagText: value => value }))
jest.mock('../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../utils/backends/Goals/goalsFirestore', () => ({
    watchGoal: (projectId, goalId, watcherKey, callback) => callback({ id: goalId, name: mockLongGoalName }),
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
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('uses readable colors, bounded content, and a narrow-screen action layout', () => {
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

        const popover = tree.root.findByProps({ testID: 'suggested-goal-popover' })
        const popoverStyle = StyleSheet.flatten(popover.props.style)
        expect(popoverStyle).toEqual(
            expect.objectContaining({
                width: 343,
                padding: 16,
                backgroundColor: '#091540',
            })
        )

        const goalName = tree.root.findAllByType(Text).find(node => node.props.children === mockLongGoalName)
        expect(goalName.props.numberOfLines).toBe(4)
        expect(StyleSheet.flatten(goalName.props.style).color).toBe('#FFFFFF')

        const reason = tree.root.findAllByType(Text).find(node => node.props.children === mockLongReason)
        expect(reason.props.numberOfLines).toBe(5)
        expect(StyleSheet.flatten(reason.props.style).color).toBe('#B7BDC8')

        const chooseAnotherAction = tree.root.findAllByProps({ title: 'Choose another' })[0]
        expect(StyleSheet.flatten(chooseAnotherAction.props.buttonStyle).marginBottom).toBe(4)

        const primaryAction = tree.root.findByProps({ title: 'Add to goal' })
        expect(StyleSheet.flatten(primaryAction.props.buttonStyle).width).toBe('100%')
    })
})
