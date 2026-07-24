/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import TaskItemTags from '../../components/TaskListView/TaskItemTags'
import { Text } from 'react-native'

describe('TaskItemTags component', () => {
    describe('TaskItemTags snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer
                .create(
                    <TaskItemTags amountTags={5}>
                        <Text>Some text</Text>
                    </TaskItemTags>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('TaskItemTags functions snapshot test', () => {
        it('check updateState function', () => {
            const tree = renderer.create(
                <TaskItemTags amountTags={0}>
                    <Text>Some text</Text>
                </TaskItemTags>
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('check toggleVisibleTags function', () => {
            const tree = renderer.create(
                <TaskItemTags amountTags={1}>
                    <Text>Some text</Text>
                </TaskItemTags>
            )
            expect(tree.toJSON()).toMatchSnapshot()
            tree.getInstance().state.visible = false

            tree.getInstance().toggleVisibleTags()
            let state = tree.getInstance().state
            expect(state.visible).toBeTruthy()
        })

        it('check the unmount action', () => {
            const tree = renderer.create(
                <TaskItemTags amountTags={3}>
                    <Text>Some text</Text>
                </TaskItemTags>
            )
            tree.unmount()
        })
    })
})
