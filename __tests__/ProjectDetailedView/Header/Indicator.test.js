/**
 * @jest-environment jsdom
 */

import React from 'react'
import Indicator from '../../../components/ProjectDetailedView/Header/Indicator'
import renderer from 'react-test-renderer'

describe('Detailed Project Indicator component', () => {
    describe('Detailed Project Indicator snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Indicator />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
