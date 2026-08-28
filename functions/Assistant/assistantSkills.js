const admin = require('firebase-admin')
const { findBuiltInSkill } = require('./builtInAssistantSkills')

const GLOBAL_PROJECT_ID = 'globalProject'
const SKILLS_COLLECTION_PATH = `assistantSkills/${GLOBAL_PROJECT_ID}/items`
// Storage prefix for bundled skill files: `assistantSkills/{skillId}/{version}/{relativePath}`.
const SKILL_STORAGE_ROOT = 'assistantSkills'

// Caps applied when mounting bundled skill files into the VM sandbox.
const MAX_SKILL_FILES = 20
const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024 // 5 MB per file
const MAX_SKILL_TOTAL_BYTES = 20 * 1024 * 1024 // 20 MB across all mounted skills

// Slug rules from the Agent Skills spec (agentskills.io). Also reused as the
// sandbox directory-name guard so a skill can never escape its mount folder.
const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

function isValidSkillName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 64 && SKILL_NAME_REGEX.test(name)
}

// Bundled files only make sense where the agent can execute/read them — the VM.
// Pure markdown skills also work in the in-app chat assistant.
function isVmOnlySkill(skill) {
    return Array.isArray(skill?.files) && skill.files.length > 0
}

// A skill catalog is keyed by the project that owns it. `globalProject` is the
// curated catalog; anything else is a project's own skills (AT-2450).
function getSkillsCollectionPath(projectId) {
    return `assistantSkills/${projectId || GLOBAL_PROJECT_ID}/items`
}

function isGlobalSkillCatalog(projectId) {
    return !projectId || projectId === GLOBAL_PROJECT_ID
}

/**
 * Storage prefix for one skill's bundled files.
 *
 * Scoped by project (AT-2450) so a member of project A cannot write bytes into
 * — or exhaust the 20-file budget of — a skill belonging to project B or to the
 * global catalog. The bundle upload has to authorize on the project the caller
 * names rather than on the skill document, because the files are written BEFORE
 * that document exists (every stored `storagePath` contains the id), so the
 * prefix is the only thing that can isolate them.
 *
 * Existing skills keep working untouched: `mountSkillsInSandbox` downloads each
 * file by the absolute `storagePath` recorded on the document, so bundles
 * written under the old unscoped prefix still resolve.
 */
function getSkillStoragePrefix(projectId, skillId, version) {
    return `${SKILL_STORAGE_ROOT}/${projectId || GLOBAL_PROJECT_ID}/${skillId}/${version}/`
}

function permissionDenied(message) {
    const error = new Error(message)
    error.code = 'permission-denied'
    return error
}

// Every write into the GLOBAL catalog (repo import, direct file upload) is
// administrator-only. Lives here rather than in one of the callers so the two
// entry points cannot drift into two different definitions of "admin".
async function requireSkillAdministrator(userId) {
    const roleDoc = await admin.firestore().doc('roles/administrator').get()
    const adminUserId = roleDoc.exists ? roleDoc.data().userId : null
    if (!adminUserId || adminUserId !== userId) {
        throw permissionDenied('Only the administrator can manage skills')
    }
}

// Mirrors `isProjectMember()` in firestore.rules — the same four membership
// lists, so a write the rules would allow from the client is also allowed
// through the callables, and nothing else is.
const PROJECT_MEMBERSHIP_FIELDS = ['projectIds', 'guideProjectIds', 'templateProjectIds', 'archivedProjectIds']

async function isProjectMember(userId, projectId) {
    if (!userId || !projectId) return false
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) return false
    const userData = userDoc.data() || {}
    return PROJECT_MEMBERSHIP_FIELDS.some(
        field => Array.isArray(userData[field]) && userData[field].includes(projectId)
    )
}

/**
 * Authorize a write into one project's skill catalog.
 *
 * The global catalog keeps its administrator-only gate untouched. A project
 * catalog is governed by project membership, which is the same boundary that
 * already governs that project's assistants (`assistants/{projectId}/items/*`
 * is `isProjectMember` writable) — so a member can only ever add skills for
 * assistants they already control, and never for a project they are not in.
 */
async function requireSkillWriteAccess(userId, projectId) {
    if (isGlobalSkillCatalog(projectId)) return requireSkillAdministrator(userId)
    if (!(await isProjectMember(userId, projectId))) {
        throw permissionDenied('Only members of this project can manage its skills')
    }
}

async function loadSkillsByIds(enabledSkillIds) {
    if (!Array.isArray(enabledSkillIds) || enabledSkillIds.length === 0) return []
    const db = admin.firestore()
    const ids = [...new Set(enabledSkillIds.filter(id => typeof id === 'string' && id))]
    if (ids.length === 0) return []
    const builtInSkills = ids.map(findBuiltInSkill).filter(Boolean)
    const firestoreIds = ids.filter(id => !findBuiltInSkill(id))
    const refs = firestoreIds.map(id => db.doc(`${SKILLS_COLLECTION_PATH}/${id}`))
    if (refs.length === 0) return builtInSkills
    const docs = await db.getAll(...refs)
    const skills = [...builtInSkills]
    docs.forEach(doc => {
        if (!doc.exists) return
        const skill = { ...doc.data(), uid: doc.id }
        if (skill.enabled === false) return
        if (!isValidSkillName(skill.name)) return
        skills.push(skill)
    })
    return skills
}

/**
 * Every enabled skill a project owns (AT-2450).
 *
 * Project skills are NOT opt-in per assistant the way catalog skills are: a
 * skill added to a project is immediately available to that project's
 * assistants. That is the whole point of the feature — the project is the unit
 * of sharing, so there is no second switch to forget to flip. The per-skill
 * `enabled` flag is the off switch.
 */
async function loadProjectSkills(projectId) {
    if (isGlobalSkillCatalog(projectId)) return []
    const snapshot = await admin.firestore().collection(getSkillsCollectionPath(projectId)).get()
    const skills = []
    snapshot.forEach(doc => {
        const skill = { ...doc.data(), uid: doc.id }
        if (skill.enabled === false) return
        // Same two guards `loadSkillsByIds` applies: an invalid name cannot be
        // mounted (it becomes a directory name in the sandbox) and must never
        // reach the index block either.
        if (!isValidSkillName(skill.name)) return
        skills.push(skill)
    })
    return skills
}

/**
 * `name` is the identity a skill is addressed by — `load_skill` looks it up by
 * name and `mountSkillsInSandbox` uses it as the sandbox directory — so two
 * skills sharing one name are not merely redundant, they collide.
 *
 * The curated catalog wins. A project skill that shadows a catalog name is
 * dropped rather than allowed to override it: silently replacing an
 * admin-curated skill for everyone in the project is the more surprising of the
 * two failures, and it would let a project member change behaviour that the
 * administrator is responsible for.
 */
function mergeSkillsByName(catalogSkills, projectSkills) {
    const merged = [...catalogSkills]
    const takenNames = new Set(catalogSkills.map(skill => skill.name))
    for (const skill of projectSkills) {
        if (takenNames.has(skill.name)) continue
        takenNames.add(skill.name)
        merged.push(skill)
    }
    return merged
}

// Resolve the assistant doc the same way the chat runtime does (project-level
// settings override the global assistant) and load its enabled skills, plus
// every skill the project itself owns.
async function loadEnabledSkillsForAssistant(projectId, assistantId) {
    if (!assistantId) return []
    const db = admin.firestore()
    const [globalDoc, projectDoc] = await db.getAll(
        db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`),
        db.doc(`assistants/${projectId}/items/${assistantId}`)
    )
    const assistant = projectDoc?.exists ? projectDoc.data() : globalDoc?.exists ? globalDoc.data() : null
    if (!assistant) return []
    const [catalogSkills, projectSkills] = await Promise.all([
        loadSkillsByIds(assistant.enabledSkillIds),
        loadProjectSkills(projectId),
    ])
    return mergeSkillsByName(catalogSkills, projectSkills)
}

// The chat runtime checks skill availability on every message, so cache the
// resolved skill list per assistant briefly (the VM path skips this cache —
// one read per job is fine and should always be fresh).
const CHAT_SKILLS_CACHE_TTL_MS = 60000
const chatSkillsCache = new Map()

// Skills usable by the in-app chat assistant: enabled and markdown-only.
// VM-only skills (bundled scripts/files) are excluded — chat cannot execute
// them and their bodies reference files that do not exist in that runtime.
async function loadChatSkillsForAssistant(projectId, assistantId) {
    if (!projectId || !assistantId) return []
    const cacheKey = `${projectId}/${assistantId}`
    const cached = chatSkillsCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CHAT_SKILLS_CACHE_TTL_MS) return cached.skills
    const skills = (await loadEnabledSkillsForAssistant(projectId, assistantId)).filter(skill => !isVmOnlySkill(skill))
    chatSkillsCache.set(cacheKey, { skills, timestamp: Date.now() })
    if (chatSkillsCache.size > 200) {
        const oldestKey = chatSkillsCache.keys().next().value
        chatSkillsCache.delete(oldestKey)
    }
    return skills
}

async function hasChatSkillsEnabled(projectId, assistantId) {
    const skills = await loadChatSkillsForAssistant(projectId, assistantId)
    return skills.length > 0
}

async function loadChatSkillByName(projectId, assistantId, skillName) {
    const skills = await loadChatSkillsForAssistant(projectId, assistantId)
    const skill = skills.find(candidate => candidate.name === skillName) || null
    return { skill, availableSkillNames: skills.map(candidate => candidate.name) }
}

// Reconstruct a spec-compliant SKILL.md (frontmatter + body) from a registry doc.
function buildSkillMarkdown(skill) {
    const description = typeof skill.description === 'string' ? skill.description : ''
    const frontmatter = ['---', `name: ${skill.name}`, `description: ${JSON.stringify(description)}`, '---', ''].join(
        '\n'
    )
    const body = typeof skill.body === 'string' ? skill.body : ''
    return frontmatter + body
}

// One compact index line per skill — this is the only part that is always in
// context for the in-app assistant (progressive disclosure level 1).
function buildSkillsIndexBlock(skills) {
    const lines = [...skills]
        .sort((firstSkill, secondSkill) => firstSkill.name.localeCompare(secondSkill.name))
        .map(skill => `- ${skill.name}: ${skill.description || ''}`)
    return [
        'You have access to the following skills (expert instruction packs). Each line is "name: when to use it":',
        ...lines,
        'When a user request matches a skill, call the load_skill tool with that skill name FIRST and follow the returned instructions while doing the work. Do not guess at what a skill contains — load it.',
    ].join('\n')
}

function getSandboxSkillsDir(agent) {
    return agent === 'codex' ? '/home/user/.agents/skills' : '/home/user/.claude/skills'
}

// Mount the skills into the sandbox so the agent's native discovery picks them
// up. Wipes the mount dir first so skills disabled since the last run of a
// resumed session disappear. Never throws — a skill mount failure must not
// fail the whole VM job.
async function mountSkillsInSandbox(sandbox, skills, agent, correlationId) {
    const skillsDir = getSandboxSkillsDir(agent)
    try {
        await sandbox.commands.run(`rm -rf ${skillsDir} && mkdir -p ${skillsDir}`, { timeoutMs: 30000 })
        if (!skills.length) return { mounted: 0 }

        const bucket = admin.storage().bucket()
        let totalBytes = 0
        let mounted = 0
        for (const skill of skills) {
            const skillDir = `${skillsDir}/${skill.name}`
            await sandbox.files.write(`${skillDir}/SKILL.md`, buildSkillMarkdown(skill))
            const files = Array.isArray(skill.files) ? skill.files.slice(0, MAX_SKILL_FILES) : []
            for (const file of files) {
                if (!file || typeof file.relativePath !== 'string' || typeof file.storagePath !== 'string') continue
                // Bundled file paths come from the registry; keep them strictly inside the skill dir.
                const relativePath = file.relativePath.replace(/\\/g, '/')
                if (relativePath.includes('..') || relativePath.startsWith('/')) continue
                const size = Number(file.size) || 0
                if (size > MAX_SKILL_FILE_BYTES || totalBytes + size > MAX_SKILL_TOTAL_BYTES) {
                    console.warn('🖥️ VM JOB: skipping oversized skill file', {
                        correlationId,
                        skill: skill.name,
                        relativePath,
                        size,
                    })
                    continue
                }
                const [buffer] = await bucket.file(file.storagePath).download()
                totalBytes += buffer.length
                const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
                await sandbox.files.write(`${skillDir}/${relativePath}`, arrayBuffer)
            }
            mounted++
        }
        console.log('🖥️ VM JOB: mounted skills', {
            correlationId,
            agent,
            mounted,
            skills: skills.map(skill => skill.name),
        })
        return { mounted }
    } catch (error) {
        console.warn('🖥️ VM JOB: skill mounting failed — continuing without skills', {
            correlationId,
            error: error.message,
        })
        return { mounted: 0, error: error.message }
    }
}

module.exports = {
    SKILLS_COLLECTION_PATH,
    SKILL_STORAGE_ROOT,
    GLOBAL_PROJECT_ID,
    getSkillsCollectionPath,
    getSkillStoragePrefix,
    isGlobalSkillCatalog,
    requireSkillAdministrator,
    requireSkillWriteAccess,
    isProjectMember,
    loadProjectSkills,
    mergeSkillsByName,
    isValidSkillName,
    isVmOnlySkill,
    loadSkillsByIds,
    loadEnabledSkillsForAssistant,
    loadChatSkillsForAssistant,
    hasChatSkillsEnabled,
    loadChatSkillByName,
    buildSkillMarkdown,
    buildSkillsIndexBlock,
    getSandboxSkillsDir,
    mountSkillsInSandbox,
}
