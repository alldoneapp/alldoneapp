const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, 'firestore.js'), 'utf8')

describe('note inner task access query', () => {
    it.each(['getNoteInnerTasks', 'watchNoteInnerTasks'])(
        'uses the per-reader backlink projection in %s',
        functionName => {
            const functionStart = source.indexOf(`${functionName}(`)
            const nextFunctionStart = source.indexOf('\nexport ', functionStart)
            const branch = source.slice(functionStart, nextFunctionStart)

            expect(functionStart).toBeGreaterThan(-1)
            expect(nextFunctionStart).toBeGreaterThan(functionStart)
            expect(branch).toMatch(/getBacklinkIdsVisibleToField\(getLoggedUserAccessReaderId\(\)\)/)
            expect(branch).toMatch(/buildBacklinkToken\('containerNotesIds', noteId\)/)
            expect(branch).not.toMatch(/\.where\('containerNotesIds'/)
        }
    )

    it('turns an optional inner-task listener denial into the empty embedded-task state', () => {
        const functionStart = source.indexOf('watchNoteInnerTasks(')
        const nextFunctionStart = source.indexOf('\nexport ', functionStart)
        const branch = source.slice(functionStart, nextFunctionStart)

        expect(branch).toMatch(/handleOptionalSnapshotError\('note inner tasks', error, \(\) => callback\(\{\}\)\)/)
    })

    it('reader-scopes the subtask query started by an embedded task tag', () => {
        const functionStart = source.indexOf('watchSubtasks(projectId, taskId, watcherKey, callback)')
        const nextFunctionStart = source.indexOf('\nexport ', functionStart + 1)
        const branch = source.slice(functionStart, nextFunctionStart)

        expect(functionStart).toBeGreaterThan(-1)
        expect(nextFunctionStart).toBeGreaterThan(functionStart)
        expect(branch).toMatch(/\.where\('readerIds', 'array-contains', getLoggedUserAccessReaderId\(\)\)/)
        expect(branch).toMatch(/\.where\('parentId', '==', taskId\)/)
        expect(branch).toMatch(
            /handleOptionalSnapshotError\('embedded task subtasks', error, \(\) => callback\(\[\]\)\)/
        )
    })
})
