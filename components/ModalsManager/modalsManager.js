import store from '../../redux/store'
import { removeOpenModal, storeOpenModal } from '../../redux/actions'

let keyCounter = 0

const generateKey = () => {
    keyCounter++
    return `modal${keyCounter.toString()}`
}

export const ATTACHMENTS_SELECTOR_MODAL_ID = generateKey()
export const RECORD_VIDEO_MODAL_ID = generateKey()
export const RECORD_SCREEN_MODAL_ID = generateKey()

export const TASK_MORE_OPTIONS_MODAL_ID = generateKey()
export const TASK_PARENT_GOAL_MODAL_ID = generateKey()
export const MENTION_MODAL_ID = generateKey()
export const MANAGE_TASK_MODAL_ID = generateKey()
export const RICH_CREATE_TASK_MODAL_ID = generateKey()
export const RICH_CREATE_NOTE_MODAL_ID = generateKey()
export const DELETE_TASK_CONFIRMATION_MODAL_ID = generateKey()
export const ESTIMATIONS_MODAL_ID = generateKey()
export const ASSIGNEE_PICKER_MODAL_ID = generateKey()
export const WORKSTREAM_MEMBERS_MODAL_ID = generateKey()
export const DUE_DATE_MODAL_ID = generateKey()
export const COMMENT_MODAL_ID = generateKey()
export const PRIVACY_MODAL_ID = generateKey()
export const HIGHLIGHT_MODAL_ID = generateKey()
export const TASK_DESCRIPTION_MODAL_ID = generateKey()
export const TAGS_INTERACTION_MODAL_ID = generateKey()
export const TAGS_EDIT_OBJECT_MODAL_ID = generateKey()
export const FOLLOW_UP_DUE_DATE_MODAL_ID = generateKey()
export const FOLLOW_UP_CUSTOM_DUE_DATE_MODAL_ID = generateKey()
export const FOLLOW_UP_MODAL_ID = generateKey()
export const WORKFLOW_MODAL_ID = generateKey()
export const TASK_WORKFLOW_MODAL_ID = generateKey()
export const CONTACT_PICTURE_MODAL_ID = generateKey()
export const CONTACT_INFO_MODAL_ID = generateKey()
export const RECURRING_MODAL_ID = generateKey()
export const PROJECT_MODAL_ID = generateKey()
export const STICKY_MODAL_ID = generateKey()
export const GOAL_ASSIGNEES_MODAL_ID = generateKey()
export const GOAL_MILESTONE_MODAL_ID = generateKey()
export const GOAL_DATE_RANGE_MODAL_ID = generateKey()
export const GOAL_PROGRESS_MODAL_ID = generateKey()
export const MORE_BUTTON_EDITS_MODAL_ID = generateKey()
export const MORE_BUTTON_MAIN_VIEWS_MODAL_ID = generateKey()
export const TEXT_FIELD_MODAL_ID = generateKey()
export const GLOBAL_SEARCH_MODAL_ID = generateKey()
export const PROJECT_COLOR_MODAL_ID = generateKey()
export const CONNECT_CALENDAR_MODAL_ID = generateKey()
export const CONNECT_GMAIL_MODAL_ID = generateKey()
export const PROJECT_PRIVACY_MODAL_ID = generateKey()
export const PROJECT_STATUS_MODAL_ID = generateKey()
export const COPY_PROJECT_MODAL_ID = generateKey()
export const PROJECT_ESTIMATION_TYPE_MODAL_ID = generateKey()
export const SKILL_POINTS_MODAL_ID = generateKey()
export const SKILL_NOT_ENOUGH_MODAL_ID = generateKey()
export const SKILL_COMPLETION_MODAL_ID = generateKey()
export const BOT_OPTION_MODAL_ID = generateKey()
export const RUN_OUT_OF_GOLD_MODAL_ID = generateKey()
export const BOT_WARNING_MODAL_ID = generateKey()

export const storeModal = (modalId, params) => {
    store.dispatch(storeOpenModal(modalId, params))
}

export const removeModal = modalId => {
    store.dispatch(removeOpenModal(modalId))
}

export const exitsOpenModals = excludedModalsIds => {
    const { openModals } = store.getState()
    const modalsIds = Object.keys(openModals)
    if (excludedModalsIds && excludedModalsIds.length > 0) {
        let excludedOpensCount = 0
        for (let i = 0; i < excludedModalsIds.length; i++) {
            const modalId = excludedModalsIds[i]
            if (openModals[modalId]) {
                excludedOpensCount++
            }
        }
        return modalsIds.length - excludedOpensCount > 0
    } else {
        return modalsIds.length > 0
    }
}

export const getModalParams = modalId => {
    const { openModals } = store.getState()
    return openModals[modalId]
}

export const setModalParams = (modalId, params, merge) => {
    const { openModals } = store.getState()
    if (openModals[modalId]) {
        merge ? (openModals[modalId] = { ...openModals[modalId], ...params }) : (openModals[modalId] = params)
    }
}
