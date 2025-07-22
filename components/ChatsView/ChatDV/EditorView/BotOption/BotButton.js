import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import { getAssistantInProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotButton({ onPress, projectId, assistantId }) {
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
                type={'ghost'}
                noBorder={true}
                buttonStyle={{ marginRight: 4 }}
                onPress={onPress}
                shortcutText={'B'}
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
