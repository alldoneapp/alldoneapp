import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import Popover from 'react-tiny-popover'

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
        <Popover
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
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    modalWrapper: {
        paddingHorizontal: 20,
        paddingBottom: 35,
        paddingTop: 10,
    },
})
