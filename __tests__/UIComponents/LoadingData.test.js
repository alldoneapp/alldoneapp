/**
 * @jest-environment jsdom
 */

import React from 'react'
import LoadingData from '../../components/UIComponents/LoadingData'

import renderer from 'react-test-renderer'

describe('LoadingData component', () => {
    describe('LoadingData snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<LoadingData />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<LoadingData />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('LoadingData check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<LoadingData />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
