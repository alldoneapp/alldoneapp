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
