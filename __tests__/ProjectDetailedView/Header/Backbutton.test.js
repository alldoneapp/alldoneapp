/**
 * @jest-environment jsdom
 */

import React from 'react'
import BackButton from '../../../components/ProjectDetailedView/Header/BackButton'
import renderer from 'react-test-renderer'

describe('Detailed Project Back Button component', () => {
    describe('Detailed Project Back Button snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<BackButton />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
