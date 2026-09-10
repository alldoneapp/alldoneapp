import React, { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import AllProjectData from './AllProjectData'
import { FEED_TASK_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import AddTaskTag from '../../../Tags/AddTaskTag'
import Avatar from '../../../Avatar'
import TaskHeaderMoreButton from '../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton'
import ToggleByTime from '../../ToggleByTime'
import AllProjectsEmailLabelChips from '../../EmailLine/AllProjectsEmailLabelChips'
import { AUTOMATIC_PROJECT_OPTION } from '../../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { clearPendingWebShareTarget } from '../../../../redux/actions'
import { clearStoredWebShareTarget } from '../../../../utils/webShareTarget'

export default function AllProjectsLine({ showActions = true, showEmailLabels = false, customRight }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    const pendingWebShareTarget = useSelector(state => state.pendingWebShareTarget)

    const inOpenSection = taskViewToggleSection === 'Open'
    const consumeWebShareTarget = useCallback(() => {
        clearStoredWebShareTarget()
        dispatch(clearPendingWebShareTarget())
    }, [dispatch])

    return (
        <View style={[localStyles.container, showActions && inOpenSection && localStyles.hierarchyHeader]}>
            <View style={localStyles.rightContainer}>
                <Avatar
                    borderSize={0}
                    avatarId={loggedUserId}
                    reviewerPhotoURL={photoURL}
                    size={22}
                    externalStyle={localStyles.avatar}
                />
                <View
                    style={[
                        localStyles.titleAndGrouping,
                        showActions && inOpenSection && mobile && localStyles.mobileTitleAndGrouping,
                    ]}
                >
                    <AllProjectData />
                    <ToggleByTime
                        containerStyle={[
                            localStyles.toggleByTimeInline,
                            showActions && inOpenSection && mobile && localStyles.mobileGrouping,
                        ]}
                    />
                </View>
                {showEmailLabels && <AllProjectsEmailLabelChips />}
            </View>
            <View
                style={[
                    localStyles.leftContainer,
                    showActions && inOpenSection && { height: mobile ? 36 : 32, maxHeight: mobile ? 36 : 32 },
                ]}
            >
                {customRight}
                {showActions && inOpenSection && (
                    <>
                        {/* In All Projects there is no project in context, so the picker
                            opens on "Automatic" and the server routes the task (AT-2306).
                            The user's default project is still where it is created, and
                            picking a project by hand overrides the routing entirely. */}
                        <AddTaskTag
                            projectId={AUTOMATIC_PROJECT_OPTION}
                            style={{ marginLeft: 8 }}
                            sourceType={FEED_TASK_OBJECT_TYPE}
                            expandTaskListIfNeeded={true}
                            showProjectSelector={true}
                            primary={true}
                            headerAction={true}
                            initialTaskName={pendingWebShareTarget?.taskName}
                            autoOpenKey={pendingWebShareTarget?.id}
                            onAutoOpen={consumeWebShareTarget}
                        />
                        <TaskHeaderMoreButton
                            userId={loggedUserId}
                            wrapperStyle={localStyles.taskMoreWrapper}
                            buttonStyle={[localStyles.taskMoreButton, mobile && { width: 36, height: 36 }]}
                            iconSize={16}
                            iconColor={colors.Text02}
                        />
                    </>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey400,
        flex: 1,
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingTop: 25,
        paddingBottom: 6,
    },
    hierarchyHeader: {
        paddingTop: 0,
        paddingBottom: 0,
        paddingHorizontal: 12,
        alignItems: 'center',
        borderBottomWidth: 0,
        borderRadius: 12,
        backgroundColor: colors.Grey200,
    },
    titleAndGrouping: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
    },
    mobileTitleAndGrouping: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    mobileGrouping: {
        marginLeft: 0,
        height: 18,
    },
    leftContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
        maxHeight: 24,
        // Never squeezed by the title block on its left: the title shrinks and truncates instead,
        // otherwise the actions' own labels overflow this container and draw over it (AT-2263).
        flexShrink: 0,
    },
    rightContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    avatar: {
        marginRight: 10,
    },
    taskMoreWrapper: {
        marginLeft: 6,
        marginTop: 0,
    },
    taskMoreButton: {
        width: 32,
        height: 32,
        minWidth: 32,
        minHeight: 32,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
    },
    toggleByTimeInline: {
        marginTop: 0,
        marginLeft: 8,
        height: 24,
    },
})
