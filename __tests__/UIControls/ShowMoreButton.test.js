/**
 * @jest-environment jsdom
 */

import React from 'react'
import ShowMoreButton from '../../components/UIControls/ShowMoreButton'

import renderer from 'react-test-renderer'

describe('Show More Button component', () => {
    describe('Task Estimation Button snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<ShowMoreButton expanded={false} amount={1} expand={() => {}} contract={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
