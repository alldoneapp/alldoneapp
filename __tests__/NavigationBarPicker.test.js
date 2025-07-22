import React from 'react'
import NavigationBarPicker from '../components/NavigationBar/NavigationBarPicker'

import renderer from 'react-test-renderer'

describe('NavigationBarPicker component', () => {
    describe('NavigationBarPicker snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<NavigationBarPicker />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBarPicker snapshot test', () => {
        it('should render correctly when is expanded', () => {
            const tree = renderer.create(<NavigationBarPicker expanded={true} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
