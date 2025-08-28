import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import { getEstimationIconByValue } from '../../../../utils/EstimationHelper'

export default function Estimation({ projectId, estimation, showEstimation, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+e'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.estimationRef, showEstimation, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.estimationRef = ref)}
                icon={`count-circle-${getEstimationIconByValue(projectId, estimation)}`}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showEstimation}
                disabled={disabled}
                shortcutText={'E'}
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
