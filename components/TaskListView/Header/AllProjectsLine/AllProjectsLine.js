import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { HeaderActionsContext } from '../../TaskHierarchy'
import { colors } from '../../../styles/global'
import AllProjectData from './AllProjectData'
import Avatar from '../../../Avatar'
import TaskHeaderMoreButton from '../../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton'
import ToggleByTime from '../../ToggleByTime'
import { alphaColor, themed } from '../../../../Themes/colorMode'
import { isSectionsTopSidebarNavigation } from '../../../../utils/SidebarNavigationModes'
import { MirroredActionsSpacer, useMirroredActionsWidth } from '../centeredHeaderTitle'

// Required on use: RootSectionNavigation reaches the settings tree (and its drag and drop) through the
// tab header, which this line, imported by many views, does not need otherwise.
const SectionNavigation = () => {
    const RootSectionNavigation = require('../../../RootView/RootSectionNavigation').default
    return <RootSectionNavigation useOuterMargins={false} />
}

// AT-3136: required on use for the same reason. The meeting figures read Firestore, and only the
// task boards and My Day show them.
const MeetingTime = () => {
    const AllProjectsMeetingTime = require('./AllProjectsMeetingTime').default
    return <AllProjectsMeetingTime />
}

// AT-3136: `showMeetingTime` is passed by the task boards and My Day only (the line also heads
// Notes, Chats, Contacts and Goals, where the meeting figures are not wanted).
export default function AllProjectsLine({
    showActions = true,
    customRight,
    bottomSpacing = 16,
    showMeetingTime = false,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    // AT-3121: in the "Anna on top" sidebar the section card sits below this line, as below a
    // project's line (ProjectHeader), not above it (MainViewsContainer leaves it out there).
    const annaOnTop = useSelector(state => isSectionsTopSidebarNavigation(state.loggedUser.sidebarNavigationMode))

    const inOpenSection = taskViewToggleSection === 'Open'
    // AT-3132: on mobile sizes (smallScreenNavigation) the avatar, title and grouping toggle sit
    // centred on the whole line as one block; on desktop they stay left aligned.
    const centerTitle = mobile
    const [actionsWidth, onActionsLayout] = useMirroredActionsWidth()
    // AT-3136: on mobile sizes the meeting figures get their own right-aligned row under the line.
    // In the actions cluster they would be mirrored by the centring spacer (AT-3132) and leave the
    // title no room, so "All projects" and the figures were drawn over each other at 390px.
    const meetingTimeBelow = showMeetingTime && mobile
    const meetingTimeInLine = showMeetingTime && !mobile

    return (
        <>
            <HeaderActionsContext.Provider value={true}>
                <View
                    style={[
                        localStyles.container,
                        localStyles.hierarchyHeader,
                        { marginBottom: meetingTimeBelow ? 4 : bottomSpacing },
                    ]}
                >
                    {centerTitle && <MirroredActionsSpacer width={actionsWidth} testID="all-projects-line-mirror" />}
                    <View
                        style={[localStyles.rightContainer, centerTitle && localStyles.centeredTitle]}
                        testID="all-projects-line-title"
                    >
                        <Avatar
                            borderSize={0}
                            avatarId={loggedUserId}
                            reviewerPhotoURL={photoURL}
                            size={22}
                            externalStyle={localStyles.avatar}
                        />
                        <View style={[localStyles.titleAndGrouping, mobile && localStyles.mobileTitleAndGrouping]}>
                            <AllProjectData />
                            <ToggleByTime
                                containerStyle={[localStyles.toggleByTimeInline, mobile && localStyles.mobileGrouping]}
                            />
                        </View>
                    </View>
                    <View
                        testID="all-projects-line-actions"
                        onLayout={centerTitle ? onActionsLayout : undefined}
                        style={[localStyles.leftContainer, { height: mobile ? 36 : 32, maxHeight: mobile ? 36 : 32 }]}
                    >
                        {meetingTimeInLine && <MeetingTime />}
                        {customRight}
                        {showActions && inOpenSection && (
                            <TaskHeaderMoreButton
                                projectIdOverride={null}
                                userId={loggedUserId}
                                wrapperStyle={localStyles.taskMoreWrapper}
                                buttonStyle={[localStyles.taskMoreButton, mobile && { width: 36, height: 36 }]}
                                iconSize={16}
                                iconColor={colors.Text02}
                            />
                        )}
                    </View>
                </View>
            </HeaderActionsContext.Provider>
            {meetingTimeBelow && (
                <View style={[localStyles.meetingTimeRow, { marginBottom: bottomSpacing }]} testID="meeting-time-row">
                    <MeetingTime />
                </View>
            )}
            {annaOnTop && <SectionNavigation />}
        </>
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
    // The title and the grouping toggle stay left aligned to each other inside the centred block.
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
    // AT-3132: mobile only, see centeredHeaderTitle.js.
    centeredTitle: {
        justifyContent: 'center',
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
        backgroundColor: alphaColor(themed.Surface, 0.85),
    },
    meetingTimeRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 12,
    },
    toggleByTimeInline: {
        marginTop: 0,
        marginLeft: 8,
        height: 24,
    },
})
