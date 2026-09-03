import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import { setSelectedNavItem } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_USER_WORKFLOW } from '../../../utils/TabNavigationConstants'
import TagsArea from './TagsArea'
import {
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_ROOT_CHATS,
} from '../../../utils/TabNavigationConstants'
import store from '../../../redux/store'
import ProjectAndUserData from './ProjectAndUserData'
import RootSectionNavigation from '../../RootView/RootSectionNavigation'
import ProjectCompletedSweep from './ProjectCompletedSweep'
import ProjectLineDisintegration from './ProjectLineDisintegration'
import useProjectCompletedSweepMotion, { useProjectLineExit } from '../OpenTasksView/projectCompletedSweepMotion'

/**
 * AT-2495 (second pass) — the project line owns the completed-sweep RUN, not just the overlay that
 * draws it.
 *
 * The run has two halves that live on two different nodes: the sweep is an absolutely-positioned
 * overlay INSIDE the row, and the disintegration is a CSS mask ON the row (plus a particle layer
 * beside it). A child cannot mask its parent, so the hook had to move up here — one sequence, both
 * halves, no chance of the colour and the erasure drifting apart.
 *
 * Every other caller of `ProjectHeader` — chats, contacts, notes, goals, done, pending — passes no
 * run id and no `lineWillLeave`, so `sweeping` and `exiting` are false for them, the exit style is
 * `undefined`, and they render exactly the row they always did.
 */

export default function ProjectHeader({
    projectIndex,
    projectId,
    showWorkflowTag = false,
    badge,
    customRight,
    showAddTask,
    showAddGoal,
    setPressedShowMoreMainSection,
    showRootSectionNavigation = false,
    showEmailLabels = false,
    completedSweepRunId = 0,
    completedSweepLineWillLeave = false,
}) {
    const dispatch = useDispatch()

    const currentUser = useSelector(state => state.currentUser)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedSidebarTab)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)

    const userInHeader =
        selectedTab === DV_TAB_ROOT_CONTACTS ||
        selectedTab === DV_TAB_ROOT_NOTES ||
        selectedTab === DV_TAB_ROOT_CHATS ||
        selectedTab === DV_TAB_ROOT_UPDATES
            ? loggedUser
            : currentUser

    const onClickWorkflowIndicator = () => {
        const { loggedUserProjectsMap } = store.getState()
        dispatch(setSelectedNavItem(DV_TAB_USER_WORKFLOW))
        NavigationService.navigate('UserDetailedView', {
            contact: userInHeader,
            project: loggedUserProjectsMap[projectId],
        })
    }

    const haveWorkflow = () => {
        return (
            userInHeader &&
            userInHeader.workflow &&
            userInHeader.workflow[projectId] &&
            Object.values(userInHeader.workflow[projectId]).length > 0
        )
    }

    const showWorkflow = showWorkflowTag && haveWorkflow()

    const projectColor = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.color)
    const sweepMotion = useProjectCompletedSweepMotion(completedSweepRunId, completedSweepLineWillLeave)
    const { exitStyle, exitHeight, onLineLayout } = useProjectLineExit(sweepMotion)

    return (
        <>
            {/* One wrapper so the particle layer below is positioned against THIS row and nothing
                else. It is rendered unconditionally — mounting it only while a project is being
                celebrated would remount the whole header in the middle of its own animation — and it
                is layout-neutral: an unstyled `View` in a column parent is the box its single child
                already was. */}
            <View style={localStyles.lineContainer}>
                <Animated.View style={exitStyle} onLayout={onLineLayout} testID="project-line">
                    {/* AT-2492 — the "you cleared this project today" sweep. Absolutely positioned and
                    pointer-transparent, so a header that is not celebrating anything renders exactly
                    what it always did and the row's geometry is untouched either way. Every other
                    caller of ProjectHeader passes no run id and gets nothing.

                    AT-2495 — the exit style above is what erases this whole subtree, the overlay
                    included, right to left. It is `undefined` unless the line is genuinely leaving,
                    so an ordinary header carries no mask (and therefore no compositing layer) and is
                    never pinned to a measured height. */}
                    <View style={localStyles.borderContainer}>
                        <ProjectCompletedSweep motion={sweepMotion} projectId={projectId} />
                        <View style={localStyles.container}>
                            <ProjectAndUserData
                                projectIndex={projectIndex}
                                projectId={projectId}
                                badge={badge}
                                userInHeader={userInHeader}
                                showEmailLabels={showEmailLabels}
                            />
                            <TagsArea
                                projectId={projectId}
                                mobile={mobile || mobileCollapsed}
                                onClickWorkflowIndicator={onClickWorkflowIndicator}
                                showWorkflow={showWorkflow}
                                showAddTask={showAddTask}
                                showAddGoal={showAddGoal}
                                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                            />
                            {customRight}
                        </View>
                    </View>
                </Animated.View>
                {/* AT-2495 — the dust and the sparks, and a SIBLING of the masked row rather than a
                    child of it. A child would be erased by the very mask whose edge it is supposed
                    to be shedding; these have to outlive the pixels they came off, which is the
                    whole idea. */}
                {exitStyle && (
                    <ProjectLineDisintegration
                        progress={sweepMotion.disintegrate}
                        height={exitHeight}
                        tint={projectColor || colors.Primary100}
                    />
                )}
            </View>
            {showRootSectionNavigation && <RootSectionNavigation useOuterMargins={false} />}
        </>
    )
}

const localStyles = StyleSheet.create({
    // Explicit, although react-native-web already gives every View `position: relative`: the
    // particle layer's absolute placement depends on it, and that dependency should be visible here
    // rather than inherited from a framework default.
    lineContainer: {
        position: 'relative',
    },
    borderContainer: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey400,
    },
    container: {
        flex: 1,
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingTop: 25,
        paddingBottom: 6,
    },
    subContainer: {
        maxHeight: 24,
        height: 24,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    titleSubContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    projectName: {
        paddingLeft: 4,
        color: colors.Text01,
    },
    userName: {
        color: colors.Text01,
    },
    compass: {
        backgroundColor: 'green',
        borderRadius: 100,
        opacity: 0,
    },
    dotSeparator: {
        width: 4,
        height: 4,
        borderRadius: 16,
        backgroundColor: colors.Text02,
        marginHorizontal: 6,
    },
    userImage: {
        height: 18,
        width: 18,
        borderRadius: 100,
        marginRight: 4,
        backgroundColor: colors.Gray400,
    },
    stepUserImage: {
        height: 16,
        width: 16,
        borderRadius: 100,
    },
    stepUserImageOutline: {
        height: 20,
        width: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 100,
        backgroundColor: colors.Text03,
    },
    workflowIndicator: {
        height: 24,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 4,
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
    },
    centeredRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    workflowIconMobile: {
        marginRight: 6,
    },
    workflowLabel: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 8,
    },
})
