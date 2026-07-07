const admin = require('firebase-admin')
const { findBuiltInSkill } = require('./builtInAssistantSkills')

const GLOBAL_PROJECT_ID = 'globalProject'
const SKILLS_COLLECTION_PATH = `assistantSkills/${GLOBAL_PROJECT_ID}/items`

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

// Resolve the assistant doc the same way the chat runtime does (project-level
// settings override the global assistant) and load its enabled skills.
async function loadEnabledSkillsForAssistant(projectId, assistantId) {
    if (!assistantId) return []
    const db = admin.firestore()
    const [globalDoc, projectDoc] = await db.getAll(
        db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`),
        db.doc(`assistants/${projectId}/items/${assistantId}`)
    )
    const assistant = projectDoc?.exists ? projectDoc.data() : globalDoc?.exists ? globalDoc.data() : null
    if (!assistant) return []
    return loadSkillsByIds(assistant.enabledSkillIds)
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
    const lines = skills.map(skill => `- ${skill.name}: ${skill.description || ''}`)
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
