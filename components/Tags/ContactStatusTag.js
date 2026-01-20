import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import styles, { colors, windowTagStyle } from '../styles/global'
import { hideFloatPopup, setContactStatusFilter, showFloatPopup } from '../../redux/actions'
import ContactStatusModal from '../UIComponents/FloatModals/ChangeContactStatusModal/ContactStatusModal'
import { setProjectContactStatus } from '../../utils/backends/Contacts/contactsFirestore'

const ContactStatusTag = ({ projectId, contactStatusId, contact, style }) => {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectsMap = useSelector(state => state.loggedUserProjectsMap)
    const contactStatusFilter = useSelector(state => state.contactStatusFilter)
    const project = projectsMap[projectId]
    const [isOpen, setIsOpen] = useState(false)

    const status = contactStatusId && project?.contactStatuses ? project.contactStatuses[contactStatusId] : null

    if (!status) {
        return null
    }

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateStatus = statusId => {
        setProjectContactStatus(projectId, contact, contact.uid, statusId)
        // Also update the filter to show the new status
        if (statusId) {
            dispatch(setContactStatusFilter(statusId))
        }
    }

    const onPress = e => {
        e.stopPropagation()
        // If the filter is already set to this status and we have contact data, open modal to change status
        if (contactStatusFilter === contactStatusId && contact) {
            openModal()
        } else {
            dispatch(setContactStatusFilter(contactStatusId))
        }
    }

    const tagContent = (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <View style={[localStyles.container, style]}>
                <View style={[localStyles.colorDot, { backgroundColor: status.color }]} />
                {!mobile && <Text style={[localStyles.text, windowTagStyle()]}>{status.name}</Text>}
            </View>
        </TouchableOpacity>
    )

    // Only wrap with Popover if we have contact data for editing
    if (!contact) {
        return tagContent
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <ContactStatusModal
                    closeModal={closeModal}
                    updateStatus={updateStatus}
                    projectId={projectId}
                    currentStatusId={contactStatusId}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            {tagContent}
        </Popover>
    )
}

export default ContactStatusTag

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Grey300,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 4,
    },
    colorDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 8,
        marginLeft: 6,
    },
})
