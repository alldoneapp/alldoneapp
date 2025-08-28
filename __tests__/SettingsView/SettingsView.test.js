/**
 * @jest-environment jsdom
 */

import React from 'react'
import SettingsView from '../../components/SettingsView/SettingsView'
import renderer from 'react-test-renderer'
jest.mock('../../utils/backends/firestore')

describe('SettingsView component', () => {
    describe('SettingsView snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SettingsView />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
