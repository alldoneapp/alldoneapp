const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, 'useMoveObjectToProject.js'), 'utf8')
const taskBranch = source.match(/if \(type === 'task'\) \{([\s\S]*?)\n        \}/)?.[1] || ''

describe('AT-2533 background task project move', () => {
    it('dispatches the Cloud Function without awaiting it, then returns before legacy client fan-out', () => {
        expect(taskBranch).toMatch(/completeMove\(queueTaskProjectMove\(project\.id, newProject\.id, data\.id\)\)/)
        expect(taskBranch).not.toMatch(/await\s+completeMove/)
        expect(taskBranch).toMatch(/dispatch\(hideProjectPicker\(\)\)/)
        expect(taskBranch).toMatch(/return/)

        const branchEnd = source.indexOf(taskBranch) + taskBranch.length
        expect(source.indexOf("runMoveStep('move conversation'", branchEnd)).toBeGreaterThan(branchEnd)
    })

    it('does not retain the client-side task move implementation', () => {
        expect(source).not.toMatch(/setTaskProject\(/)
        expect(source).not.toMatch(/setTaskAssignee\(/)
    })
})
