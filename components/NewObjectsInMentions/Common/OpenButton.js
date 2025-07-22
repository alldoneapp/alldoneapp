import React from 'react'
import Button from '../../UIControls/Button'
import { colors } from '../../styles/global'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'

export default function OpenButton({ onPress, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+o'}
            disabled={disabled}
            onKeyDown={(sht, event) => execShortcutFn(this.openDVBtnRef, onPress, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.openDVBtnRef = ref)}
                icon={'maximize-2'}
                iconColor={colors.Text04}
                buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 8 }}
                onPress={onPress}
                disabled={disabled}
                shortcutText={'O'}
                forceShowShortcut={true}
            />
        </Hotkeys>
    )
}
