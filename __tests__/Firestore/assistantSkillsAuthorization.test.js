const fs = require('fs')
const path = require('path')

/**
 * AT-2450 — normal users may add skills for their own projects' assistants,
 * while the administrator's curated global catalog stays administrator-only.
 *
 * These assert against the rules SOURCE, which is the convention this repo
 * already uses for authorization (see defaultProjectAuthorization.test.js):
 * there is no Firestore emulator harness here, so a behavioural test would need
 * infrastructure that does not exist. The value is the ratchet — the rule that
 * separates the two catalogs cannot be quietly deleted or loosened.
 */
describe('assistant skills Firestore authorization', () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')

    // Everything between the skills match block and its closing brace.
    const skillsBlock = rules.match(/match \/assistantSkills\/\{projectId\}\/items\/\{skillId\} \{([\s\S]*?)\n {4}\}/)
    const importsProjectBlock = rules.match(
        /match \/assistantSkillImports\/\{projectId\}\/items\/\{importId\} \{([\s\S]*?)\n {4}\}/
    )
    const importJobsBlock = rules.match(/match \/assistantSkillImportJobs\/\{jobId\} \{([\s\S]*?)\n {4}\}/)

    test('the skills catalog rule still exists and is split per operation', () => {
        expect(skillsBlock).not.toBeNull()
        const block = skillsBlock[1]
        // A blanket `allow write` would silently re-merge create/update/delete and
        // drop the creatorId pinning below with it.
        expect(block).not.toMatch(/allow write:/)
        expect(block).toMatch(/allow read:/)
        expect(block).toMatch(/allow create:/)
        expect(block).toMatch(/allow update:/)
        expect(block).toMatch(/allow delete:/)
    })

    test('the global catalog remains administrator-only for every write', () => {
        const block = skillsBlock[1]
        for (const operation of ['create', 'update', 'delete']) {
            const line = block.match(new RegExp(`allow ${operation}:[\\s\\S]*?;`))
            expect(line).not.toBeNull()
            // Each write path must offer the administrator branch for the global
            // catalog — that is the capability AT-2450 had to preserve.
            expect(line[0]).toMatch(/isGlobalSkillCatalog\(projectId\) && isAdministrator\(\)/)
        }
    })

    test('a project catalog is gated on membership of that project, never on being signed in alone', () => {
        const block = skillsBlock[1]
        for (const operation of ['read', 'create', 'update', 'delete']) {
            const line = block.match(new RegExp(`allow ${operation}:[\\s\\S]*?;`))
            expect(line[0]).toMatch(/!isGlobalSkillCatalog\(projectId\) && isProjectMember\(projectId\)/)
        }
    })

    test('project skills are not world-readable the way the global catalog is', () => {
        const readLine = skillsBlock[1].match(/allow read:[\s\S]*?;/)[0]
        // `signedIn()` may only ever appear on the global-catalog side of the read.
        expect(readLine).toMatch(/isGlobalSkillCatalog\(projectId\) && signedIn\(\)/)
        expect(readLine).not.toMatch(/^\s*allow read: if signedIn\(\);/)
    })

    test('creatorId is pinned to the caller on create and frozen on update', () => {
        const createLine = skillsBlock[1].match(/allow create:[\s\S]*?;/)[0]
        expect(createLine).toMatch(/request\.resource\.data\.creatorId == request\.auth\.uid/)

        const updateLine = skillsBlock[1].match(/allow update:[\s\S]*?;/)[0]
        expect(updateLine).toMatch(/request\.resource\.data\.creatorId == resource\.data\.creatorId/)
        expect(updateLine).toMatch(/request\.resource\.data\.lastEditorId == request\.auth\.uid/)
    })

    test('isGlobalSkillCatalog names the one catalog the administrator owns', () => {
        expect(rules).toMatch(/function isGlobalSkillCatalog\(projectId\) \{\s*return projectId == 'globalProject';/)
    })

    test("the administrator's flat import staging area is untouched", () => {
        // It holds live documents in production; moving it would strand them.
        expect(rules).toMatch(/match \/assistantSkillImports\/\{importId\} \{\s*allow read, write: if isAdministrator\(\);/)
    })

    test('project imports stage under their own project and need membership', () => {
        expect(importsProjectBlock).not.toBeNull()
        expect(importsProjectBlock[1]).toMatch(/allow read, write: if isProjectMember\(projectId\);/)
    })

    test('an import progress doc is readable by the administrator or the requester only', () => {
        expect(importJobsBlock).not.toBeNull()
        const block = importJobsBlock[1]
        expect(block).toMatch(/allow read: if isAdministrator\(\) \|\|/)
        expect(block).toMatch(/resource\.data\.createdBy == request\.auth\.uid/)
        // Progress is server-written; a client must never be able to forge it.
        expect(block).toMatch(/allow write: if false;/)
    })
})
