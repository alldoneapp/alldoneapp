import React from 'react'
import TaskVisibility from '../../components/Tags/TaskVisibility'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Task Visibility Tag component', () => {
    describe('Task Visibility snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskVisibility />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskVisibility isPrivate={false} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task Sub Tasks tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<TaskVisibility style={{ marginLeft: 4 }} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
