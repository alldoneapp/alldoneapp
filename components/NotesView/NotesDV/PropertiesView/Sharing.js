import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors, em2px } from '../../../styles/global'
import GhostButton from '../../../UIControls/GhostButton'
import Popover from 'react-tiny-popover'
import SharingPopup, {
    getSharingOptionText,
    SHARE_ALL_SEE_MEMBER_EDIT,
} from '../../../UIComponents/FloatModals/SharingPopup'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { updateNoteShared } from '../../../../utils/backends/Notes/notesFirestore'

export default function Sharing({ projectId, note, disabled }) {
    const [open, setOpen] = useState(false)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()
    const currentOption = note?.shared ? note.shared : SHARE_ALL_SEE_MEMBER_EDIT
    const link = `${window.location.origin}/projects/${projectId}/notes/${note.id}/properties`

    const openModal = () => {
        setOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }

    const onSuccess = option => {
        updateNoteShared(projectId, note.id, option)
        closeModal()
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 11 }}>
                <Icon name={'share-2'} size={20} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>Share</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Popover
                    content={
                        <SharingPopup
                            closeModal={closeModal}
                            onSuccess={onSuccess}
                            currentOption={currentOption}
                            link={link}
                        />
                    }
                    onClickOutside={closeModal}
                    isOpen={open}
                    padding={4}
                    position={['top']}
                    align={'center'}
                    contentLocation={mobile ? null : undefined}
                >
                    <GhostButton
                        type={'ghost'}
                        icon={'settings'}
                        title={getSharingOptionText(currentOption)}
                        numberTitleLines={2}
                        titleStyle={localStyles.text}
                        onPress={openModal}
                        disabled={disabled}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 56,
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 12,
        lineHeight: 14,
        letterSpacing: em2px(0.03),
        color: '#4E5D78',
        maxWidth: 142,
    },
})
