import React, { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useDispatch, useSelector } from 'react-redux'

import GeneralTasksHeader from './GeneralTasksHeader'
import GoalsSwipeBackground from '../../GoalsView/GoalsSwipeBackground'
import { showSwipeDueDatePopup, setSwipeDueDatePopupData, setSelectedNavItem } from '../../../redux/actions'
import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../utils/TabNavigationConstants'
import { useTaskHierarchy } from '../TaskHierarchy'

export default function SwipeableGeneralTasksHeader({ projectId, taskList, dateIndex, instanceKey }) {
    const itemSwipe = useRef(null)
    const taskHierarchy = useTaskHierarchy()
    const dispatch = useDispatch()
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const renderLeftSwipe = () => <View style={localStyles.swipeAction} />

    const renderRightSwipe = () => <View style={localStyles.swipeAction} />

    const onLeftSwipe = () => {
        itemSwipe.current.close()

        let projectIndex = -1
        if (loggedUserProjects) {
            projectIndex = loggedUserProjects.findIndex(project => project.id === projectId)
        }

        if (projectIndex !== -1) {
            dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
            NavigationService.navigate('ProjectDetailedView', {
                projectIndex: projectIndex,
            })
        } else {
            console.error(`Project with ID ${projectId} not found`)
        }
    }

    const onRightSwipe = () => {
        itemSwipe.current.close()
        setTimeout(() => {
            if (taskList && taskList.length > 0) {
                const firstTask = taskList[0]

                store.dispatch([
                    showSwipeDueDatePopup(),
                    setSwipeDueDatePopupData({
                        projectId,
                        task: firstTask,
                        parentGoaltasks: taskList,
                        inParentGoal: true,
                        multipleTasks: taskList.length > 1,
                        isEmptyGoal: false,
                        goal: null,
                        isObservedTask: false,
                    }),
                ])
            }
        })
    }

    return (
        <View style={[localStyles.container, taskHierarchy && localStyles.hierarchyContainer]}>
            <GoalsSwipeBackground needToShowReminderButton={true} showPropertiesButton={true} />
            <Swipeable
                useNativeAnimations={false}
                ref={itemSwipe}
                rightThreshold={80}
                leftThreshold={80}
                enabled={true}
                renderLeftActions={renderLeftSwipe}
                renderRightActions={renderRightSwipe}
                onSwipeableLeftWillOpen={onLeftSwipe}
                onSwipeableRightWillOpen={onRightSwipe}
                overshootLeft={false}
                overshootRight={false}
                friction={2}
                containerStyle={{ overflow: 'visible' }}
                failOffsetY={[-5, 5]}
            >
                <GeneralTasksHeader projectId={projectId} noVerticalMargin={true} />
            </Swipeable>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
        marginVertical: 4,
    },
    hierarchyContainer: {
        marginTop: 0,
    },
    swipeAction: {
        width: 150,
    },
})
