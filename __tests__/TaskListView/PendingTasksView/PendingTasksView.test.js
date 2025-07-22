/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import PendingTasksView from '../../../components/TaskListView/PendingTasksView/PendingTasksView'

describe('PendingTasksView component', () => {
    it('should render correctly', async () => {
        const tree = renderer
            .create(
                <PendingTasksView></PendingTasksView>
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })
})
