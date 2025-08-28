/**
 * @jest-environment jsdom
 */

import React from 'react'
import EditTask from '../../components/UIComponents/EditTask'
import store from '../../redux/store'
import { setOnline, storeAllProjectsTasks, storeLoggedUserProjects } from '../../redux/actions'
import renderer from 'react-test-renderer'

jest.mock('react-native-web-webview')

describe('EditTask component', () => {
    describe('EditTask empty snapshot test', () => {
        const task = {
            id: 'asd',
            name: 'My task',
            completed: null,
            userId: undefined,
        }
        xit('Should render correctly', () => {
            const tree = renderer.create(<EditTask projectId={'-asd'} task={task} onCancelAction={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        xit('Should match default state correctly', () => {
            const tree = renderer.create(<EditTask projectId={'-asd'} task={task} onCancelAction={() => {}} />)
            const state = tree.getInstance().state

            expect(state.task).toEqual(task)
            expect(state.tmpTask).toEqual(task)
            expect(state.subTaskList).toEqual([])
        })
    })

    describe('EditTask with subtask button snapshot test', () => {
        xit('Should render correctly', () => {
            const tree = renderer
                .create(
                    <EditTask
                        projectId={'-asd'}
                        task={{ name: 'My task' }}
                        subtaskButton={true}
                        onCancelAction={() => {}}
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('EditTask with formType prop', () => {
        const task = { name: 'My task' }
        xit('FormType "NEW" should render correctly', () => {
            const tree = renderer
                .create(<EditTask projectId={'-asd'} task={task} formType={'new'} onCancelAction={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        xit('FormType "EDIT" should render correctly', () => {
            const tree = renderer
                .create(<EditTask projectId={'-asd'} task={task} formType={'edit'} onCancelAction={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateTaskField snapshot test', () => {
        xit('Should render correctly after function execution', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    subtaskButton={true}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', 'My new task')
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function updateTask snapshot test', () => {
        xit('Should render correctly after function execution for new task', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    subtaskButton={true}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', 'My new task')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('Should render correctly after function execution for new subtask', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    isSubTask={true}
                    parentTask={{ id: '-Asd', name: 'My task' }}
                    task={{ name: 'My task' }}
                    formType={'new'}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', 'My new task')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('Should render correctly after function execution for edit task', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    formType={'edit'}
                    subtaskButton={true}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', 'My new task')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('Should render correctly after dismiss editing in updateTask function', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    formType={'edit'}
                    subtaskButton={true}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', '')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('Should render correctly after dismiss editing in updateTask function when is online', () => {
            store.dispatch({
                type: 'Set online',
                status: true,
            })
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    formType={'edit'}
                    subtaskButton={true}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', '')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('Should render correctly after dismiss editing in updateTask function when is offline', () => {
            store.dispatch(setOnline(false))
            store.dispatch(storeLoggedUserProjects([{ id: '-asd' }]))
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    formType={'edit'}
                    subtaskButton={true}
                    onSuccessAction={() => {}}
                    onCancelAction={() => {}}
                />
            )

            tree.getInstance().updateTaskField('name', '')
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateTask()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function onSuccessUploadNewTask snapshot test', () => {
        xit('Should execute correctly', () => {
            const tree = renderer.create(
                <EditTask projectId={'-asd'} task={{ name: 'My task' }} onCancelAction={() => {}} />
            )

            tree.getInstance().onSuccessUploadNewTask()
        })
    })

    describe('unmount the component test', () => {
        xit('Should execute correctly', () => {
            const tree = renderer.create(
                <EditTask
                    projectId={'-asd'}
                    task={{ name: 'My task' }}
                    onCancelAction={() => {}}
                    onSuccessAction={() => {}}
                />
            )

            tree.unmount()
        })
    })

    xdescribe('Function getPlaceholderText', () => {
        const tree = renderer.create(
            <EditTask
                projectId={'-asd'}
                task={{ name: 'My task' }}
                onCancelAction={() => {}}
                onSuccessAction={() => {}}
            />
        )

        it('should return "Type to add new subtask"', () => {
            expect(tree.getInstance().getPlaceholderText('new', true)).toEqual('Type to add new subtask')
        })

        it('should return "Type to add new task"', () => {
            expect(tree.getInstance().getPlaceholderText('new', false)).toEqual('Type to add new task')
        })

        it('should return "Write the name of the subtask"', () => {
            expect(tree.getInstance().getPlaceholderText('edit', true)).toEqual('Write the name of the subtask')
        })

        it('should return "Write the name of the task"', () => {
            expect(tree.getInstance().getPlaceholderText('edit', false)).toEqual('Write the name of the task')
        })
    })

    xdescribe('OnPress functions snapshot test', () => {
        const tree = renderer.create(
            <EditTask
                projectId={'-asd'}
                task={{ name: 'My task', hasStar: false }}
                subtaskButton={true}
                onCancelAction={() => {}}
                toggleSubTaskList={() => {}}
            />
        )

        it('Function onChangeInputText should execute correctly', () => {
            tree.getInstance().onChangeInputText('new text here')
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('Function onPressPrivateButton should execute correctly', () => {
            store.dispatch(storeAllProjectsTasks([[]]))
            tree.getInstance().onPressPrivateButton()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('Function onPressHighlightButton should execute correctly', () => {
            tree.getInstance().onPressHighlightButton()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('Function onPressSubTaskIndicator should execute correctly', () => {
            tree.getInstance().onPressSubTaskIndicator()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
