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

export default function AllProjectsLine({ showActions = true, customRight, bottomSpacing = 16 }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    // AT-3121: in the "Anna on top" sidebar the section card sits below this line, as below a
    // project's line (ProjectHeader), not above it (MainViewsContainer leaves it out there).
    const annaOnTop = useSelector(state => isSectionsTopSidebarNavigation(state.loggedUser.sidebarNavigationMode))

    const inOpenSection = taskViewToggleSection === 'Open'
    // AT-3132: the avatar, title and grouping toggle sit centred on the whole line as one block.
    const [actionsWidth, onActionsLayout] = useMirroredActionsWidth()

    return (
        <>
            <HeaderActionsContext.Provider value={true}>
                <View style={[localStyles.container, localStyles.hierarchyHeader, { marginBottom: bottomSpacing }]}>
                    <MirroredActionsSpacer width={actionsWidth} testID="all-projects-line-mirror" />
                    <View style={localStyles.rightContainer} testID="all-projects-line-title">
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
                        onLayout={onActionsLayout}
                        style={[localStyles.leftContainer, { height: mobile ? 36 : 32, maxHeight: mobile ? 36 : 32 }]}
                    >
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
        justifyContent: 'center',
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
        backgroundColor: alphaColor(themed.Surface, 0.85),
    },
    toggleByTimeInline: {
        marginTop: 0,
        marginLeft: 8,
        height: 24,
    },
})
