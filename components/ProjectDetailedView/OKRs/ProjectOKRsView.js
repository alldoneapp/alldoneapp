import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import URLsProjects, { URL_PROJECT_DETAILS_OKRS } from '../../../URLSystem/Projects/URLsProjects'
import OKRHistoryPanel from '../../ProjectOKRs/OKRHistoryPanel'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function ProjectOKRsView({ project, userId }) {
    useEffect(() => {
        URLsProjects.push(URL_PROJECT_DETAILS_OKRS, { projectId: project.id, userId }, project.id)
    }, [project.id, userId])

    return (
        <View style={localStyles.container}>
            <View style={localStyles.titleRow}>
                <Text style={localStyles.title}>{translate('OKRs')}</Text>
            </View>
            <Text style={localStyles.description}>{translate('OKRs tab description')}</Text>

            <OKRHistoryPanel projects={[{ id: project.id, name: project.name }]} ownerId={userId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 24,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    title: {
        ...styles.title4,
        color: colors.Text01,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
})
