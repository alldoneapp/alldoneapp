import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../../../utils/HelperFunctions'

export default function Privacy({ isPrivate, showPrivacy, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+p'}
            onKeyDown={(sht, event) => execShortcutFn(this.privacyRef, showPrivacy, event)}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.privacyRef = ref)}
                icon={isPrivate ? 'lock' : 'unlock'}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showPrivacy}
                disabled={disabled}
                shortcutText={'P'}
                forceShowShortcut={true}
                accessible={false}
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
