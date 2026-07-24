/**
 * @jest-environment jsdom
 */

import React from 'react'
import StatisticsView from '../../components/StatisticsView/StatisticsView'
import store from '../../redux/store'
import { storeLoggedUserProjects } from '../../redux/actions'

import renderer from 'react-test-renderer'

describe('StatisticsView', () => {
    const projects = [{ name: 'Build a Stairway To Heaven', id: '0' }]
    store.dispatch(storeLoggedUserProjects(projects))

    it('should render correctly', () => {
        const tree = renderer.create(<StatisticsView projectIndex={0} user={{ uid: 1 }} />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should unmount correctly', () => {
        const tree = renderer.create(<StatisticsView projectIndex={0} user={{ uid: 1 }} />)
        tree.unmount()
    })

    it('test function onStatisticsChange', () => {
        // given
        const tree = renderer.create(<StatisticsView projectIndex={0} user={{ uid: 1 }} />)
        const instance = tree.getInstance()
        const expectedValue = { openTasks: 0, doneTasks: 0, openPoints: 0, donePoints: 0 }
        // when
        instance.onStatisticsChange([{ id: 0, data: () => expectedValue }])
        // then
        expect(instance.state.statisticsData).toEqual(expectedValue)
    })
})