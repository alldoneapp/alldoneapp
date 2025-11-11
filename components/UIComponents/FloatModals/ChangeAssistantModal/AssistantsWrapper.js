import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'

import AssistantButton from './AssistantButton'
import AssistantModal from './AssistantModal'
import { setTaskAssistant } from '../../../../utils/backends/Tasks/tasksFirestore'
import { setNoteAssistant } from '../../../../utils/backends/Notes/notesFirestore'
import { setContactAssistant } from '../../../../utils/backends/Contacts/contactsFirestore'
import { setUserAssistant } from '../../../../utils/backends/Users/usersFirestore'
import { setSkillAssistant } from '../../../../utils/backends/Skills/skillsFirestore'
import { setGoalAssistant } from '../../../../utils/backends/Goals/goalsFirestore'
import { updateChatAssistant } from '../../../../utils/backends/Chats/chatsFirestore'
import { setProjectAssistant } from '../../../../utils/backends/Projects/projectsFirestore'

export default function AssistantsWrapper({ disabled, projectId, currentAssistantId, objectId, objectType }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateAssistant = assistantId => {
        // assistantId can be null to clear the assistant (for "use default project assistant" option)
        if (objectType === 'tasks') {
            setTaskAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'chats') {
            updateChatAssistant(projectId, objectId, assistantId)
        } else if (objectType === 'notes') {
            setNoteAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'contacts') {
            setContactAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'users') {
            setUserAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'skills') {
            setSkillAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'goals') {
            setGoalAssistant(projectId, objectId, assistantId, !!currentAssistantId)
        } else if (objectType === 'projects') {
            // For projects, assistantId can be null/empty to use default project's assistant
            setProjectAssistant(projectId, assistantId || '', !!currentAssistantId)
        }
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <AssistantModal
                    closeModal={closeModal}
                    updateAssistant={updateAssistant}
                    projectId={projectId}
                    currentAssistantId={currentAssistantId}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <AssistantButton
                projectId={projectId}
                disabled={disabled}
                assistantId={currentAssistantId}
                onPress={openModal}
            />
        </Popover>
    )
}
