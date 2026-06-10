import store from '../../../redux/store'

export const SKILL_SOURCE_CUSTOM = 'custom'
export const SKILL_SOURCE_IMPORT = 'import'

export const MAX_SKILL_NAME_LENGTH = 64
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024

// Slug rules from the Agent Skills spec (agentskills.io): lowercase letters,
// digits and hyphens, no leading/trailing/consecutive hyphens.
const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidSkillName(name) {
    return (
        typeof name === 'string' &&
        name.length > 0 &&
        name.length <= MAX_SKILL_NAME_LENGTH &&
        SKILL_NAME_REGEX.test(name)
    )
}

export function getNewDefaultAssistantSkill() {
    const { loggedUser } = store.getState()
    return {
        name: '',
        displayName: '',
        description: '',
        body: '',
        files: [],
        version: 1,
        enabled: true,
        source: { type: SKILL_SOURCE_CUSTOM },
        creatorId: loggedUser.uid,
        createdDate: Date.now(),
        lastEditorId: loggedUser.uid,
        lastEditionDate: Date.now(),
    }
}

// Skills bundling scripts or reference files can only run inside the VM agent.
// Pure markdown skills also work in the normal chat assistant.
export function isVmOnlySkill(skill) {
    return Array.isArray(skill?.files) && skill.files.length > 0
}

export function getSkillRuntimeLabelKey(skill) {
    return isVmOnlySkill(skill) ? 'VM only' : 'Chat + VM'
}

export function normalizeEnabledSkillIds(enabledSkillIds) {
    if (!Array.isArray(enabledSkillIds)) return []
    const seen = new Set()
    const result = []
    for (const id of enabledSkillIds) {
        if (typeof id === 'string' && id && !seen.has(id)) {
            seen.add(id)
            result.push(id)
        }
    }
    return result
}
