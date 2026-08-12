import React from 'react'
import ModalItem from '../Common/ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import { FOLLOWER_CONTACTS_TYPE, FOLLOWER_USERS_TYPE } from '../../../../Followers/FollowerConstants'
import useFollowingDataListener from '../Common/useFollowingDataListener'

export default function FollowingModalItem({ shortcut, projectId, contact, isMember, closeModal }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const followType = isMember ? FOLLOWER_USERS_TYPE : FOLLOWER_CONTACTS_TYPE
    const [active, setActive] = useFollowingDataListener(projectId, followType, contact.uid)

    const followData = {
        followObjectsType: followType,
        followObjectId: contact.uid,
        followObject: contact,
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
