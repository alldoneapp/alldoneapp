import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'

import EditorsModal from './EditorsModal'
import EditorAvatar from './EditorAvatar'
import { useSelector } from 'react-redux'
import { colors } from '../../../../styles/global'

export default function EditorAvatarWrapper({ editors, avatarUrl, avatarColor, markAssignee = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
    }

    const closeModal = () => {
        setShowModal(false)
    }

    return (
        <Popover
            content={
                <View>
                    <EditorsModal closeModal={closeModal} editors={editors} markAssignee={markAssignee} />
                </View>
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'top', 'right', 'left']}
            padding={4}
            align={'start'}
        >
            <EditorAvatar avatarUrl={avatarUrl} avatarColor={avatarColor} openModal={openModal} />

            {mobile && editors.length > 1 && (
                <View style={localStyles.badge}>
                    <Text style={localStyles.badgeText}>{`+${editors.length - 1}`}</Text>
                </View>
            )}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    modalWrapper: {
        paddingHorizontal: 20,
        paddingBottom: 35,
        paddingTop: 10,
    },
    badge: {
        paddingVertical: 1,
        paddingHorizontal: 4,
        backgroundColor: colors.Primary100,
        borderRadius: 50,
        maxHeight: 12,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
    badgeText: {
        fontFamily: 'Roboto-Medium',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
        color: '#ffffff',
    },
})
