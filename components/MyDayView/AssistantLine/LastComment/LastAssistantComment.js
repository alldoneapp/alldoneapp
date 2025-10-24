import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import ReddBubble from './ReddBubble'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import ProjectTagIndicator from './ProjectTagIndicator'
import { checkIfSelectedAllProjects } from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function LastAssistantComment({ projectId, commentText, onPress, objectName, isNew }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const text = shrinkTagText(commentText.replace(/\s\s+/g, ''), 500)
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    return (
        <TouchableOpacity onPress={onPress} style={[localStyles.container]}>
            <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                {!!objectName && (
                    <Text numberOfLines={2} style={localStyles.title}>
                        {objectName}
                    </Text>
                )}
                <Text numberOfLines={2} style={localStyles.text}>
                    {text}
                </Text>
            </View>
            <ProjectTagIndicator projectId={projectId} />
            {isNew && <ReddBubble />}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 80,
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: 12,
    },
    textContainer: {
        width: '100%',
        paddingRight: 20,
        justifyContent: 'flex-start',
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
