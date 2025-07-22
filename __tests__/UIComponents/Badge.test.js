/**
 * @jest-environment jsdom
 */

import React from 'react'
import Badge, { BADGE_GREY, BADGE_BLUE } from '../../components/UIComponents/Badge'

import renderer from 'react-test-renderer'

describe('Badge component', () => {
    describe('Badge snapshot test', () => {
        it('should render correctly passing text', () => {
            const tree = renderer.create(<Badge text={'2'} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly passing number', () => {
            const tree = renderer.create(<Badge text={5} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly for a grey badge', () => {
            const tree = renderer.create(<Badge text={'5'} theme={BADGE_GREY} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly for a blue badge', () => {
            const tree = renderer.create(<Badge text={'5'} theme={BADGE_BLUE} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
