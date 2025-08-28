import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import Circle from '../../HighlightColorModal/Circle'

export default function HighlightButton({ showHighlight, disabled, hasStar }) {
    return (
        <Hotkeys
            keyName={'alt+h'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.highlightBtnRef, showHighlight, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.highlightBtnRef = ref)}
                icon={<Circle color={hasStar} inButton={true} icoForcedColor={colors.Text04} />}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showHighlight}
                disabled={disabled}
                shortcutText={'H'}
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
