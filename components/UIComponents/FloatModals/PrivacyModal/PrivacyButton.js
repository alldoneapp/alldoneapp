import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import PrivacyModal from './PrivacyModal'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import GhostButton from '../../../UIControls/GhostButton'
import ButtonUsersGroup from './ButtonUsersGroup'
import { FEED_PUBLIC_FOR_ALL, FEED_USER_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PrivacyButton({
    projectId,
    object,
    disabled,
    style,
    objectType,
    savePrivacyBeforeSaveObject,
    shortcutText,
    inEditComponent,
    callback,
    onDismissPopup,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
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

    if (objectType === FEED_USER_OBJECT_TYPE) {
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        ContactsHelper.getAndAssignUserPrivacy(projectIndex, object)
    }

    const { isPublicFor } = object

    return (
        <Popover
            content={
                <PrivacyModal
                    object={object}
                    objectType={objectType}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                    savePrivacyBeforeSaveObject={savePrivacyBeforeSaveObject}
                    callback={callback}
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
                keyName={`alt+${shortcutText}`}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, showPopover, event)}
                filter={e => true}
            >
                <GhostButton
                    ref={ref => (this.buttonRef = ref)}
                    title={
                        inEditComponent && smallScreen
                            ? null
                            : isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                            ? translate('Public')
                            : translate('Private')
                    }
                    type={'ghost'}
                    noBorder={inEditComponent && smallScreen}
                    icon={
                        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? (
                            'unlock'
                        ) : (
                            <ButtonUsersGroup projectId={projectId} users={isPublicFor} />
                        )
                    }
                    buttonStyle={style}
                    onPress={showPopover}
                    disabled={disabled}
                    shortcutText={shortcutText}
                    accessible={false}
                />
            </Hotkeys>
        </Popover>
    )
}
