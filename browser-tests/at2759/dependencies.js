// Account and search-independent fixtures. The grouped lists, project headers,
// goal progress, rows and selection callbacks render their real implementations.
export default {
    getPeopleById: () => null,
    getContactPhotoURL: () => '',
    getUserRoleInProject: () => '',
    getUserCompanyInProject: () => '',
    getUserDescriptionInProject: () => '',
}
export const MENTION_MODAL_TASKS_TAB = 0
export const MENTION_MODAL_GOALS_TAB = 1
export const MENTION_MODAL_NOTES_TAB = 2
export const MENTION_MODAL_CONTACTS_TAB = 3
export const MENTION_MODAL_TOPICS_TAB = 4
export const PHOTO_SIZE_50 = 50
export const getAssistant = () => null
export const isWorkstream = () => false
export const DYNAMIC_PERCENT = 'dynamic'
export const progressMap = {
    50: { progressBorderColorInMentionModal: '#7c66ff', progressTextColorInMentionModal: '#7c66ff' },
}
