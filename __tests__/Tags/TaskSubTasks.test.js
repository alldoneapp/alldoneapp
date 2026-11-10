/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import TaskSubTasks from '../../components/Tags/TaskSubTasks'
import { setLanguage } from '../../i18n/TranslationService'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

describe('Task Sub Tasks tag component', () => {
    describe('Task Estimation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={0} style={{ marginLeft: 10 }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 1', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={1} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 2', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={2} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('localized subtask count label', () => {
        const renderLabel = amount => {
            const tree = renderer.create(
                <Provider store={store}>
                    <TaskSubTasks amountOfSubTasks={amount} />
                </Provider>
            )
            const texts = tree.root.findAll(node => typeof node.type === 'string' && node.props.dir === 'auto')
            return texts
                .map(node => node.props.children)
                .filter(child => typeof child === 'string' && /^\d/.test(child))
                .join('')
        }

        afterEach(() => {
            setLanguage('en')
        })

        it.each([
            ['de', 1, '1 Teilaufgabe'],
            ['de', 2, '2 Teilaufgaben'],
            ['de', 5, '5 Teilaufgaben'],
            ['en', 1, '1 Subtask'],
            ['en', 2, '2 Subtasks'],
            ['es', 1, '1 Subtarea'],
            ['es', 2, '2 Subtareas'],
        ])('%s: %i subtask(s) renders "%s"', (language, amount, expected) => {
            setLanguage(language)
            expect(renderLabel(amount)).toBe(expected)
        })
    })
})
