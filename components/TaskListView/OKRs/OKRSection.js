import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_PROJECT_OKRS } from '../../../utils/TabNavigationConstants'
import { translate } from '../../../i18n/TranslationService'
import { clearUserOKRsHiddenInAllProjectsToday } from '../../../utils/backends/Users/usersFirestore'
import OKRItem, { OKREmptyItem } from './OKRItem'
import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from './okrHelper'
import { useTaskHierarchy } from '../TaskHierarchy'
import { getOkrTodayOperation, getOkrTodayVisibilityValue } from '../../../redux/okrTodayVisibility'

export default function OKRSection({ projectId, inAllProjects }) {
    const taskHierarchy = useTaskHierarchy()
    const okrs = useSelector(state => state.okrsByProjectInTasks[projectId] || [])
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const todayKey = getOkrAllProjectsTodayKey(undefined, getOkrUserTimezone(loggedUser))
    const operations = useSelector(state => state.okrTodayOperations)
    const projectOperations = okrs.map(okr => getOkrTodayOperation(operations, loggedUser.uid, projectId, okr.id))
    const savingToday = projectOperations.some(operation => operation?.status === 'pending')
    const restoringToday = projectOperations.some(
        operation => operation?.status === 'pending' && !operation.targetValue
    )
    const restoreFailed = projectOperations.some(
        operation => operation?.status === 'error' && !operation.targetValue && operation.previousValue === todayKey
    )
    const okrsHiddenTodayById = Object.fromEntries(
        okrs.map(okr => [
            okr.id,
            getOkrTodayVisibilityValue(
                loggedUser,
                projectId,
                okr.id,
                getOkrTodayOperation(operations, loggedUser.uid, projectId, okr.id)
            ),
        ])
    )
    const okrsHiddenToday = okrs.filter(okr => okrsHiddenTodayById[okr.id] === todayKey)
    const okrsToShow = okrs.filter(okr => okrsHiddenTodayById[okr.id] !== todayKey)
    const showUndoAllToday = !inAllProjects && okrsHiddenToday.length > 0

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const canUpdate =
        accessGranted && (loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

    const openOKRsTab = () => {
        ProjectHelper.processURLProjectDetailsTab(NavigationService, DV_TAB_PROJECT_OKRS, projectId)
    }

    const undoAllOKRsForToday = () => {
        if (!loggedUser.uid || savingToday) return
        clearUserOKRsHiddenInAllProjectsToday(
            loggedUser.uid,
            projectId,
            okrsHiddenToday.map(okr => okr.id)
        ).catch(() => {}) // Keep rejected writes visible as errors instead of unhandled rejections.
    }

    if (okrs.length === 0 || (okrsToShow.length === 0 && !restoringToday && !restoreFailed)) return null

    return (
        <View style={[localStyles.container, taskHierarchy && localStyles.hierarchyContainer]}>
            <View style={localStyles.header}>
                <View style={localStyles.headerLeft}>
                    <Text style={[styles.caption1, localStyles.headerText]}>{translate('OKRs')}</Text>
                    <TouchableOpacity
                        style={localStyles.headerAction}
                        onPress={openOKRsTab}
                        accessibilityLabel={translate('History')}
                    >
                        <Icon name="external-link" size={14} color={colors.Text03} />
                        {!smallScreenNavigation && (
                            <Text style={[styles.caption1, localStyles.headerActionText]}>{translate('History')}</Text>
                        )}
                    </TouchableOpacity>
                    {showUndoAllToday && (
                        <TouchableOpacity
                            style={localStyles.undoAllTodayButton}
                            onPress={undoAllOKRsForToday}
                            disabled={!loggedUser.uid || savingToday}
                            accessibilityState={{ disabled: !loggedUser.uid || savingToday, busy: restoringToday }}
                            accessibilityLabel={translate('Undo all OKRs for today')}
                        >
                            <Icon name="rotate-ccw" size={14} color={colors.Text03} />
                            {!smallScreenNavigation && (
                                <Text style={[styles.caption1, localStyles.undoAllTodayText]}>
                                    {translate(
                                        restoringToday ? 'OKR saving today visibility' : 'Undo all OKRs for today'
                                    )}
                                </Text>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
                <View style={localStyles.headerRight}>
                    <OKREmptyItem projectId={projectId} canUpdate={canUpdate} compact />
                </View>
            </View>
            {(restoringToday || restoreFailed) && (
                <Text
                    style={[styles.caption1, { color: restoreFailed ? colors.Red200 : colors.Text03 }]}
                    accessibilityRole={restoreFailed ? 'alert' : undefined}
                    accessibilityLiveRegion="polite"
                >
                    {translate(restoreFailed ? 'OKR today visibility failed' : 'OKR saving today visibility')}
                </Text>
            )}
            {okrsToShow.map(okr => (
                <OKRItem
                    key={okr.id}
                    projectId={projectId}
                    okr={okr}
                    canUpdate={canUpdate}
                    inAllProjects={inAllProjects}
                    hiddenInAllProjectsToday={okrsHiddenTodayById[okr.id] === todayKey}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 12,
    },
    hierarchyContainer: {
        paddingHorizontal: 8,
    },
    header: {
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerText: {
        color: colors.Text03,
        marginRight: 8,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerAction: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    headerActionText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    undoAllTodayButton: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    undoAllTodayText: {
        color: colors.Text03,
        marginLeft: 4,
    },
})
