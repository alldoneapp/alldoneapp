'use strict'

// Security audit 2026-11: a skill's files[].storagePath is client-written, and the VM mount reads
// it with the Admin SDK. Only paths inside the skill's own storage prefix may be mounted.

const mockDownload = jest.fn()
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({})),
    storage: jest.fn(() => ({
        bucket: jest.fn(() => ({
            file: jest.fn(path => ({ download: () => mockDownload(path) })),
        })),
    })),
}))

const { isOwnSkillStoragePath, mountSkillsInSandbox } = require('./assistantSkills')

const projectSkill = files => ({
    uid: 'skill-1',
    name: 'deploy-runbook',
    description: 'Deploy',
    body: 'Run it',
    ownerProjectId: 'project-a',
    files,
})

function fakeSandbox() {
    return {
        commands: { run: jest.fn(async () => ({})) },
        files: { write: jest.fn(async () => {}) },
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    mockDownload.mockImplementation(async () => [Buffer.from('bytes')])
})

afterEach(() => jest.restoreAllMocks())

describe('isOwnSkillStoragePath', () => {
    test('accepts a project skill file under its own project and skill prefix', () => {
        expect(isOwnSkillStoragePath(projectSkill(), 'assistantSkills/project-a/skill-1/2/scripts/run.py')).toBe(true)
    })

    test('refuses another tenant, another skill, other folders and traversal', () => {
        const skill = projectSkill()
        expect(isOwnSkillStoragePath(skill, 'assistantSkills/project-b/skill-9/1/secret.txt')).toBe(false)
        expect(isOwnSkillStoragePath(skill, 'assistantSkills/project-a/skill-2/1/run.py')).toBe(false)
        expect(isOwnSkillStoragePath(skill, 'attachments/comment-1/invoice.pdf')).toBe(false)
        expect(isOwnSkillStoragePath(skill, 'assistantSkills/project-a/skill-1/../../project-b/x')).toBe(false)
        expect(isOwnSkillStoragePath(skill, 'assistantSkills/skill-1/1/run.py')).toBe(false)
    })

    test('the global catalog keeps its legacy unscoped prefix', () => {
        const globalSkill = { uid: 'skill-1', ownerProjectId: 'globalProject' }
        expect(isOwnSkillStoragePath(globalSkill, 'assistantSkills/skill-1/1/run.py')).toBe(true)
        expect(isOwnSkillStoragePath(globalSkill, 'assistantSkills/globalProject/skill-1/1/run.py')).toBe(true)
        expect(isOwnSkillStoragePath(globalSkill, 'assistantSkills/project-a/skill-1/1/run.py')).toBe(false)
    })
})

describe('mountSkillsInSandbox', () => {
    test('never downloads a member-written path outside the skill prefix', async () => {
        const sandbox = fakeSandbox()
        await mountSkillsInSandbox(
            sandbox,
            [
                projectSkill([
                    {
                        relativePath: 'scripts/run.py',
                        storagePath: 'assistantSkills/project-a/skill-1/1/scripts/run.py',
                        size: 5,
                    },
                    { relativePath: 'loot.pdf', storagePath: 'attachments/other-tenant/invoice.pdf', size: 0 },
                    { relativePath: 'notes.bin', storagePath: 'notesAttachments/other-tenant/file.bin', size: 0 },
                ]),
            ],
            'claude',
            'job-1'
        )
        expect(mockDownload.mock.calls.map(([path]) => path)).toEqual([
            'assistantSkills/project-a/skill-1/1/scripts/run.py',
        ])
        const written = sandbox.files.write.mock.calls.map(([path]) => path)
        expect(written).toContain('/home/user/.claude/skills/deploy-runbook/scripts/run.py')
        expect(written).not.toContain('/home/user/.claude/skills/deploy-runbook/loot.pdf')
    })
})
