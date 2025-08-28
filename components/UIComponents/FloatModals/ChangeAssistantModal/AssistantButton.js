import React from 'react'

import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { getAssistantInProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import Button from '../../../UIControls/Button'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'

export default function AssistantButton({ projectId, disabled, assistantId, onPress }) {
    const { photoURL50, displayName } = getAssistantInProjectObject(projectId, assistantId)

    return (
        <Button
            type={'ghost'}
            icon={<AssistantAvatar photoURL={photoURL50} size={24} assistantId={assistantId} />}
            title={shrinkTagText(displayName, 30)}
            onPress={onPress}
            disabled={disabled}
        />
    )
}
