/**
 * @jest-environment jsdom
 */

import React from 'react'
import SettingsHeader from '../../../components/SettingsView/Header/SettingsHeader'
import renderer from 'react-test-renderer'

describe('SettingsHeader component', () => {
    describe('SettingsHeader snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SettingsHeader />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
