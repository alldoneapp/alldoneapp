import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors, em2px } from '../../styles/global'
import GhostButton from '../../UIControls/GhostButton'
import Popover from 'react-tiny-popover'
import SharingPopup, {
    getSharingOptionText,
    SHARE_ALL_SEE_MEMBER_EDIT,
} from '../../UIComponents/FloatModals/SharingPopup'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'
import { setTaskShared } from '../../../utils/backends/Tasks/tasksFirestore'

/**
 * DEPRECATED at 07/05/2021
 * Remove after 2 Months [07/07/2021]
 *
 * @param projectId
 * @param task
 * @param disabled
 * @returns {JSX.Element}
 * @constructor
 */
export default function Sharing({ projectId, task, disabled }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)
    const dispatch = useDispatch()
    const currentOption = task?.shared ? task.shared : SHARE_ALL_SEE_MEMBER_EDIT
    const link = `${window.location.origin}${getDvMainTabLink(projectId, task.id, 'tasks')}`

    const openModal = () => {
        setOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }

    const onSuccess = option => {
        setTaskShared(projectId, task.id, option)
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
