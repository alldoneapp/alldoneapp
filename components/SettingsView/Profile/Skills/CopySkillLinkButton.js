import React from 'react'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { copyTextToClipboard, execShortcutFn } from '../../../../utils/HelperFunctions'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'

export default function CopySkillLink({ projectId, skillId, onCancelAction }) {
    const smallScreen = useSelector(state => state.smallScreen)

    const copyLink = () => {
        const link = `${window.location.origin}${getDvMainTabLink(projectId, skillId, 'skills')}`
        copyTextToClipboard(link)
        onCancelAction()
    }

    return (
        <Hotkeys
            keyName={'alt+L'}
            onKeyDown={(sht, event) => execShortcutFn(this.copyLinkBtnRef, copyLink, event)}
            filter={e => true}
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
            />
        </Hotkeys>
    )
}
