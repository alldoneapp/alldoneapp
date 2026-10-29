export * from '../at2699/dependencies'
export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000
export const MENTION_MODAL_MIN_HEIGHT = 80
export const MENTION_MODAL_ID = 'mention'
export const COMMENT_MODAL_ID = 'comment'
export const FOLLOW_UP_MODAL_ID = 'follow-up'
export const MANAGE_TASK_MODAL_ID = 'manage-task'
export const TAGS_INTERACTION_MODAL_ID = 'tags'
export const TASK_DESCRIPTION_MODAL_ID = 'description'
export const WORKFLOW_MODAL_ID = 'workflow'
export const exitsOpenModals = () => false
export const popoverToCenter = () => ({ top: 16, left: 16 })
export const loadQuill = () => {}
export const getDvMainTabLink = (projectId, id, type) => `/projects/${projectId}/${type}/${id}/editor`
export const formatUrl = text => text
export const getUrlObject = url => ({ url, type: 'plain' })
const Fake = () => null
Fake.getProjectIndexById = () => 0
Fake.getPeopleTypeUsingId = () => 'contacts'
export default Fake
