/**
 * @jest-environment jsdom
 */

import React from 'react'
import SubtasksView from '../../../components/TaskDetailedView/SubtasksView/SubtasksView'

import renderer from 'react-test-renderer'

describe('SubtasksView', () => {
    it('should render correctly', () => {
        const tree = renderer.create(<SubtasksView />).toJSON()
        expect(tree).toMatchSnapshot()
    })
})