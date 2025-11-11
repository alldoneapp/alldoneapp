import React from 'react'
import { useSelector } from 'react-redux'

import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import {
    getAssistantInProjectObject,
    getDefaultAssistantInProjectById,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import Button from '../../../UIControls/Button'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'

export default function AssistantButton({ projectId, disabled, assistantId, onPress }) {
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)

    // If assistantId is empty/null and this is not the default project, show default project's assistant
    const isUsingDefaultProjectAssistant = !assistantId && projectId !== defaultProjectId && defaultProjectId

    let displayAssistant
    if (isUsingDefaultProjectAssistant) {
        displayAssistant = getDefaultAssistantInProjectById(defaultProjectId)
    } else {
        displayAssistant = getAssistantInProjectObject(projectId, assistantId)
    }

    const { photoURL50, displayName } = displayAssistant || {}

    return (
        <Button
            type={'ghost'}
            icon={<AssistantAvatar photoURL={photoURL50} size={24} assistantId={assistantId} />}
            title={shrinkTagText(displayName || 'No assistant', 30)}
            onPress={onPress}
            disabled={disabled}
        />
    )
}
