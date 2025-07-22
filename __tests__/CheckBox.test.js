import React from 'react'
import CheckBox from '../components/CheckBox'

import renderer from 'react-test-renderer'

describe('CheckBox component', () => {
    describe('CheckBox snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CheckBox />)
            expect(tree).toMatchSnapshot()
        })
    })
    describe('CheckBox checked snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CheckBox checked={true} />)
            expect(tree).toMatchSnapshot()
        })
    })
    describe('CheckBox subtask snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CheckBox isSubtask={true} />)
            expect(tree).toMatchSnapshot()
        })
    })
    describe('CheckBox subtask checked snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CheckBox checked={true} isSubtask={true} />)
            expect(tree).toMatchSnapshot()
        })
    })
})
