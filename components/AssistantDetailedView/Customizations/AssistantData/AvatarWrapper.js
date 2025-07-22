import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, View, Image, TouchableOpacity } from 'react-native'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import ImagePickerModal from '../../../UIComponents/FloatModals/ImagePickerModal'
import { colors } from '../../../styles/global'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { updateAssistantAvatar } from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function AvatarWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { photoURL50 } = assistant

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const savePicture = pictureFile => {
        if (pictureFile) {
            updateAssistantAvatar(projectId, assistant, pictureFile)
        }
    }

    return (
        <Popover
            content={
                <ImagePickerModal
                    closePopover={closeModal}
                    onSavePicture={savePicture}
                    picture={photoURL50 ? photoURL50 : undefined}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <TouchableOpacity style={localStyles.photoContainer} onPress={openModal} disabled={disabled}>
                {photoURL50 ? (
                    <Image source={photoURL50} style={localStyles.image} />
                ) : (
                    <View style={localStyles.image}>
                        <SVGGenericUser width={51} height={51} svgid={assistant.uid} />
                    </View>
                )}
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    photoContainer: {
        width: 51,
        minWidth: 51,
        maxWidth: 51,
        height: 51,
    },
    image: {
        width: 51,
        height: 51,
        backgroundColor: colors.Text03,
        borderRadius: 100,
        overflow: 'hidden',
    },
})
