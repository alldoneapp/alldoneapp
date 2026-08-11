import React from 'react'
import { useSelector } from 'react-redux'

import ModalItem from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import { FOLLOWER_SKILLS_TYPE } from '../../../../Followers/FollowerConstants'
import useFollowingDataListener from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/useFollowingDataListener'

export default function FollowingModalItem({ shortcut, projectId, skill, closeModal, onChangeFollowState }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useFollowingDataListener(projectId, FOLLOWER_SKILLS_TYPE, skill.id)

    const followData = {
        followObjectsType: FOLLOWER_SKILLS_TYPE,
        followObjectId: skill.id,
        followObject: skill,
        feedCreator: loggedUser,
    }

    const followObject = () => {
        Backend.addFollower(projectId, followData)
        onChangeFollowState?.()
        closeModal?.()
    }

    const unfollowObject = () => {
        Backend.removeFollower(projectId, followData)
        onChangeFollowState?.()
        closeModal?.()
    }

    return (
        <ModalItem
            icon={active ? 'eye' : 'eye-off'}
            text={active ? 'Following' : 'Not following'}
            shortcut={shortcut}
            onPress={active ? unfollowObject : followObject}
        />
    )
}
