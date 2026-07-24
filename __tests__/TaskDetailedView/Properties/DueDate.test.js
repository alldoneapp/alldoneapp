/**
 * @jest-environment jsdom
 */

import React from 'react'
import DueDate from '../../../components/TaskDetailedView/Properties/DueDate'

import renderer from 'react-test-renderer'

describe('DueDate component', () => {
    describe('DueDate snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<DueDate projectId={'-Asd'} task={{ id: '-Sda', name: 'My task', dueDate: 1556028000 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
