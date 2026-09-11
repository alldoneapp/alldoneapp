import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../Icon', () => 'Icon')
jest.mock('./ProjectPicker', () => 'ProjectPicker')

import Project from './Project'

describe('Project move pending state', () => {
    it('blocks a duplicate project move while forwarding the field progress state', () => {
        const handoff = { targetProject: { id: 'project-b', name: 'Product' } }
        const tree = renderer.create(
            <Project
                project={{ id: 'project-a', name: 'Inbox' }}
                item={{ type: 'task', data: { id: 'task-1' } }}
                taskProjectMoveHandoff={handoff}
                taskProjectMoveHandoffActive
                taskProjectMovePending
            />
        )
        const picker = tree.root.findByType('ProjectPicker')

        expect(picker.props.disabled).toBe(true)
        expect(picker.props.taskProjectMovePending).toBe(true)
        expect(picker.props.taskProjectMoveHandoff).toBe(handoff)
    })
})
