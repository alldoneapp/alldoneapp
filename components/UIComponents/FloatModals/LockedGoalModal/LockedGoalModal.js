import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import NavigationService from '../../../../utils/NavigationService'
import { navigateToSettings, startLoadingData, stopLoadingData } from '../../../../redux/actions'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../../utils/TabNavigationConstants'
import UnlockButton from './UnlockButton'
import { setTaskToBacklogMultiple } from '../../../../utils/backends/firestore'
import { updateGoalAssigneeReminderDate } from '../../../../utils/backends/Goals/goalsFirestore'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

export default function LockedGoalModal({ projectId, lockKey, editing, goalId, ownerId, tasks, date }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const navigateToPremium = () => {
        NavigationService.navigate('SettingsView')
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
    }

    const moveGoalToSomeday = () => {
        const tasksToMove = tasks.map(task => {
            return { ...task, projectId }
        })
        dispatch(startLoadingData())
        setTaskToBacklogMultiple(tasksToMove).then(dispatch(stopLoadingData()))
        updateGoalAssigneeReminderDate(projectId, goalId, currentUserId, BACKLOG_DATE_NUMERIC)
    }

    return (
        <View style={[localStyles.parent, { top: editing ? 168 : 86 }]}>
            <View
                style={[
                    localStyles.container,
                    smallScreenNavigation ? { width: 304, height: 332 } : { width: 393, height: 258 },
                ]}
            >
                <Text style={localStyles.title}>{translate('Unlock these tasks with Alldone Gold')}</Text>
                <Text style={localStyles.description}>{translate('Unlock modal description')}</Text>
                <View style={localStyles.buttonsContainer}>
                    <Button
                        title={smallScreenNavigation ? 'To someday' : 'Postpone to someday'}
                        type={'secondary'}
                        onPress={moveGoalToSomeday}
                        buttonStyle={{ marginRight: 16 }}
                        disabled={date === BACKLOG_DATE_NUMERIC}
                    />
                    <Button
                        title={smallScreenNavigation ? 'Premium' : 'Alldone Premium'}
                        type={'secondary'}
                        onPress={navigateToPremium}
                    />
                </View>
                <View style={localStyles.unlockContainer}>
                    <UnlockButton projectId={projectId} lockKey={lockKey} goalId={goalId} ownerId={ownerId} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
    },
    container: {
        backgroundColor: colors.Grey100,
        borderWidth: 1,
        borderColor: colors.Gray400,
        borderRadius: 4,
        shadowColor: 'rgba(0, 0, 0, 0.04)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
    },
    title: {
        ...styles.title7,
    },
    description: {
        ...styles.body2,
        fontWeight: 400,
        color: colors.Text03,
        marginBottom: 20,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 12,
    },
    unlockContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
