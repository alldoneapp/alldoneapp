import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import AppPopover from '../UIComponents/ModalShell/AppPopover'

import FollowersModal from './FollowersModal'
import UsersPlusButton from './UsersPlusButton'
import { MAX_USERS_TO_SHOW } from '../Followers/FollowerConstants'

export default function PlusButtonWrapper({ followers, markAssignee = false, followObjectsType }) {
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
    }

    const closeModal = () => {
        setShowModal(false)
    }

    return (
        <AppPopover
            content={
                <View>
                    <FollowersModal
                        closeModal={closeModal}
                        followers={followers}
                        markAssignee={markAssignee}
                        followObjectsType={followObjectsType}
                    />
                </View>
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'top', 'right', 'left']}
            padding={4}
            align={'start'}
        >
            <UsersPlusButton usersAmount={followers.length} openModal={openModal} maxUsersToShow={MAX_USERS_TO_SHOW} />
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    modalWrapper: {
        paddingHorizontal: 20,
        paddingBottom: 35,
        paddingTop: 10,
    },
})
