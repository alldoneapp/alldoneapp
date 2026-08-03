import React from 'react'
import { StyleSheet } from 'react-native'
import renderer from 'react-test-renderer'

import TaskInputArea from './TaskInputArea'
import { colors } from '../../styles/global'
import { taskPresentationLayout } from './TaskPresentation/TaskPresentationLayout'

jest.mock('./TaskInput', () => 'TaskInput')

const renderInlineInput = newTaskInFocus =>
    renderer.create(<TaskInputArea adding={true} newTaskInFocus={newTaskInFocus} />).root.findByType('View')

describe('TaskInputArea inline task styling', () => {
    test('matches the normal task row while initially deselected', () => {
        const style = StyleSheet.flatten(renderInlineInput(false).props.style)

        expect(style).toMatchObject({
            minHeight: 59,
            marginHorizontal: taskPresentationLayout.taskRow.marginHorizontal,
            backgroundColor: '#ffffff',
            borderRadius: taskPresentationLayout.taskRow.borderRadius,
        })
        expect(style.borderWidth).toBeUndefined()
        expect(style.borderColor).toBeUndefined()
    })

    test('uses the normal focused-task border only while selected', () => {
        const style = StyleSheet.flatten(renderInlineInput(true).props.style)

        expect(style.borderColor).toBe(colors.Primary100)
        expect(style.borderWidth).toBe(2)
    })

    test('does not apply inline task styling to an existing task editor', () => {
        const style = StyleSheet.flatten(
            renderer.create(<TaskInputArea adding={false} />).root.findByType('View').props.style
        )

        expect(style.marginHorizontal).toBeUndefined()
        expect(style.backgroundColor).toBeUndefined()
        expect(style.borderRadius).toBeUndefined()
    })
})
