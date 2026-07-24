import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RichCreateGoalModal from '../UIComponents/FloatModals/RichCreateGoalModal/RichCreateGoalModal'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'

export default function AddGoalTag({ projectId, style }) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
        dispatch(showFloatPopup())
    }
    const closeModal = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setShowModal(false)
            dispatch(hideFloatPopup())
        }
    }

    return (
        <Popover
            content={<RichCreateGoalModal projectId={projectId} closeModal={closeModal} />}
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity
                style={[localStyles.tag, smallScreenNavigation && localStyles.tagMobile, style]}
                onPress={openModal}
            >
                <View style={localStyles.icon}>
                    <Icon name={'target'} size={16} color={colors.Text03} />
                </View>
                {!smallScreenNavigation && (
                    <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{translate('Add goal')}</Text>
                )}
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Text03,
        paddingHorizontal: 4,
    },
    tagMobile: {
        width: 24,
        height: 24,
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
})
