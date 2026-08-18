import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { AUTOMATIC_PROJECT_OPTION } from './projectPickerConstants'

/**
 * The leading "Automatic" row of the add-task project picker (AT-2306) — the
 * sibling of AllProjectItem, kept in the same shape so ProjectListModal can
 * render either one at index -1 without special-casing the layout.
 */
export default function AutomaticProjectItem({ selectedProjectId, onProjectSelect, active }) {
    const onPress = () => {
        onProjectSelect(null, null, { id: AUTOMATIC_PROJECT_OPTION })
    }

    return (
        <View>
            <TouchableOpacity onPress={onPress} accessibilityRole="button">
                <View style={[localStyles.container, active && localStyles.containerSelected]}>
                    <View style={localStyles.headerContainer}>
                        <Icon name="cpu" size={24} color={colors.Text03} style={localStyles.icon} />
                        <View style={localStyles.textContainer}>
                            <Text
                                numberOfLines={1}
                                style={[
                                    styles.subtitle1,
                                    localStyles.projectName,
                                    active && localStyles.projectNameSelected,
                                ]}
                            >
                                {translate('Automatic')}
                            </Text>
                            <Text numberOfLines={1} style={[styles.body2, localStyles.description]}>
                                {translate('Automatic project description')}
                            </Text>
                        </View>
                    </View>

                    {selectedProjectId === AUTOMATIC_PROJECT_OPTION && (
                        <View style={localStyles.checkContainer}>
                            <Icon name="check" size={24} color="white" />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
    },
    containerSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
    },
    headerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingVertical: 12,
    },
    icon: {
        marginRight: 8,
    },
    textContainer: {
        flex: 1,
        minWidth: 0,
    },
    checkContainer: {
        marginLeft: 'auto',
    },
    projectName: {
        color: '#ffffff',
    },
    projectNameSelected: {
        color: colors.Primary100,
    },
    description: {
        color: colors.Text03,
    },
})
