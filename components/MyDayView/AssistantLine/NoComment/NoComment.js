import React from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import { checkIfSelectedAllProjects } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ProjectTagIndicator from '../LastComment/ProjectTagIndicator'

export default function NoComment({ projectId, assistant }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const createNewChat = () => {
        createBotQuickTopic(assistant)
    }

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    return (
        <View style={localStyles.container}>
            <TouchableOpacity onPress={createNewChat} style={[localStyles.container2]}>
                <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
                <View style={localStyles.textContainer}>
                    <Text numberOfLines={2} style={localStyles.title}>
                        {translate('Start a new topic')}
                    </Text>
                    <Text numberOfLines={2} style={localStyles.text}>
                        {translate('Click here to start a new chat')}
                    </Text>
                </View>
                {inAllProjects && <ProjectTagIndicator projectId={projectId} />}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignContent: 'flex-start',
        flex: 1,
        marginLeft: 16,
    },
    container2: {
        height: 70,
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    textContainer: {
        width: '100%',
        paddingRight: 20,
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text03,
        fontWeight: 'bold',
        overflow: 'hidden',
        maxHeight: 22,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        flexWrap: 'wrap',
    },
    icon: {
        marginTop: 4,
        marginRight: 4,
    },
})
