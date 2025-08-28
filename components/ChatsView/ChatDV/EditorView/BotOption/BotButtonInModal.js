import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import { colors } from '../../../../styles/global'
import AssistantAvatar from '../../../../AdminPanel/Assistants/AssistantAvatar'
import { getAssistantInProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'

export default function BotButtonInModal({ onPress, projectId, assistantId }) {
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const { photoURL50 } = getAssistantInProjectObject(projectId, assistantId)

    return (
        <Hotkeys
            keyName={'alt+B'}
            disabled={blockShortcuts}
            onKeyDown={(sht, event) => execShortcutFn(this.bobBtnRef, onPress, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.bobBtnRef = ref)}
                buttonStyle={{ backgroundColor: colors.Secondary200 }}
                onPress={onPress}
                shortcutText={'B'}
                forceShowShortcut={true}
                customIcon={
                    <AssistantAvatar
                        photoURL={photoURL50}
                        assistantId={assistantId}
                        size={24}
                        containerStyle={{ opacity: assistantEnabled ? 1 : 0.5 }}
                    />
                }
            />
        </Hotkeys>
    )
}
