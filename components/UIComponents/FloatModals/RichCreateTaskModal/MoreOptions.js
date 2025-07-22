import React from 'react'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../../../utils/HelperFunctions'

export default function MoreOptions({ showMoreOptions, disabled }) {
    return (
        <Hotkeys
            keyName={'alt+m'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.estimationRef, showMoreOptions, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.estimationRef = ref)}
                icon={`more-vertical`}
                iconColor={colors.Text04}
                buttonStyle={{ backgroundColor: colors.Secondary200 }}
                onPress={showMoreOptions}
                disabled={disabled}
                shortcutText={'M'}
                forceShowShortcut={true}
            />
        </Hotkeys>
    )
}
