import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import FocusAreaGoals from './FocusAreaGoals'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

describe('focus area sections', () => {
    let catalog
    let tree
    const renderGoals = goals => goals.map(goal => <Text key={goal.id}>{goal.id}</Text>)
    const goals = [{ id: 'launch', focusAreaId: 'marketing' }, { id: 'general' }]

    beforeEach(() => {
        catalog = { marketing: { name: 'Marketing' } }
        useSelector.mockImplementation(selector => selector({ loggedUserProjectsMap: { p: { focusAreas: catalog } } }))
    })
    afterEach(() => act(() => tree?.unmount()))

    test('keeps legacy milestones flat even when the project has unused areas', () => {
        act(() => {
            tree = renderer.create(
                <FocusAreaGoals projectId="p" goals={[{ id: 'legacy' }]}>
                    {renderGoals}
                </FocusAreaGoals>
            )
        })
        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0)
        expect(tree.root.findByType(Text).props.children).toBe('legacy')
    })

    test('collapses only its own group and expands groups during manual ordering', () => {
        act(() => {
            tree = renderer.create(
                <FocusAreaGoals projectId="p" goals={goals}>
                    {renderGoals}
                </FocusAreaGoals>
            )
        })
        act(() => tree.root.findAllByType(TouchableOpacity)[0].props.onPress())
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).not.toContain('launch')
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('general')
        act(() =>
            tree.update(
                <FocusAreaGoals projectId="p" goals={goals} activeDragGoalMode>
                    {renderGoals}
                </FocusAreaGoals>
            )
        )
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('launch')
    })

    test('reflects a project rename without changing the goals', () => {
        act(() => {
            tree = renderer.create(
                <FocusAreaGoals projectId="p" goals={goals}>
                    {renderGoals}
                </FocusAreaGoals>
            )
        })
        catalog = { marketing: { name: 'Growth' } }
        act(() =>
            tree.update(
                <FocusAreaGoals projectId="p" goals={goals}>
                    {renderGoals}
                </FocusAreaGoals>
            )
        )
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('Growth')
        expect(goals[0].focusAreaId).toBe('marketing')
    })
})
