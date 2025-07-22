import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../../../utils/HelperFunctions'

export default function ParentGoal({ parentGoalId, showParentGoal, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+g'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.goalRef, showParentGoal, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.goalRef = ref)}
                icon={'target'}
                iconColor={parentGoalId ? colors.Gray300 : colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showParentGoal}
                disabled={disabled}
                shortcutText={'G'}
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
