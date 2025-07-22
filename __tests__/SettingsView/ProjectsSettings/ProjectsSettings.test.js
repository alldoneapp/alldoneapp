/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectsSettings from '../../../components/SettingsView/ProjectsSettings/ProjectsSettings'
import renderer from 'react-test-renderer'

describe('ProjectsSettings component', () => {
    describe('ProjectsSettings snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectsSettings />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
