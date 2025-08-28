import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import { PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import styles, { colors } from '../../styles/global'

export default function GeneralTasksHeader({ projectId }) {
    const project = ProjectHelper.getProjectById(projectId)
    const conatinerColor = PROJECT_COLOR_SYSTEM[project.color].PROJECT_ITEM_ACTIVE
    const blockColor = PROJECT_COLOR_SYSTEM[project.color].PROJECT_ITEM_SECTION_ITEM_ACTIVE

    return (
        <View style={[localStyles.container, { borderColor: conatinerColor }]}>
            <View style={[localStyles.blockContainer, { backgroundColor: conatinerColor }]}>
                <View style={[localStyles.block, { borderColor: blockColor }]} />
            </View>
            <Text style={localStyles.text}>
                {translate(`General tasks`)}: {project.name}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginVertical: 4,
        paddingRight: 4,
        height: 40,
        alignItems: 'center',
        borderRadius: 4,
        borderWidth: 1,
        flexDirection: 'row',
        width: '100%',
    },
    blockContainer: {
        height: 40,
        alignItems: 'center',
        borderRadius: 4,
        flexDirection: 'row',
        paddingLeft: 4,
        paddingRight: 5,
    },
    block: {
        width: 52,
        height: 32,
        borderRadius: 4,
        borderWidth: 2,
        backgroundColor: '#ffffff',
    },
    text: {
        ...styles.body1,
        color: colors.Text01,
        marginLeft: 7,
    },
})
