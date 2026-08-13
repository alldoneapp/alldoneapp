const fs = require('fs')
const path = require('path')

describe('default project Firestore authorization', () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')

    test('requires a configured default project to be owned by the user', () => {
        expect(rules).toMatch(
            /function hasValidDefaultProject\(userId, userData\)[\s\S]*projectDocAfter\(userData\.defaultProjectId\)\.data\.creatorId == userId/
        )
    })

    test('validates both user creation and changes to defaultProjectId', () => {
        expect(rules).toMatch(/allow create:[\s\S]*hasValidDefaultProject\(userId, request\.resource\.data\)/)
        expect(rules).toMatch(
            /allow update:[\s\S]*affectedKeys\(\)\.hasAny\(\['defaultProjectId'\]\)[\s\S]*hasValidDefaultProject\(userId, request\.resource\.data\)/
        )
    })
})
