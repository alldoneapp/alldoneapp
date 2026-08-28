const admin = require('firebase-admin')

const { requireSkillWriteAccess, getSkillStoragePrefix } = require('./assistantSkills')

// Kept in step with the client caps in components/AdminPanel/AssistantSkills/skillDraftFromSource.js
// and with the mount-time caps in assistantSkills.js. A file that passes here
// must still be mountable in the VM sandbox.
const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024
const MAX_SKILL_FILES = 20
const MAX_RELATIVE_PATH_LENGTH = 512
const MAX_PATH_SEGMENTS = 10
const MAX_PATH_SEGMENT_LENGTH = 128

const SKILL_ID_REGEX = /^[A-Za-z0-9_-]{6,64}$/
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/

function invalidArgument(message) {
    const error = new Error(message)
    error.code = 'invalid-argument'
    return error
}

/**
 * Bundled skill files are written server-side, never by the client.
 *
 * Two reasons, both structural: the app has no Storage rule granting a client
 * write under `assistantSkills/**` (the GitHub import has always written these
 * with the Admin SDK), and `relativePath` ends up as a path inside the VM
 * sandbox's skill mount — so it has to be validated somewhere the caller cannot
 * reach. A traversing path here would let a skill write outside its own mount
 * directory when `mountSkillsInSandbox` unpacks it.
 */
function assertSafeRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath) throw invalidArgument('A file path is required')
    if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) throw invalidArgument('File path is too long')
    if (/[\u0000-\u001f\u007f]/.test(relativePath)) throw invalidArgument('File path contains control characters')
    if (relativePath.includes('\\') || relativePath.startsWith('/')) throw invalidArgument('Invalid file path')

    const segments = relativePath.split('/')
    if (segments.length > MAX_PATH_SEGMENTS) throw invalidArgument('File path is nested too deeply')
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..') throw invalidArgument('Invalid file path')
        if (segment.length > MAX_PATH_SEGMENT_LENGTH) throw invalidArgument('File path segment is too long')
    }
}

function decodeContent(contentBase64) {
    if (typeof contentBase64 !== 'string') throw invalidArgument('File content is required')
    // Node's base64 decoder drops invalid characters silently, so a malformed
    // payload would otherwise be stored as a truncated file that looks fine.
    if (!BASE64_REGEX.test(contentBase64)) throw invalidArgument('File content is not valid base64')
    const buffer = Buffer.from(contentBase64, 'base64')
    if (buffer.length === 0) throw invalidArgument('File content is empty')
    if (buffer.length > MAX_SKILL_FILE_BYTES) {
        throw invalidArgument(`File exceeds the ${Math.round(MAX_SKILL_FILE_BYTES / (1024 * 1024))} MB limit`)
    }
    return buffer
}

function resolveVersion(version) {
    if (version === undefined || version === null || version === '') return 1
    const parsed = Number(version)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) throw invalidArgument('Invalid skill version')
    return parsed
}

/**
 * Store one bundled file for a skill being composed in the Add-skill form
 * (AT-2431). Mirrors what the GitHub import writes, so an uploaded bundle and
 * an imported one are indistinguishable downstream.
 *
 * `projectId` selects the catalog being written to and is what the call is
 * authorized against (AT-2450): the global catalog stays administrator-only,
 * a project catalog needs membership of that project.
 */
async function uploadAssistantSkillFile({ userId, projectId, skillId, version, relativePath, contentBase64 }) {
    await requireSkillWriteAccess(userId, projectId)

    if (typeof skillId !== 'string' || !SKILL_ID_REGEX.test(skillId)) throw invalidArgument('Invalid skill id')
    const resolvedVersion = resolveVersion(version)
    assertSafeRelativePath(relativePath)
    const content = decodeContent(contentBase64)

    const bucket = admin.storage().bucket()
    const prefix = getSkillStoragePrefix(projectId, skillId, resolvedVersion)
    const storagePath = `${prefix}${relativePath}`

    // Bounded so a runaway client loop cannot fill the bucket. The listing is
    // capped at the limit itself, so this stays one cheap call per upload.
    const [existing] = await bucket.getFiles({ prefix, maxResults: MAX_SKILL_FILES + 1 })
    const alreadyStored = existing.filter(file => file.name !== storagePath).length
    if (alreadyStored >= MAX_SKILL_FILES) {
        throw invalidArgument(`A skill can bundle at most ${MAX_SKILL_FILES} files`)
    }

    await bucket.file(storagePath).save(content)

    console.log('🧩 SKILL UPLOAD: stored bundled file', {
        projectId: projectId || 'globalProject',
        skillId,
        relativePath,
        size: content.length,
    })
    return { relativePath, storagePath, size: content.length }
}

module.exports = { uploadAssistantSkillFile, assertSafeRelativePath, decodeContent, MAX_SKILL_FILE_BYTES }
