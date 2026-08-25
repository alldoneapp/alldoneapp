const admin = require('firebase-admin')

jest.mock('firebase-admin', () => {
    const roleGet = jest.fn()
    const save = jest.fn()
    const getFiles = jest.fn()
    return {
        __mocks: { roleGet, save, getFiles },
        firestore: jest.fn(() => ({ doc: jest.fn(() => ({ get: roleGet })) })),
        storage: jest.fn(() => ({
            bucket: jest.fn(() => ({
                file: jest.fn(name => ({ name, save })),
                getFiles,
            })),
        })),
    }
})

const { uploadAssistantSkillFile } = require('./assistantSkillUpload')

const { roleGet, save, getFiles } = admin.__mocks

const ADMIN_ID = 'admin-user'
const VALID_SKILL_ID = 'abcdef1234567890abcd'

const contentOf = text => Buffer.from(text).toString('base64')

const upload = (overrides = {}) =>
    uploadAssistantSkillFile({
        userId: ADMIN_ID,
        skillId: VALID_SKILL_ID,
        version: 1,
        relativePath: 'scripts/run.py',
        contentBase64: contentOf('print(1)'),
        ...overrides,
    })

describe('uploadAssistantSkillFile', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        roleGet.mockResolvedValue({ exists: true, data: () => ({ userId: ADMIN_ID }) })
        getFiles.mockResolvedValue([[]])
        save.mockResolvedValue()
        jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        console.log.mockRestore()
    })

    it('stores the file under the skill id and version, and reports the stored path', async () => {
        const result = await upload()

        expect(result).toEqual({
            relativePath: 'scripts/run.py',
            storagePath: `assistantSkills/${VALID_SKILL_ID}/1/scripts/run.py`,
            size: 8,
        })
        expect(save).toHaveBeenCalledWith(Buffer.from('print(1)'))
    })

    it('defaults to version 1 when none is given', async () => {
        const result = await upload({ version: undefined })

        expect(result.storagePath).toContain(`/${VALID_SKILL_ID}/1/`)
    })

    it('refuses a caller who is not the administrator', async () => {
        roleGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'someone-else' }) })

        await expect(upload()).rejects.toMatchObject({ code: 'permission-denied' })
        expect(save).not.toHaveBeenCalled()
    })

    it('refuses when no administrator is configured at all', async () => {
        roleGet.mockResolvedValue({ exists: false })

        await expect(upload()).rejects.toMatchObject({ code: 'permission-denied' })
    })

    // The relative path becomes a path inside the VM's skill mount directory,
    // so traversal has to die here rather than at mount time.
    it.each([
        ['../../etc/passwd'],
        ['a/../../b.txt'],
        ['/absolute.txt'],
        ['windows\\style.txt'],
        ['./hidden.txt'],
        ['double//slash.txt'],
        ['deep/1/2/3/4/5/6/7/8/9/10.txt'],
    ])('refuses the unsafe path %p', async relativePath => {
        await expect(upload({ relativePath })).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(save).not.toHaveBeenCalled()
    })

    it('refuses a path carrying control characters', async () => {
        await expect(upload({ relativePath: 'run\u0007.py' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('refuses an implausible skill id rather than writing to an arbitrary prefix', async () => {
        await expect(upload({ skillId: '../other' })).rejects.toMatchObject({ code: 'invalid-argument' })
        await expect(upload({ skillId: 'short' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('refuses content that is not valid base64 instead of storing a truncated file', async () => {
        // Node's decoder would silently drop the invalid characters here.
        await expect(upload({ contentBase64: 'not base64!!' })).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(save).not.toHaveBeenCalled()
    })

    it('refuses empty content', async () => {
        await expect(upload({ contentBase64: '' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('refuses a file past the per-file cap the VM will mount', async () => {
        const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')

        await expect(upload({ contentBase64: oversized })).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(save).not.toHaveBeenCalled()
    })

    it('refuses to grow a bundle past the number of files the VM will mount', async () => {
        getFiles.mockResolvedValue([
            Array.from({ length: 20 }, (unused, index) => ({
                name: `assistantSkills/${VALID_SKILL_ID}/1/file-${index}.txt`,
            })),
        ])

        await expect(upload()).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(save).not.toHaveBeenCalled()
    })

    it('allows overwriting a file that is already part of the bundle at the cap', async () => {
        getFiles.mockResolvedValue([
            [
                ...Array.from({ length: 19 }, (unused, index) => ({
                    name: `assistantSkills/${VALID_SKILL_ID}/1/file-${index}.txt`,
                })),
                { name: `assistantSkills/${VALID_SKILL_ID}/1/scripts/run.py` },
            ],
        ])

        await expect(upload()).resolves.toMatchObject({ relativePath: 'scripts/run.py' })
    })
})
