const ParsingTextHelper = require('../../ParsingTextHelper')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/{projectId}/skills/{skillId}
 */
const URL_SKILL_DETAILS = 'SKILL_DETAILS'

/**
 * /projects/{projectId}/skills/{skillId}/properties
 */
const URL_SKILL_DETAILS_PROPERTIES = 'SKILL_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/skills/{skillId}/chat
 */
const URL_SKILL_DETAILS_CHAT = 'SKILL_DETAILS_CHAT'

/**
 * /projects/{projectId}/skills/{skillId}/note
 */
const URL_SKILL_DETAILS_NOTE = 'SKILL_DETAILS_NOTE'

/**
 * /projects/{projectId}/skills/{skillId}/backlinks/tasks
 */
const URL_SKILL_DETAILS_BACKLINKS_TASKS = 'SKILL_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/skills/{skillId}/backlinks/notes
 */
const URL_SKILL_DETAILS_BACKLINKS_NOTES = 'SKILL_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/skills/{skillId}/updates
 */
const URL_SKILL_DETAILS_FEED = 'SKILL_DETAILS_FEED'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_SKILL_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)$'),
    [URL_SKILL_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/updates$'),
    [URL_SKILL_DETAILS_PROPERTIES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/properties$'
    ),
    [URL_SKILL_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/note$'),
    [URL_SKILL_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/chat$'),
    [URL_SKILL_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_SKILL_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/backlinks/notes$'
    ),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const skillDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`skills/${params.projectId}/items/${params.skillId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const skill = groups[1].exists ? groups[1].data() : null

        const projectName = (project && project.name) || 'Project'
        const skillName = (skill && ParsingTextHelper.getObjectNameWithoutMeta(skill.extendedName)) || 'Skill name...'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Skill details${titleSuffix}`
        data.description = `Alldone.app. Skill description: ${skillName}`
    }

    switch (urlConstant) {
        case URL_SKILL_DETAILS: {
            await skillDetails()
            break
        }
        case URL_SKILL_DETAILS_FEED: {
            await skillDetails(' - Updates')
            break
        }
        case URL_SKILL_DETAILS_PROPERTIES: {
            await skillDetails(' - Properties')
            break
        }
        case URL_SKILL_DETAILS_NOTE: {
            await skillDetails(' - Note')
            break
        }
        case URL_SKILL_DETAILS_CHAT: {
            await skillDetails(' - Chat')
            break
        }
        case URL_SKILL_DETAILS_BACKLINKS_TASKS: {
            await skillDetails(' - Linked tasks')
            break
        }
        case URL_SKILL_DETAILS_BACKLINKS_NOTES: {
            await skillDetails(' - Linked notes')
            break
        }
    }

    return data
}

module.exports = {
    URL_SKILL_DETAILS,
    URL_SKILL_DETAILS_PROPERTIES,
    URL_SKILL_DETAILS_CHAT,
    URL_SKILL_DETAILS_NOTE,
    URL_SKILL_DETAILS_BACKLINKS_TASKS,
    URL_SKILL_DETAILS_BACKLINKS_NOTES,
    URL_SKILL_DETAILS_FEED,
    regexList,
    getMetadata,
}
