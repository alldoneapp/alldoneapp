const assert = require('assert')
const {
    GENERIC_TOOL_FAILURE_MESSAGE,
    TASK_CREATION_FAILURE_MESSAGE,
    getUserFacingToolErrorMessage,
} = require('../WhatsApp/whatsAppToolErrorUtils')

const run = () => {
    assert.strictEqual(
        getUserFacingToolErrorMessage('update_task', {
            message:
                'No tasks found matching search criteria: taskName: "haushaltsgeld". Try being more specific or check the task/project names.',
        }),
        "I couldn't find a task matching that name. Please check the task name or tell me which project it's in."
    )

    assert.strictEqual(
        getUserFacingToolErrorMessage('update_task', {
            message: 'taskName "task" is too generic. Please be more specific.',
        }),
        'That task name is too generic to update safely. Please be more specific.'
    )

    assert.strictEqual(
        getUserFacingToolErrorMessage('create_task', {
            message: 'Project not found: "Marketing"',
        }),
        'Project not found: "Marketing"'
    )

    assert.strictEqual(
        getUserFacingToolErrorMessage('create_task', {
            message: '   ',
        }),
        TASK_CREATION_FAILURE_MESSAGE
    )

    assert.strictEqual(
        getUserFacingToolErrorMessage('update_task', {
            message: 'Database offline',
        }),
        GENERIC_TOOL_FAILURE_MESSAGE
    )

    console.log('whatsAppToolErrorUtils tests passed')
}

if (require.main === module) run()

// The file ends in .test.js, so Jest collects it and would otherwise fail
// the suite for having no tests. Running it as one keeps the assertions
// meaningful in both places.
if (typeof test === 'function') test('whatsAppToolErrorUtils error handling', run)

module.exports = { run }
