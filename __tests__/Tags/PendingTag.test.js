/**
 * @jest-environment jsdom
 */

import React from 'react'
import PendingTag from '../../components/Tags/PendingTag'

import renderer from 'react-test-renderer'

describe('Pending tag component', () => {
    describe('Pending snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<PendingTag />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<PendingTag />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Pending tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<PendingTag />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
