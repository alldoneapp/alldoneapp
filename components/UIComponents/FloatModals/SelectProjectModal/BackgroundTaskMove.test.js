const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, 'useMoveObjectToProject.js'), 'utf8')
const taskBranch = source.match(/if \(type === 'task'\) \{([\s\S]*?)\n        \}/)?.[1] || ''

describe('AT-2533 background task project move', () => {
    it('dispatches the Cloud Function without awaiting it, then returns before legacy client fan-out', () => {
        expect(source).toMatch(/queueObjectProjectMove\(project\.id, newProject\.id, type, objectId\)/)
        expect(taskBranch).not.toMatch(/await\s+completeMove/)
        expect(taskBranch).toMatch(/dispatch\(hideProjectPicker\(\)\)/)
        expect(taskBranch).toMatch(/return/)

        expect(source).not.toMatch(/runMoveStep\('move conversation'/)
    })

    it('does not retain the client-side task move implementation', () => {
        expect(source).not.toMatch(/setTaskProject\(/)
        expect(source).not.toMatch(/setTaskAssignee\(/)
    })

    it('shows a visible failure after the picker has closed when the enqueue is rejected', () => {
        expect(taskBranch).toMatch(/\.catch\(\(\) => \{[\s\S]*showConfirmPopup\(/)
        expect(taskBranch).toMatch(/onTaskProjectMoveEnqueueFailed/)
        expect(taskBranch).toMatch(/trigger: CONFIRM_POPUP_TRIGGER_INFO/)
        expect(taskBranch).toMatch(/headerText: 'Task could not be moved'/)
        expect(taskBranch).toMatch(/headerQuestion: 'No changes were made\. Please try again\.'/)
    })

    it('reports the accepted request id to the open detail-view handoff', () => {
        expect(taskBranch).toMatch(/\.then\(result => \{[\s\S]*taskMoveCallbacks\.onTaskProjectMoveEnqueued/)
    })
})
