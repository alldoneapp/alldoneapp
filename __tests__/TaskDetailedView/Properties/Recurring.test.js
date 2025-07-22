/**
 * @jest-environment jsdom
 */

import React from 'react'
import Recurring from '../../../components/TaskDetailedView/Properties/Recurring'
import renderer from 'react-test-renderer'

const task = { id: '-Sda', name: 'My task', recurrence: { type: 'never' } }

describe('Recurring component', () => {
    describe('Recurring snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Recurring projectId={'-Asd'} task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
