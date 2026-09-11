import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockMoveObjectToProject = jest.fn()
const mockDismissAllPopups = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: callback =>
        callback({
            loggedUser: { uid: 'user-1', projectIds: ['project-a', 'project-b'] },
            loggedUserProjects: [
                { id: 'project-a', index: 0, name: 'Inbox' },
                { id: 'project-b', index: 1, name: 'Product' },
            ],
        }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    dismissAllPopups: (...args) => mockDismissAllPopups(...args),
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectsByType: projects => projects,
    getTypeOfProject: () => 'active',
    sortProjects: projects => projects,
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_ARCHIVED: 'archived',
}))
jest.mock('../ProjectListModal/ProjectListModal', () => 'ProjectListModal')
jest.mock(
    './useMoveObjectToProject',
    () =>
        () =>
        (...args) =>
            mockMoveObjectToProject(...args)
)

import SelectProjectModal from './SelectProjectModal'

describe('task detail project handoff start', () => {
    it('starts the DV pending state before dispatching the background move', async () => {
        mockMoveObjectToProject.mockResolvedValue(undefined)
        const onTaskProjectMoveStarted = jest.fn()
        const onTaskProjectMoveEnqueued = jest.fn()
        const onTaskProjectMoveEnqueueFailed = jest.fn()
        const project = { id: 'project-a', index: 0, name: 'Inbox' }
        const destination = { id: 'project-b', index: 1, name: 'Product' }
        const tree = renderer.create(
            <SelectProjectModal
                item={{ type: 'task', data: { id: 'task-1' } }}
                project={project}
                closePopover={jest.fn()}
                onTaskProjectMoveStarted={onTaskProjectMoveStarted}
                onTaskProjectMoveEnqueued={onTaskProjectMoveEnqueued}
                onTaskProjectMoveEnqueueFailed={onTaskProjectMoveEnqueueFailed}
            />
        )

        await act(async () => {
            await tree.root.findByType('ProjectListModal').props.onSelectProject(destination)
        })

        expect(onTaskProjectMoveStarted).toHaveBeenCalledWith(destination)
        expect(mockMoveObjectToProject).toHaveBeenCalledWith(
            { type: 'task', data: { id: 'task-1' } },
            project,
            destination,
            { onTaskProjectMoveEnqueued, onTaskProjectMoveEnqueueFailed }
        )
        expect(onTaskProjectMoveStarted.mock.invocationCallOrder[0]).toBeLessThan(
            mockMoveObjectToProject.mock.invocationCallOrder[0]
        )
        expect(mockDismissAllPopups).toHaveBeenCalled()
    })
})
