import React from 'react'
import renderer from 'react-test-renderer'

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
})
