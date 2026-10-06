// Isolate backend, navigation, mention suggestions and capture hardware. The rich input,
// Quill, attachment insertion, button, selector and responsive popup shell remain real.
export const translate = key => key
export const getDeviceLanguage = () => 'en'
export const checkIsLimitedByTraffic = () => false
export const applyPopoverWidth = () => ({ width: Math.min(window.innerWidth - 32, 305) })
export const execShortcutFn = (ref, action, event) => {
    event.preventDefault()
    action()
}
export const GLOBAL_PROJECT_ID = 'global-project'
export const ALL_PROJECTS_INDEX = -1
export const isGlobalAssistant = () => false
export const formatUrl = text => text
export const getDvMainTabLink = () => ''
export const getUrlObject = () => null
export const isValidContactLink = () => false
export const isValidGoalLink = () => false
export const isValidSkillLink = () => false
export const isValidNoteLink = () => false
export const isValidProjectLink = () => false
export const isValidTaskLink = () => false
export const isValidAssistantLink = () => false
export const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
export const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
export const VIDEO_TRIGGER = 'VIDEO_TRIGGER'
export const KARMA_TRIGGER = 'KARMA_TRIGGER'
export const MENTION_SPACE_CODE = 'MENTION_SPACE_CODE'
export const MILESTONE_TAG_TRIGGER = 'MILESTONE_TAG_TRIGGER'
export const REGEX_ATTACHMENT = /(?:)/
export const REGEX_EMAIL = /(?:)/
export const REGEX_GENERIC = /(?:)/
export const REGEX_HASHTAG = /(?:)/
export const REGEX_IMAGE = /(?:)/
export const REGEX_KARMA = /(?:)/
export const REGEX_MENTION = /(?:)/
export const REGEX_MILESTONE_TAG = /(?:)/
export const REGEX_URL = /(?:)/
export const REGEX_VIDEO = /(?:)/
export const tryToextractPeopleForMention = () => []
const Fake = () => null
Fake.getProjectIndexById = () => 0
export default Fake
