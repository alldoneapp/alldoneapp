import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

import ProjectStatusModalWrapper from './ProjectStatusModalWrapper'

export default function ProjectStatus({ project, disabled }) {
    return (
        <View style={localStyles.propertyRow}>
            <View style={localStyles.textContainer}>
                <Icon name={'status'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={localStyles.text}>{translate('Project status')}</Text>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <ProjectStatusModalWrapper project={project} disabled={disabled || !!project.parentTemplateId} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    textContainer: {
        justifyContent: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
})
