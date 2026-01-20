import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../../../utils/HelperFunctions'

export default function Recurring({ showRecurring, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+r'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.recurringRef, showRecurring, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.recurringRef = ref)}
                icon={'rotate-cw'}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showRecurring}
                disabled={disabled}
                shortcutText={'R'}
                forceShowShortcut={true}
            />
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    buttonsStyle: {
        backgroundColor: colors.Secondary200,
        marginRight: 4,
    },
})
