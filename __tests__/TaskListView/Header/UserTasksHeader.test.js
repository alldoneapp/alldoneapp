import React from 'react'
import UserTasksHeader, { getFormattedName } from '../../../components/TaskListView/Header/UserTasksHeader'

import renderer from 'react-test-renderer'

describe('UserTasksHeader component', () => {
    describe('UserTasksHeader empty snapshot test', () => {
        it('should render correctly for basic header', () => {
            const tree = renderer.create(<UserTasksHeader headerText="Martina Muller" isName={true} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for header with caption', () => {
            const tree = renderer
                .create(<UserTasksHeader headerText="Done project task" headerCaption={'5 Open'} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('getFormattedName function test', () => {
        it('should correctly format a given name to display at the tasks view when the name does not end with s', () => {
            const name = getFormattedName('Martina')
            expect(name).toBe(`Martina's tasks`)
        })

        it('should correctly format a given name to display at the tasks view when the name ends with s', () => {
            const name = getFormattedName('Charles')
            expect(name).toBe(`Charles' tasks`)
        })
    })
})
