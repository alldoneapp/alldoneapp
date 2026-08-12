import React from 'react'
import ModalItem from '../Common/ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import { FOLLOWER_NOTES_TYPE } from '../../../../Followers/FollowerConstants'
import useFollowingDataListener from '../Common/useFollowingDataListener'

export default function FollowingModalItem({ shortcut, projectId, note, closeModal }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useFollowingDataListener(projectId, FOLLOWER_NOTES_TYPE, note.id)

    const followData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: note.id,
        followObject: note,
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
