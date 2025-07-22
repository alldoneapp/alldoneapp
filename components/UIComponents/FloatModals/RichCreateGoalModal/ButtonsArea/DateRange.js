import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'

export default function DateRange({ showDateRange, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+r'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.dateRangeRef, showDateRange, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.dateRangeRef = ref)}
                icon={'calendar'}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showDateRange}
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
