import React, { useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import RichCommentModal from '../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import {} from '../../../utils/backends/firestore'
import { translate } from '../../../i18n/TranslationService'
import { popoverToTop } from '../../../utils/HelperFunctions'
import { createObjectMessage } from '../../../utils/backends/Chats/chatsComments'

export default function CreateCommentWrapper({
    updateCurrentChanges,
    projectId,
    extendedName,
    goalId,
    disabled,
    assistantId,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            setTimeout(() => {
                setShowModal(false)
                dispatch(hideFloatPopup())
            })
        }
    }

    const addComment = comment => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID] &&
            comment.trim()
        ) {
            if (!assistantEnabled) {
                setTimeout(() => {
                    updateCurrentChanges()
                })
            }
            createObjectMessage(projectId, goalId, comment, 'goals', null, null, null)
        }
    }

    return (
        <View>
            <Popover
                content={
                    <RichCommentModal
                        projectId={projectId}
                        objectType={'goals'}
                        objectId={goalId}
                        closeModal={closeModal}
                        processDone={addComment}
                        userGettingKarmaId=""
                        showBotButton={true}
                        objectName={extendedName}
                        externalAssistantId={assistantId}
                    />
                }
                onClickOutside={closeModal}
                isOpen={showModal}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'start'}
                disableReposition={true}
                contentLocation={popoverToTop}
            >
                <Hotkeys
                    keyName={'alt+C'}
                    onKeyDown={(sht, event) => execShortcutFn(this.commentBtnRef, openModal, event)}
                    filter={e => true}
                    disabled={disabled}
                >
                    <Button
                        ref={ref => (this.commentBtnRef = ref)}
                        title={smallScreen ? null : translate('Comment')}
                        type={'ghost'}
                        noBorder={smallScreen}
                        icon={'message-circle'}
                        buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                        onPress={openModal}
                        shortcutText={'C'}
                        disabled={disabled}
                    />
                </Hotkeys>
            </Popover>
        </View>
    )
}
