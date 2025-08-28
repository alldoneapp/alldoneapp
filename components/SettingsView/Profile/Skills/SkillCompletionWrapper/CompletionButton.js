import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import ProgressIcon from '../../../../GoalsView/EditGoalsComponents/ProgressIcon'
import { execShortcutFn } from '../../../../UIComponents/ShortcutCheatSheet/HelperFunctions'

export default function CompletionButton({ completion, onPress, disabled }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const buttonCustomIcon = <ProgressIcon progress={completion} />

    return (
        <Hotkeys
            keyName={'alt+C'}
            disabled={disabled || blockShortcuts}
            onKeyDown={(sht, event) => execShortcutFn(this.completionBtnRef, onPress, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.completionBtnRef = ref)}
                title={'Completion'}
                type={'ghost'}
                buttonStyle={{ marginHorizontal: 0 }}
                onPress={onPress}
                disabled={disabled}
                customIcon={buttonCustomIcon}
                shortcutText={'C'}
            />
        </Hotkeys>
    )
}
