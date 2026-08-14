/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../utils/WebShims/Localization', () => ({ locale: 'en' }))

import TaskPriorityTag from '../../components/Tags/TaskPriorityTag'

describe('TaskPriorityTag', () => {
    test('does not render when there is no priority', () => {
        expect(renderer.create(<TaskPriorityTag priority={'none'} />).toJSON()).toBeNull()
        expect(renderer.create(<TaskPriorityTag />).toJSON()).toBeNull()
    })

    test.each([
        ['must_do', 'Must do'],
        ['should_do', 'Should do'],
        ['could_do', 'Could do'],
    ])('renders the %s priority label', (priority, label) => {
        const tree = renderer.create(<TaskPriorityTag priority={priority} />)
        expect(tree.root.findAllByProps({ children: label }).length).toBeGreaterThan(0)
    })
})
