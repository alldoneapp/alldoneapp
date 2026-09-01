const fs = require('fs')
const path = require('path')

const readSource = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

describe('cross-project destination writes', () => {
    it.each([
        ['tasks', 'backends/Tasks/tasksFirestore.js'],
        ['notes', 'backends/Notes/notesFirestore.js'],
        ['goals', 'backends/Goals/goalsFirestore.js'],
        ['skills', 'backends/Skills/skillsFirestore.js'],
        ['activity history', 'backends/firestore.js'],
    ])('strips server access projections from moved %s', (_label, relativePath) => {
        const source = readSource(relativePath)

        expect(source).toMatch(/withoutServerAccessProjection/)
    })

    // Stripping the projection only covers a FREE destination id. A calendar task
    // is keyed by its calendar event id, and any move that failed after the
    // destination write leaves the id occupied for good — in both cases the same
    // set() becomes an update that deletes the destination's projection fields and
    // is refused. Every destination write must therefore merge.
    it.each([
        ['tasks', 'backends/Tasks/tasksFirestore.js', /items\/\$\{newProject\.id\}\/tasks\//g],
        ['notes', 'backends/Notes/notesFirestore.js', /noteItems\/\$\{newProject\.id\}\/notes\//g],
        ['contacts', 'backends/Contacts/contactsFirestore.js', /projectsContacts\/\$\{newProject\.id\}\/contacts\//g],
    ])('merges rather than overwrites the destination %s document', (_label, relativePath, destinationPath) => {
        const source = readSource(relativePath)
        const writes = [...source.matchAll(destinationPath)]

        expect(writes.length).toBeGreaterThan(0)
        writes.forEach(match => {
            // Look at the statement the destination reference belongs to. A
            // `.delete()` on the destination never happens, so any statement that
            // writes it must carry the shared merge option.
            const statement = source.slice(match.index, source.indexOf('\n\n', match.index))
            if (!statement.includes('.set(')) return
            expect(statement).toContain('CROSS_PROJECT_DESTINATION_WRITE')
        })
    })

    it('keeps the merge option a single shared declaration', () => {
        const source = readSource('backends/accessProjection.js')

        expect(source).toMatch(/export const CROSS_PROJECT_DESTINATION_WRITE = \{ merge: true \}/)
    })

    it('copies moved chats and their original comments through the authenticated server function', () => {
        const source = readSource('backends/Chats/chatsFirestore.js')
        const branch = source.match(
            /export async function moveChatOnMoveObjectFromProject\(([^]*?)\n}\n\nexport async function updateStickyChatData/
        )

        expect(branch).not.toBeNull()
        expect(source).toMatch(/runHttpsCallableFunction\('copyProjectMoveChatSecondGen'/)
        expect(source).not.toMatch(/chatComments\/\$\{newProjectId\}/)
        expect(branch[1]).toMatch(/if \(objectType === 'topics'\) \{[^]*?sourceChatRef\.get\(\)/)
        expect(branch[1]).not.toMatch(/sourceChatRef\.(update|delete)\(/)
    })
})
