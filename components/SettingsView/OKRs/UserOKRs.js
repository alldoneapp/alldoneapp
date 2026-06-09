import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import URLsSettings, { URL_SETTINGS_OKRS } from '../../../URLSystem/Settings/URLsSettings'
import OKRHistoryPanel from '../../ProjectOKRs/OKRHistoryPanel'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function UserOKRs() {
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    useEffect(() => {
        URLsSettings.push(URL_SETTINGS_OKRS)
    }, [])

    const projects = loggedUserProjects.map(project => ({ id: project.id, name: project.name }))

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('OKRs')}</Text>
            </View>
            <Text style={localStyles.description}>{translate('OKRs tab description')}</Text>

            <OKRHistoryPanel projects={projects} ownerId={loggedUser.uid} showProjectName />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        flexDirection: 'row',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 4,
    },
})
