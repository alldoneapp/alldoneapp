import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import GhostButton from '../../../../UIControls/GhostButton'
import { translate } from '../../../../../i18n/TranslationService'
import { colors } from '../../../../styles/global'

export default function SkillPointButtonInEditionMode({ disabled, shortcutText, onPress, inEditModal }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    return (
        <Hotkeys
            keyName={`alt+${shortcutText}`}
            disabled={disabled || blockShortcuts}
            onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, onPress, event)}
            filter={e => true}
        >
            <GhostButton
                ref={ref => (this.buttonRef = ref)}
                title={smallScreen || inEditModal ? null : translate('Skillpoints')}
                type={'ghost'}
                noBorder={smallScreen || inEditModal}
                icon={'trending-up'}
                iconColor={inEditModal ? colors.Text04 : undefined}
                buttonStyle={{ marginHorizontal: smallScreen || inEditModal ? 4 : 2 }}
                onPress={onPress}
                disabled={disabled}
                shortcutText={shortcutText}
                forceShowShortcut={true}
            />
        </Hotkeys>
    )
}
