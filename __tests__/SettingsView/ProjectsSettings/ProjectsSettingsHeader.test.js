/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectsSettingsHeader from '../../../components/SettingsView/ProjectsSettings/ProjectsSettingsHeader'
import renderer from 'react-test-renderer'

describe('ProjectsSettingsHeader component', () => {
    describe('ProjectsSettingsHeader snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectsSettingsHeader amount={5} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
