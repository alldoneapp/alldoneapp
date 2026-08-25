'use strict'

const { createTaskObject } = require('./TaskModelBuilder')

describe('TaskModelBuilder project routing', () => {
    const requiredParams = {
        name: 'Shared URL',
        userId: 'user-1',
        projectId: 'project-1',
        taskId: 'task-1',
        now: 1234,
    }

    test('preserves a pending automatic-project routing stamp', () => {
        const projectRouting = {
            status: 'pending',
            source: 'ios_share_extension',
            hostProjectId: 'project-1',
            requestedAt: 1234,
        }

        expect(createTaskObject({ ...requiredParams, projectRouting }).projectRouting).toEqual(projectRouting)
    })

    test('does not add routing metadata to ordinary tasks', () => {
        expect(createTaskObject(requiredParams)).not.toHaveProperty('projectRouting')
    })
})
