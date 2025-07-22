const { URL_NOT_MATCH } = require('./Helper')
const URLTasksPreview = require('./Tasks/URLTasksPreview')
const URLGoalsPreview = require('./Goals/URLGoalsPreview')
const URLSkillsPreview = require('./Skills/URLSkillsPreview')
const URLNotesPreview = require('./Notes/URLNotesPreview')
const URLContactsPreview = require('./Contacts/URLContactsPreview')
const URLProjectsPreview = require('./Projects/URLProjectsPreview')
const URLSettingsPreview = require('./Settings/URLSettingsPreview')
const URLChatsPreview = require('./Chats/URLChatsPreview')
const URLAssistantsPreview = require('./Assistants/URLAssistantsPreview')

const matchersList = [
    URLTasksPreview,
    URLGoalsPreview,
    URLNotesPreview,
    URLContactsPreview,
    URLProjectsPreview,
    URLSettingsPreview,
    URLChatsPreview,
    URLSkillsPreview,
    URLAssistantsPreview,
]

const processUrl = async (admin, pathname) => {
    for (let key in matchersList) {
        if (match(pathname, matchersList[key].regexList) !== URL_NOT_MATCH) {
            return preview(admin, pathname, matchersList[key].regexList, matchersList[key].getMetadata)
        }
    }

    return null
}

const match = (pathname, regexList) => {
    for (let key in regexList) {
        const matchObj = pathname.match(regexList[key])

        if (matchObj) {
            return { key: key, matches: matchObj }
        }
    }

    return URL_NOT_MATCH
}

const preview = async (admin, pathname, regexList, getMetadata) => {
    const matchedObj = match(pathname, regexList)
    const params = matchedObj.matches.groups
    return getMetadata(admin, matchedObj.key, params)
}

module.exports = { processUrl }
