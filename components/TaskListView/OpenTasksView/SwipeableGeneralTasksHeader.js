import React, { useRef } from 'react'
import { StyleSheet, View, Text, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useDispatch, useSelector } from 'react-redux'

import GeneralTasksHeader from './GeneralTasksHeader'
import GoalsSwipeBackground from '../../GoalsView/GoalsSwipeBackground'
import { showSwipeDueDatePopup, setSwipeDueDatePopupData, setSelectedNavItem } from '../../../redux/actions'
import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../utils/TabNavigationConstants'

export default function SwipeableGeneralTasksHeader({ projectId, taskList, dateIndex, instanceKey }) {
    const itemSwipe = useRef(null)
    const dispatch = useDispatch()
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const renderLeftSwipe = (progress, dragX) => {
        const trans = dragX.interpolate({
            inputRange: [0, 50, 100, 101],
            outputRange: [-20, 0, 0, 1],
            extrapolate: 'clamp',
        })
        return (
            <Animated.View style={[localStyles.leftSwipeAction, { transform: [{ translateX: trans }] }]}>
                <View style={localStyles.swipeContainer}>
                    <View style={localStyles.leftSwipeArea}>
                        <Icon name="settings" size={18} color={colors.UtilityGreen200} />
                        <View style={{ marginLeft: 4 }}>
                            <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>
                                {translate('Properties')}
                            </Text>
                        </View>
                    </View>
                </View>
            </Animated.View>
        )
    }

    const renderRightSwipe = (progress, dragX) => {
        const trans = dragX.interpolate({
            inputRange: [-101, -100, -50, 0],
            outputRange: [1, 0, 0, -20],
            extrapolate: 'clamp',
        })
        return (
            <Animated.View style={[localStyles.rightSwipeAction, { transform: [{ translateX: trans }] }]}>
                <GoalsSwipeBackground needToShowReminderButton={true} />
            </Animated.View>
        )
    }

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
        <View style={localStyles.container}>
            <Swipeable
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
                <GeneralTasksHeader projectId={projectId} />
            </Swipeable>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    leftSwipeAction: {
        width: 150,
        position: 'relative',
    },
    rightSwipeAction: {
        width: 150,
        position: 'relative',
    },
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
})
