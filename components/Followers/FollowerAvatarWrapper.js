import React, { useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import Popover from 'react-tiny-popover'

import FollowersModal from './FollowersModal'
import Avatar from '../Avatar'

export default function FollowerAvatarWrapper({ followers, avatarUrl, markAssignee = false, followObjectsType }) {
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
            <TouchableOpacity onPress={openModal} accessible={false}>
                <Avatar reviewerPhotoURL={avatarUrl} borderSize={0} size={32} />
            </TouchableOpacity>
        </Popover>
    )
}
