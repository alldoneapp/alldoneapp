/**
 * @jest-environment jsdom
 */

import React from 'react'
import ActivityView from '../../../components/TaskDetailedView/Activity/ActivityView'

import renderer from 'react-test-renderer'

describe('ActivityView', () => {
    it('should render correctly', () => {
        const json = renderer.create(<ActivityView />).toJSON()
        expect(json).toMatchSnapshot()
    })
})