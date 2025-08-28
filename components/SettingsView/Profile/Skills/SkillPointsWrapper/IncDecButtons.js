import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { updateNewAttachmentsData } from '../../../../Feeds/Utils/HelperFunctions'
import Button from '../../../../UIControls/Button'
import { MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import { createObjectMessage } from '../../../../../utils/backends/Chats/chatsComments'

export default function IncDecButtons({ projectId, skillId, points, changeSkillPoints, initialComment }) {
    const availableSkillPoints = useSelector(state => state.loggedUser.skillPoints)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])

    const increasePoints = () => {
        updateChanges(1)
    }

    const decreasePoints = () => {
        updateChanges(-1)
    }

    const updateChanges = pointsToAdd => {
        if (!isQuillTagEditorOpen && !isMentionModalOpen) {
            if (initialComment.trim()) {
                updateNewAttachmentsData(projectId, initialComment).then(commentWithAttachments => {
                    createObjectMessage(projectId, skillId, commentWithAttachments, 'skills', null, null, null)
                })
            }
            changeSkillPoints(pointsToAdd)
        }
    }

    return (
        <View style={localStyles.buttonContainer}>
            <Button
                icon="arrow-down"
                title={translate('Decrease')}
                type={'secondary'}
                onPress={decreasePoints}
                buttonStyle={{ marginRight: 8 }}
                disabled={points <= 0}
            />
            <Button
                icon="arrow-up"
                title={translate('Increase')}
                type={'primary'}
                onPress={increasePoints}
                disabled={availableSkillPoints < 1}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
