import React from 'react'
import ModalItem from '../Common/ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import { FOLLOWER_GOALS_TYPE } from '../../../../Followers/FollowerConstants'
import useFollowingDataListener from '../Common/useFollowingDataListener'

export default function FollowingModalItem({ shortcut, projectId, goal, closeModal, onChangeFollowState }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useFollowingDataListener(projectId, FOLLOWER_GOALS_TYPE, goal.id)

    const followData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
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
