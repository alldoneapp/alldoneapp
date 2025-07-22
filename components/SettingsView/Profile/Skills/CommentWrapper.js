import React, { useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn, popoverToTop } from '../../../../utils/HelperFunctions'
import RichCommentModal from '../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { translate } from '../../../../i18n/TranslationService'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../../../ModalsManager/modalsManager'
import { colors } from '../../../styles/global'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'

export default function CommentWrapper({
    updateCurrentChanges,
    projectId,
    skillId,
    disabled,
    inEditModal,
    userGettingKarmaId,
    skillName,
    assistantId,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])
    const isBotOptionModalOpen = useSelector(state => state.openModals[BOT_OPTION_MODAL_ID])
    const isRunOutOfGoldModalOpen = useSelector(state => state.openModals[RUN_OUT_OF_GOLD_MODAL_ID])
    const isBotWarningModalOpen = useSelector(state => state.openModals[BOT_WARNING_MODAL_ID])

    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !isMentionModalOpen &&
            !isBotOptionModalOpen &&
            !isRunOutOfGoldModalOpen &&
            !isBotWarningModalOpen
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
            !isMentionModalOpen &&
            !isBotOptionModalOpen &&
            !isRunOutOfGoldModalOpen &&
            !isBotWarningModalOpen &&
            comment.trim()
        ) {
            if (!assistantEnabled) {
                setTimeout(() => {
                    updateCurrentChanges()
                })
            }
            createObjectMessage(projectId, skillId, comment, 'skills', null, null, null)
        }
    }

    return (
        <View>
            <Popover
                content={
                    <RichCommentModal
                        projectId={projectId}
                        objectType={'skills'}
                        objectId={skillId}
                        closeModal={closeModal}
                        processDone={addComment}
                        userGettingKarmaId={userGettingKarmaId}
                        showBotButton={true}
                        objectName={skillName}
                        externalAssistantId={assistantId}
                    />
                }
                onClickOutside={closeModal}
                isOpen={showModal}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
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
                        title={smallScreen || inEditModal ? null : translate('Comment')}
                        type={'ghost'}
                        noBorder={smallScreen || inEditModal}
                        icon={'message-circle'}
                        iconColor={inEditModal ? colors.Text04 : undefined}
                        buttonStyle={{ marginHorizontal: smallScreen || inEditModal ? 4 : 2 }}
                        onPress={openModal}
                        shortcutText={'C'}
                        disabled={disabled}
                        forceShowShortcut={true}
                    />
                </Hotkeys>
            </Popover>
        </View>
    )
}
