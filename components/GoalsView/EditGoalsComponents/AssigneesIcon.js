import React from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'

import UsersPlusButton from '../../Followers/UsersPlusButton'
import { MAX_USERS_TO_SHOW } from '../../Followers/FollowerConstants'
import Avatar from '../../Avatar'
import { getHandlerData } from '../../TaskListView/Utils/TasksHelper'

export default function AssigneesIcon({
    projectId,
    assigneesIds,
    openModal,
    workstreamBackgroundColor,
    disableModal,
    style,
    maxUsersToShow,
}) {
    const projectAssigneesIds = assigneesIds.filter(assigneeId => {
        const { handler: assignee, isPublicForLoggedUser } = getHandlerData(assigneeId, projectId)
        return assignee && isPublicForLoggedUser
    })

    const maxUsers = maxUsersToShow ? maxUsersToShow : MAX_USERS_TO_SHOW
    const assigneesIdsToShow = projectAssigneesIds.slice(0, maxUsers)

    return (
        <View style={[localStyles.container, style]}>
            {assigneesIdsToShow.map((assigneeId, index) => {
                const { handler: assignee } = getHandlerData(assigneeId, projectId)
                return (
                    <TouchableOpacity
                        key={assigneeId}
                        style={index > 0 ? localStyles.assigneesMargin : null}
                        onPress={openModal}
                        disabled={disableModal}
                        accessible={false}
                    >
                        <Avatar
                            workstreamBackgroundColor={workstreamBackgroundColor}
                            avatarId={assigneeId}
                            reviewerPhotoURL={assignee.photoURL}
                            borderSize={0}
                            size={24}
                        />
                    </TouchableOpacity>
                )
            })}
            {projectAssigneesIds.length > maxUsers && (
                <UsersPlusButton
                    usersAmount={projectAssigneesIds.length}
                    disabled={disableModal}
                    containerStyle={[localStyles.avatar, localStyles.assigneesMargin]}
                    openModal={openModal}
                    maxUsersToShow={maxUsers}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    avatar: {
        width: 24,
        height: 24,
    },
    assigneesMargin: {
        marginLeft: -10,
    },
})
