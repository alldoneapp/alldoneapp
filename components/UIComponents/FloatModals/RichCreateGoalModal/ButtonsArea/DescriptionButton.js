import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'

export default function DescriptionButton({ showDescription, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+d'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.descriptionRef, showDescription, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.descriptionRef = ref)}
                icon={'info'}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showDescription}
                disabled={disabled}
                shortcutText={'D'}
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
