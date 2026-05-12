import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../../i18n/TranslationService'
import { setUserOKRPrivacyMode } from '../../../utils/backends/Users/usersFirestore'
import OKRItem, { OKREmptyItem } from './OKRItem'
import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from './okrHelper'

export default function OKRSection({ projectId, inAllProjects }) {
    const okrs = useSelector(state => state.okrsByProjectInTasks[projectId] || [])
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const okrPrivacyMode = !!loggedUser.okrPrivacyMode
    const todayKey = getOkrAllProjectsTodayKey(undefined, getOkrUserTimezone(loggedUser))
    const okrsHiddenTodayById = loggedUser.okrsHiddenInAllProjectsTodayByProjectAndOkr?.[projectId] || {}
    const okrsToShow = inAllProjects ? okrs.filter(okr => okrsHiddenTodayById[okr.id] !== todayKey) : okrs

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const canUpdate =
        accessGranted && (loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

    const togglePrivacyMode = () => {
        setUserOKRPrivacyMode(loggedUser.uid, !okrPrivacyMode)
    }

    if (okrsToShow.length === 0) return null

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <View style={localStyles.headerLeft}>
                    <Text style={[styles.caption1, localStyles.headerText]}>{translate('OKRs')}</Text>
                    <TouchableOpacity
                        style={localStyles.privacyButton}
                        onPress={togglePrivacyMode}
                        disabled={!loggedUser.uid}
                        accessibilityLabel={translate(okrPrivacyMode ? 'Show OKRs' : 'Hide OKRs')}
                    >
                        <Icon
                            name={okrPrivacyMode ? 'eye-off' : 'eye'}
                            size={14}
                            color={okrPrivacyMode ? colors.Primary100 : colors.Text03}
                        />
                        {!smallScreenNavigation && (
                            <Text
                                style={[
                                    styles.caption1,
                                    localStyles.privacyText,
                                    okrPrivacyMode && localStyles.privacyTextActive,
                                ]}
                            >
                                {translate('Privacy')}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
                <View style={localStyles.headerRight}>
                    <OKREmptyItem projectId={projectId} canUpdate={canUpdate} compact />
                </View>
            </View>
            {!okrPrivacyMode &&
                okrsToShow.map(okr => (
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
    privacyButton: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    privacyText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    privacyTextActive: {
        color: colors.Primary100,
    },
})
