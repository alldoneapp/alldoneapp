import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectMoveIndicator from './ProjectMoveIndicator'
import { beginLocalContactMove } from '../../utils/projectMoveState'

jest.mock('./Spinner', () => 'Spinner')

describe('ProjectMoveIndicator contact rendering', () => {
    it('shows one indicator in the list and detail view before Firestore marks the move', () => {
        const contact = { uid: 'contact-1' }
        let list
        let detail
        act(() => {
            list = renderer.create(<ProjectMoveIndicator object={contact} projectId="source" />)
            detail = renderer.create(<ProjectMoveIndicator object={contact} projectId="source" showLabel />)
        })
        expect(list.toJSON()).toBeNull()
        expect(detail.toJSON()).toBeNull()

        let finish
        act(() => {
            finish = beginLocalContactMove('source', contact.uid)
        })
        expect(list.root.findByProps({ testID: 'project-move-spinner-contact-1' })).toBeDefined()
        expect(detail.root.findByProps({ testID: 'project-move-spinner-contact-1' })).toBeDefined()
        expect(JSON.stringify(detail.toJSON())).toContain('Moving contact...')

        act(() => finish())
        expect(list.toJSON()).toBeNull()
        expect(detail.toJSON()).toBeNull()
        act(() => {
            list.unmount()
            detail.unmount()
        })
    })

    it('shows server progress after a remount and hides a failed move', () => {
        let view
        act(() => {
            view = renderer.create(
                <ProjectMoveIndicator object={{ uid: 'contact-2', projectMove: { status: 'moving' } }} />
            )
        })
        expect(view.root.findByProps({ testID: 'project-move-spinner-contact-2' })).toBeDefined()
        act(() => {
            view.update(<ProjectMoveIndicator object={{ uid: 'contact-2', projectMove: { status: 'failed' } }} />)
        })
        expect(view.toJSON()).toBeNull()
        act(() => view.unmount())
    })
})
