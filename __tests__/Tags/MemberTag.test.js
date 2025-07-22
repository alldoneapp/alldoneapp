/**
 * @jest-environment jsdom
 */

import React from 'react'
import MemberTag from '../../components/Tags/MemberTag'

import renderer from 'react-test-renderer'

describe('Member tag component', () => {
    describe('Member snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<MemberTag />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<MemberTag />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Member tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<MemberTag />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
