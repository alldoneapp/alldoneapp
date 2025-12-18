import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from './Button'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import { setSelectedNavItem } from '../../redux/actions'
import { DV_TAB_TASK_NOTE } from '../../utils/TabNavigationConstants'

export default function TranscribeButton({ task, projectId, disabled, style, shortcutText, onDismissPopup }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const buttonRef = React.useRef(null)

    const openTaskNoteTab = () => {
        if (disabled) return

        // Dismiss the edit mode popup if provided
        if (onDismissPopup) onDismissPopup()

        // Navigate to TaskDetailedView and select the Notes tab
        NavigationService.navigate('TaskDetailedView', {
            task: task,
            projectId: projectId,
        })
        dispatch(setSelectedNavItem(DV_TAB_TASK_NOTE))
    }

    return (
        <Hotkeys
            keyName={`alt+${shortcutText}`}
            disabled={disabled}
            onKeyDown={(sht, event) => execShortcutFn(buttonRef.current, openTaskNoteTab, event)}
            filter={e => true}
        >
            <Button
                ref={buttonRef}
                title={smallScreen ? null : translate('Transcribe')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={'microphone'}
                buttonStyle={style}
                onPress={openTaskNoteTab}
                disabled={disabled}
                shortcutText={shortcutText}
            />
        </Hotkeys>
    )
}
