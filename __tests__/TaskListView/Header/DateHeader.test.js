import React from 'react'
import DateHeader from '../../../components/TaskListView/Header/DateHeader'

import renderer from 'react-test-renderer'

describe('DateHeader component', () => {
    //Uncomment the the following lines if you need to add more tests in the describe
    //block. React Native Animated needs its internal timers mocked. See: https://github.com/facebook/jest/issues/6434
    //beforeEach(() => {
    jest.useFakeTimers()
    //});

    describe('DateHeader with text snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<DateHeader dateText="TODAY" date={Date.now()} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function animateProgress snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DateHeader dateText="TODAY" date={Date.now()}/>)

            tree.getInstance().animateProgress(100)
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
