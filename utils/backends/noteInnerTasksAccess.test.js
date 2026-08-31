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
})
