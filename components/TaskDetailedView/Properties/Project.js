import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import ProjectPicker from './ProjectPicker'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export default function Project({ project, item, disabled }) {
    const isGuide = !!project.parentTemplateId
    return (
        <View style={localStyles.container}>
            <View style={localStyles.projectBallContainer}>
                <Icon name="circle" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Project')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <ProjectPicker project={project} item={item} disabled={disabled || isGuide} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    projectBallContainer: {
        marginRight: 8,
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    projectMarker: {
        width: 16,
        height: 16,
        borderRadius: 100,
    },
})
