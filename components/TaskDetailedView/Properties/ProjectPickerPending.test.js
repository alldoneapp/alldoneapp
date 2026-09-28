import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: callback => callback({ smallScreenNavigation: false }),
}))
jest.mock('../../UIControls/Button', () => 'Button')
jest.mock('../../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModal', () => 'SelectProjectModal')

import ProjectPicker from './ProjectPicker'

describe('task project-field move progress', () => {
    it('shows and disables the project-field progress state while a move is pending', () => {
        const project = { name: 'Inbox', color: '#123456' }
        const tree = renderer.create(
            <ProjectPicker
                project={project}
                disabled
                taskProjectMovePending
                taskProjectMoveHandoff={{ targetProject: { name: 'Product' } }}
            />
        )
        const button = tree.root.findByType('Button')

        expect(button.props.processing).toBe(true)
        expect(button.props.processingTitle).toBeTruthy()
        expect(button.props.disabled).toBe(true)
        expect(button.props.accessibilityLabel).toContain('Product')
    })

    it('keeps the note project name visible with a spinner until the move finishes', () => {
        const project = { id: 'project-a', name: 'Inbox', color: '#123456' }
        const destination = { id: 'project-b', name: 'Product' }
        const tree = renderer.create(
            <ProjectPicker project={project} item={{ type: 'note', data: { id: 'note-1' } }} />
        )

        act(() => tree.root.findByType('Button').props.onPress())
        const picker = tree.root.findByType('AppPopover').props.content
        act(() => picker.props.onNoteProjectMoveStarted(destination))

        let button = tree.root.findByType('Button')
        expect(button.props.processing).toBe(true)
        expect(button.props.processingTitle).toBe('Inbox')
        expect(button.props.disabled).toBe(true)
        expect(button.props.accessibilityLabel).toContain('Product')

        act(() => picker.props.onNoteProjectMoveFinished())
        button = tree.root.findByType('Button')
        expect(button.props.processing).toBe(false)
        expect(button.props.disabled).toBeFalsy()
    })
})
