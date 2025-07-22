import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import AllProjectData from './AllProjectData'
import { FEED_TASK_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import AddTaskTag from '../../../Tags/AddTaskTag'
import Avatar from '../../../Avatar'

export default function AllProjectsLine() {
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    const inOpenSection = taskViewToggleSection === 'Open'

    return (
        <View style={localStyles.container}>
            <View style={localStyles.rightContainer}>
                <Avatar
                    borderSize={0}
                    avatarId={loggedUserId}
                    reviewerPhotoURL={photoURL}
                    size={22}
                    externalStyle={localStyles.avatar}
                />
                <AllProjectData />
            </View>
            <View style={localStyles.leftContainer}>
                {inOpenSection && (
                    <AddTaskTag
                        projectId={defaultProjectId}
                        style={{ marginLeft: 8 }}
                        sourceType={FEED_TASK_OBJECT_TYPE}
                        expandTaskListIfNeeded={true}
                        showProjectSelector={true}
                    />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
        flex: 1,
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingTop: 25,
        paddingBottom: 6,
    },
    leftContainer: {
        flexDirection: 'row',
        height: 24,
        maxHeight: 24,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        marginRight: 10,
    },
})
