/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer from 'react-test-renderer'

import ProjectTagIndicator from './ProjectTagIndicator'

let mockState
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../Tags/ProjectTag', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => <Text testID="project-tag">{props.project.name}</Text>
})

const ProjectTag = require('../../../Tags/ProjectTag')

describe('ProjectTagIndicator (AT-2902)', () => {
    beforeEach(() => {
        mockState = {
            smallScreenNavigation: false,
            loggedUser: { uid: 'user-1' },
            loggedUserProjectsMap: { 'project-1': { id: 'project-1', name: 'Alldone Product' } },
        }
    })

    it('renders in flow at the start of the title line instead of in the card corner', () => {
        const tree = renderer.create(<ProjectTagIndicator projectId="project-1" />)
        const container = tree.root.findByProps({ testID: 'last-comment-project-tag' })
        const style = StyleSheet.flatten(container.props.style)

        expect(style.position).toBeUndefined()
        expect(style.right).toBeUndefined()
        expect(style.flexShrink).toBe(0)
        expect(style.marginRight).toBeGreaterThan(0)

        const tag = tree.root.findByType(ProjectTag)
        expect(tag.props.project.name).toBe('Alldone Product')
        expect(tag.props.shrinkTextToAmountOfLetter).toBe(8)
        expect(tag.props.path).toBe('/projects/project-1/user/user-1/chats/all')
    })

    it('keeps the mobile abbreviation', () => {
        mockState.smallScreenNavigation = true
        const tag = renderer.create(<ProjectTagIndicator projectId="project-1" />).root.findByType(ProjectTag)

        expect(tag.props.shrinkTextToAmountOfLetter).toBe(1)
        expect(tag.props.hideDots).toBe(true)
    })

    it('renders nothing for a project it cannot resolve, so the title line still renders', () => {
        expect(renderer.create(<ProjectTagIndicator projectId="unknown" />).toJSON()).toBeNull()
        expect(renderer.create(<ProjectTagIndicator projectId={null} />).root.findAllByType(View)).toHaveLength(0)
    })
})
