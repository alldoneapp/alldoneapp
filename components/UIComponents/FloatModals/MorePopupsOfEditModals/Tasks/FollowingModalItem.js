import React from 'react'
import ModalItem from '../Common/ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import { FOLLOWER_TASKS_TYPE } from '../../../../Followers/FollowerConstants'
import useFollowingDataListener from '../Common/useFollowingDataListener'

export default function FollowingModalItem({ shortcut, projectId, task, closeModal }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useFollowingDataListener(projectId, FOLLOWER_TASKS_TYPE, task.id)

    const followData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: loggedUser,
    }

    const followObject = () => {
        Backend.addFollower(projectId, followData)
        closeModal?.()
    }

    const unfollowObject = () => {
        Backend.removeFollower(projectId, followData)
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
