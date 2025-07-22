import React from 'react'
import { View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'

export default function OpenDvButton({ showButtonSpace, disabled, onOpenDetailedView, buttonItemStyle, projectId }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)

    const anonymousGranted = SharedHelper.accessGranted(loggedUser, projectId, true)

    return (
        <View style={{ marginRight: isMiddleScreen || !showButtonSpace ? 4 : 32 }}>
            <Hotkeys
                keyName={'alt+o'}
                disabled={disabled || !anonymousGranted}
                onKeyDown={(sht, event) => execShortcutFn(this.openBtnRef, onOpenDetailedView, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.openBtnRef = ref)}
                    title={smallScreen ? null : translate('Open nav')}
                    type={'secondary'}
                    noBorder={smallScreen}
                    icon={'maximize-2'}
                    buttonStyle={buttonItemStyle}
                    onPress={() => onOpenDetailedView()}
                    disabled={disabled || !anonymousGranted}
                    shortcutText={'O'}
                />
            </Hotkeys>
        </View>
    )
}
