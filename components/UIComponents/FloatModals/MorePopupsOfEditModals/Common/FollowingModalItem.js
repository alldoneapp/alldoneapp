import React from 'react'
import { useSelector } from 'react-redux'

import ModalItem from './ModalItem'
import Backend from '../../../../../utils/BackendBridge'
import useFollowingDataListener from './useFollowingDataListener'

// The Following / Not following row of every entity's "More" menu (tasks,
// goals, notes, contacts, skills — formerly five near-identical copies).
// Entity knowledge stays at the call site, which passes the resolved follower
// type and id (contacts pass `uid` and switch type on membership).
export default function FollowingModalItem({
    shortcut,
    projectId,
    followObjectsType,
    followObjectId,
    followObject,
    closeModal,
    onChangeFollowState,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active] = useFollowingDataListener(projectId, followObjectsType, followObjectId)

    const followData = {
        followObjectsType,
        followObjectId,
        followObject,
        feedCreator: loggedUser,
    }

    const toggleFollowState = () => {
        if (active) Backend.removeFollower(projectId, followData)
        else Backend.addFollower(projectId, followData)
        closeModal?.()
        onChangeFollowState?.()
    }

    return (
        <ModalItem
            icon={active ? 'eye' : 'eye-off'}
            text={active ? 'Following' : 'Not following'}
            shortcut={shortcut}
            onPress={toggleFollowState}
        />
    )
}
