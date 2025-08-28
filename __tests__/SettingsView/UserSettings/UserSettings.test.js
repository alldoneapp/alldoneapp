/**
 * @jest-environment jsdom
 */

import React from 'react'
import UserSettings from '../../../components/SettingsView/UserSettings/UserSettings'
import renderer from 'react-test-renderer'
jest.mock('../../../utils/backends/firestore')

describe('UserSettings component', () => {
    describe('UserSettings snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<UserSettings />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
