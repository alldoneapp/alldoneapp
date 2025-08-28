/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskItem from '../../components/TaskListView/TaskItem'
import Lock from '../../components/Lock'
import store from '../../redux/store'
import { Provider } from 'react-redux'
import { SubTaskList } from '../../__mocks__/MockData/SubTaskList'

import renderer from 'react-test-renderer'

const sampleTask = { id: 'dsa', name: 'Some random text', userIds: [], recurrence: { type: 'never' } }

describe('TaskItem component', () => {
    describe('TaskItem empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItem
                            task={{
                                id: '1',
                                name: 'Some random text',
                                subtaskIds: ['-Asd'],
                                recurrence: { type: 'never' },
                                userIds: [],
                            }}
                            tags={[]}
                            projectId={'1'}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly for a sub task', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItem
                            task={{ id: '1', name: 'Some random text', userIds: [], recurrence: { type: 'never' } }}
                            projectId={'1'}
                            isSubTask={true}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when showPhoto is true', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItem
                            task={{ id: '1', name: 'Some random text', userIds: [], recurrence: { type: 'never' } }}
                            tags={[]}
                            projectId={'1'}
                            showPhoto={true}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('TaskItem with text snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItem task={sampleTask} tags={[]} projectId={'1'} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('TaskItem with text and tag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItem task={sampleTask} tags={[<Lock isLocked />]} projectId={'1'} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function toggleCheckAction snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskItem task={sampleTask} tags={[<Lock isLocked />]} projectId={'1'} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().toggleCheckAction()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function onEditTaskSuccessAction snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <TaskItem
                    newItem={true}
                    task={sampleTask}
                    tags={[<Lock isLocked />]}
                    projectId={'1'}
                    onCreateTask={() => {}}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().onEditTaskSuccessAction()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function setTaskStatus snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <TaskItem
                    newItem={true}
                    task={{ id: '123', name: 'Some random text', userIds: [], recurrence: { type: 'never' } }}
                    tags={[<Lock isLocked />]}
                    projectId={'1'}
                    onCreateTask={() => {}}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().setTaskStatus({ id: '123', name: 'Some random text', done: false })
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function onCheckboxPress snapshot test', () => {
        // This test is failing because an error inside the Popover.
        xit('should execute correctly', () => {
            const tree = renderer.create(
                <TaskItem
                    task={{
                        id: 'dsa',
                        name: 'Some random text',
                        userIds: [],
                        done: false,
                        recurrence: { type: 'never' },
                    }}
                    tags={[<Lock isLocked />]}
                    projectId={'1'}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().onCheckboxPress()
            expect(tree.toJSON()).toMatchSnapshot()

            let state = tree.getInstance().state
            expect(state.done).toBeTruthy()
        })
    })

    describe('Function quickSetAsPublic snapshot test', () => {
        it('should execute correctly', () => {
            const tree = renderer.create(<TaskItem task={sampleTask} projectId={'1'} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().quickSetAsPublic()
            expect(tree.toJSON()).toMatchSnapshot()

            let state = tree.getInstance().state
            expect(state.isPrivate).toBeFalsy()
        })
    })

    describe('Function onLayoutChange snapshot test', () => {
        it('after call onLayoutChange should render correctly', () => {
            const tree = renderer.create(<TaskItem task={sampleTask} projectId={'1'} />)
            const instance = tree.getInstance()
            let layout = { nativeEvent: { layout: { width: 100 } } }
            instance.state.taskTagsWidth = 150
            instance.onLayoutChange(layout)

            // Waiting to resolve the promise
            setTimeout(() => {
                let state = instance.state
                expect(state.forceTagsMobile).toBeTruthy()
            }, 50)

            instance.state.taskTagsWidth = 90
            instance.onLayoutChange(layout)

            // Waiting to resolve the promise
            setTimeout(() => {
                let state = instance.state
                expect(state.forceTagsMobile).toBeFalsy()
            }, 50)
        })
    })
})
