/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectMembersTag from '../../components/Tags/ProjectMembersTag'

import renderer from 'react-test-renderer'

describe('Project members tag component', () => {
    describe('Project members snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectMembersTag amount={0} style={{ marginLeft: 10 }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 1', () => {
            const tree = renderer.create(<ProjectMembersTag amount={1} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 2', () => {
            const tree = renderer.create(<ProjectMembersTag amount={2} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<ProjectMembersTag amount={1} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Project members tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<ProjectMembersTag amount={2} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
