import React from 'react'
import { StyleSheet, View } from 'react-native'
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

export default function ProjectHeader({
    projectIndex,
    projectId,
    showWorkflowTag = false,
    badge,
    customRight,
    showAddTask,
    showAddGoal,
    setPressedShowMoreMainSection,
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

    const workflow = userInHeader.workflow ? userInHeader.workflow[projectId] : undefined

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

    return (
        <View style={localStyles.borderContainer}>
            <View style={localStyles.container}>
                <ProjectAndUserData
                    projectIndex={projectIndex}
                    projectId={projectId}
                    badge={badge}
                    userInHeader={userInHeader}
                />
                <TagsArea
                    projectId={projectId}
                    workflow={workflow}
                    user={userInHeader}
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
    )
}

const localStyles = StyleSheet.create({
    borderContainer: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
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
