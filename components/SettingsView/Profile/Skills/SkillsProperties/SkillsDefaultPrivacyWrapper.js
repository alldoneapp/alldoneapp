import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import PrivacyModal from '../../../../UIComponents/FloatModals/PrivacyModal/PrivacyModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import GhostButton from '../../../../UIControls/GhostButton'
import ButtonUsersGroup from '../../../../UIComponents/FloatModals/PrivacyModal/ButtonUsersGroup'
import { FEED_PUBLIC_FOR_ALL, DEFAULT_SKILL_PRIVACY_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../../../i18n/TranslationService'

export default function SkillsDefaultPrivacyWrapper({ projectId, style, savePrivacy }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isPublicForInProject = useSelector(state => state.skillsDefaultPrivacyByProject[projectId])
    const [visiblePopover, setVisiblePopover] = useState(false)

    const isPublicFor = isPublicForInProject ? isPublicForInProject : [FEED_PUBLIC_FOR_ALL]

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const delayHidePopover = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        setTimeout(async () => {
            hidePopover()
        }, 200)
    }

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const defaultPrivacyObject = {
        userId: loggedUserId,
        isPublicFor,
    }

    return (
        <Popover
            content={
                <PrivacyModal
                    object={defaultPrivacyObject}
                    objectType={DEFAULT_SKILL_PRIVACY_OBJECT_TYPE}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                    savePrivacyBeforeSaveObject={savePrivacy}
                />
            }
            onClickOutside={delayHidePopover}
            isOpen={visiblePopover}
            position={['left', 'right', 'top', 'bottom']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <Hotkeys
                keyName={`alt+D`}
                disabled={blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, showPopover, event)}
                filter={e => true}
            >
                <GhostButton
                    ref={ref => (this.buttonRef = ref)}
                    title={isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? translate('Public') : translate('Private')}
                    type={'ghost'}
                    icon={
                        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? (
                            'unlock'
                        ) : (
                            <ButtonUsersGroup projectId={projectId} users={isPublicFor} />
                        )
                    }
                    buttonStyle={style}
                    onPress={showPopover}
                    shortcutText={'D'}
                    accessible={false}
                />
            </Hotkeys>
        </Popover>
    )
}
