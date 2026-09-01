import React from 'react'
import renderer from 'react-test-renderer'

import ProjectRowStatusIcon from './ProjectRowStatusIcon'

jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../Spinner', () => 'Spinner')

const render = props => renderer.create(<ProjectRowStatusIcon {...props} />).root

describe('ProjectRowStatusIcon', () => {
    it('renders nothing for an ordinary row', () => {
        const root = render({})

        expect(root.findAllByType('Icon')).toHaveLength(0)
        expect(root.findAllByType('Spinner')).toHaveLength(0)
    })

    it('checks the row that is currently selected', () => {
        const root = render({ checked: true })

        expect(root.findByType('Icon').props.name).toBe('check')
        expect(root.findAllByType('Spinner')).toHaveLength(0)
    })

    it('spins instead of checking while the row is being committed', () => {
        // A row on its way to being selected has not got there yet, so the
        // spinner takes the check's place rather than sitting beside it.
        const root = render({ busy: true, checked: true })

        expect(root.findAllByType('Icon')).toHaveLength(0)
        expect(root.findAllByType('Spinner')).toHaveLength(1)
    })

    it('spins on a row that was not the selected one', () => {
        const root = render({ busy: true })

        expect(root.findAllByType('Spinner')).toHaveLength(1)
    })
})
