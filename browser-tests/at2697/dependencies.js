import React from 'react'

const avatar = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="tan"/></svg>'
)}`

export const getDateFormat = () => 'DD.MM.YYYY'
export const exportRef = {}
export const quillTextInputRefs = {}
export const getQuillEditorRef = () => ({ editorRef: null })
export const MANAGE_TASK_MODAL_ID = 'manage-task'
export const storeModal = () => {}
export const exitsOpenModals = () => false
export const popoverToCenter = () => ({ top: 100, left: 20 })
export const setTaskDueDate = () => {}
export const setTaskDescription = () => {}
export const handleNestedLinks = text => text
export const getAssistant = () => null
export const getEstimationRealValue = () => 0
export const OPEN_STEP = 'open'
export const RECURRENCE_NEVER = 'never'
export const TASK_ASSIGNEE_ASSISTANT_TYPE = 'assistant'

// Popup contents are a stub; its trigger, state and desktop/mobile shell are real.
function Dependency({ closeModal, closePopover }) {
    if (closePopover) return <button onClick={closePopover}>Close date fixture</button>
    return closeModal ? <button onClick={() => closeModal('close')}>Close task fixture</button> : null
}
Object.assign(Dependency, {
    accessGranted: () => true,
    getTaskData: () => Promise.resolve(null),
    watchSubtasks: () => {},
    unwatch: () => {},
    getUserInProject: () => ({ photoURL: avatar }),
    getContactInProject: () => null,
    checkIfLoggedUserIsNormalUserInGuide: () => false,
})
export default Dependency
