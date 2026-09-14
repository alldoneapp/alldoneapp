const fs = require('fs')
const path = require('path')

describe('AT-2194 note ownership through the server move', () => {
    it('sends notes through the generic Cloud Function without mutating their owner in the browser', () => {
        const source = fs.readFileSync(path.resolve(__dirname, 'useMoveObjectToProject.js'), 'utf8')

        expect(source).toMatch(/queueObjectProjectMove\(project\.id, newProject\.id, type, objectId\)/)
        expect(source).not.toMatch(/note\.userId\s*=/)
        expect(source).not.toMatch(/setNoteProject\(/)
    })

    it('copies the full source note so assistant ownership is preserved server-side', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../../functions/shared/moveNoteToDifferentProject.js'),
            'utf8'
        )

        expect(source).toMatch(/\.\.\.\(sourceNoteDoc\.data\(\) \|\| \{\}\)/)
        expect(source).not.toMatch(/movedNote\.userId\s*=/)
    })
})
