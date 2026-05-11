import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../../i18n/TranslationService'
import OKRItem, { OKREmptyItem } from './OKRItem'

export default function OKRSection({ projectId }) {
    const okrs = useSelector(state => state.okrsByProjectInTasks[projectId] || [])
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const canUpdate =
        accessGranted && (loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

    if (okrs.length === 0) return null

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('OKRs')}</Text>
                <OKREmptyItem projectId={projectId} canUpdate={canUpdate} compact />
            </View>
            {okrs.map(okr => (
                <OKRItem key={okr.id} projectId={projectId} okr={okr} canUpdate={canUpdate} />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 12,
    },
    header: {
        height: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerText: {
        flex: 1,
        color: colors.Text03,
        textTransform: 'uppercase',
    },
})
