import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { copyTextToClipboard } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'

export default function GoalCopyLinkButton({ closeModal, projectId, goalId, disabled }) {
    const smallScreen = useSelector(state => state.smallScreen)

    const copyLink = () => {
        const link = `${window.location.origin}${getDvMainTabLink(projectId, goalId, 'goals')}`
        copyTextToClipboard(link)
        closeModal()
    }

    return (
        <Hotkeys
            keyName={'alt+L'}
            onKeyDown={(sht, event) => execShortcutFn(this.copyLinkBtnRef, copyLink, event)}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.copyLinkBtnRef = ref)}
                title={smallScreen ? null : translate('Copy link')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={'link'}
                buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                onPress={copyLink}
                shortcutText={'L'}
                disabled={disabled}
            />
        </Hotkeys>
    )
}
