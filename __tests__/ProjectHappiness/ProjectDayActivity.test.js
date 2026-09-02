/**
 * The "Tasks done" row shared by the new-day popup and the rating popup.
 */

import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import ProjectDayActivity, { getProjectActivityWidth } from '../../components/ProjectHappiness/ProjectDayActivity'

const render = props => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<ProjectDayActivity {...props} />)
    })
    return tree
}

const textOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(text => (Array.isArray(text.props.children) ? text.props.children.join('') : String(text.props.children)))
        .join(' ')

describe('ProjectDayActivity', () => {
    it('shows the count when it is known', () => {
        expect(textOf(render({ doneTasks: 3, maxDoneTasks: 5 }))).toContain('Tasks done: 3')
    })

    it('shows a dash, never a zero, while the count is unknown', () => {
        expect(textOf(render({ doneTasks: undefined, maxDoneTasks: 0 }))).toContain('Tasks done: –')
    })

    it('sizes the activity bar relative to the busiest project', () => {
        expect(getProjectActivityWidth(5, 10)).toBe('50%')
        expect(getProjectActivityWidth(1, 100)).toBe('8%')
        expect(getProjectActivityWidth(0, 10)).toBe(0)
        expect(getProjectActivityWidth(undefined, 10)).toBe(0)
        expect(getProjectActivityWidth(3, 0)).toBe(0)
    })
})
