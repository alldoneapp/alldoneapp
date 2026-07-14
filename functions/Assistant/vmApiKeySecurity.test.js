const fs = require('fs')
const path = require('path')

describe('VM API key Firestore security', () => {
    test('denies every client read and write to the server-only userSecrets subtree', () => {
        const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')
        expect(rules).toMatch(
            /match \/userSecrets\/\{userId\}\/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/
        )
    })
})
