/**
 * @jest-environment jsdom
 */

import React from 'react'
import Spinner from '../../components/UIComponents/Spinner'

import renderer from 'react-test-renderer'

describe('Spinner component', () => {
    describe('Spinner snapshot test', () => {
        it('should render correctly as default', () => {
            const tree = renderer.create(<Spinner />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly passing custom sizes', () => {
            const tree = renderer.create(<Spinner containerSize={100} spinnerSize={70} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly passing custom colors', () => {
            const tree = renderer.create(<Spinner containerColor={'red'} spinnerColor={'blue'} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
