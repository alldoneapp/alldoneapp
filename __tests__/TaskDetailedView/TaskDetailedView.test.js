/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskDetailedView from '../../components/TaskDetailedView/TaskDetailedView'
import store from '../../redux/store'

import renderer from 'react-test-renderer'

describe('TaskDetailedView component', () => {
    const navigation = {
        getParam: (prop, fallback) => {
            switch (prop) {
                case 'task':
                    return { id: '0', name: 'asd', recurrence: { type: 'never' } }
                case 'projectId':
                    return '-Asd'
            }
        },
    }
    describe('TaskDetailedView snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskDetailedView projectId={'-Asd'} navigation={navigation} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('TaskDetailedView methods', () => {
        it('should set the assignee in the store', () => {
            const tree = renderer.create(<TaskDetailedView projectId={'-Asd'} navigation={navigation} />)
            const instance = tree.getInstance()
            const test = {
                name: 'John Horton Conway',
                desc: `Your game of life made me believe the universe is indeed a computable entity since I was 15 years old. Thank you`,
            }
            instance.afterAssigneeFetch(test)
            expect(store.getState().assignee).toEqual(test)
        })
    })
})
