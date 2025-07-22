import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import { getAssistantInProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotButtonWhenAddChats({
    onPress,
    containerStyle,
    disabled,
    botIsActive,
    projectId,
    assistantId,
}) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)

    const { photoURL50, displayName } = getAssistantInProjectObject(projectId, assistantId)

    return (
        <Hotkeys
            keyName={'alt+B'}
            disabled={blockShortcuts || disabled}
            onKeyDown={(sht, event) => execShortcutFn(this.bobBtnRef, onPress, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.bobBtnRef = ref)}
                title={!smallScreen && displayName}
                type={'ghost'}
                noBorder={smallScreen}
                buttonStyle={containerStyle}
                onPress={onPress}
                shortcutText={'B'}
                customIcon={
                    <AssistantAvatar
                        photoURL={photoURL50}
                        assistantId={assistantId}
                        size={24}
                        containerStyle={{ opacity: botIsActive ? 1 : 0.5 }}
                    />
                }
                disabled={disabled}
            />
        </Hotkeys>
    )
}
