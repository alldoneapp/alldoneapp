import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import Switch from '../UIControls/Switch'
import FollowersGroup from './FollowersGroup'
import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { FOLLOWER_TASKS_TYPE } from './FollowerConstants'
import { translate } from '../../i18n/TranslationService'

export default function FollowObject({ projectId, followObjectsType, followObjectId, loggedUserId, object, disabled }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])

    const [active, setActive] = useState(false)
    const [followersIds, setFollowersIds] = useState([])
    const [users, setUsers] = useState({})

    const updateFollowers = followersIds => {
        if (followersIds.includes(loggedUserId)) {
            setActive(true)
        } else {
            setActive(false)
        }
        setFollowersIds(followersIds)
    }

    const followObject = () => {
        const followData = {
            followObjectsType: followObjectsType,
            followObjectId: followObjectId,
            followObject: object,
            feedCreator: store.getState().loggedUser,
        }
        Backend.addFollower(projectId, followData)
    }

    const unfollowObject = () => {
        const followData = {
            followObjectsType: followObjectsType,
            followObjectId: followObjectId,
            followObject: object,
            feedCreator: store.getState().loggedUser,
        }
        Backend.removeFollower(projectId, followData)
    }

    useEffect(() => {
        const users = {}
        usersInProject.forEach(user => {
            users[user.uid] = user
        })
        setUsers(users)
    }, [usersInProject])

    useEffect(() => {
        const watchId = Backend.getId()
        Backend.watchFollowers(projectId, followObjectsType, followObjectId, updateFollowers, watchId)
        return () => Backend.unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId)
    }, [projectId])

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="eye" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Following')}</Text>
            <View style={localStyles.body}>
                <Switch
                    active={active}
                    activeSwitch={followObject}
                    deactiveSwitch={unfollowObject}
                    disabled={disabled}
                />
                <FollowersGroup
                    followersIds={followersIds}
                    users={users}
                    markAssignee={followObjectsType === FOLLOWER_TASKS_TYPE}
                    followObjectsType={followObjectsType}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    body: {
        flexDirection: 'row',
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
})
