import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { ALL_ARCHIVED_PROJECTS_OPTION } from './projectPickerConstants'

/**
 * The leading "All archived" row of the search scope picker's Archived tab
 * (AT-2390) — the sibling of AllProjectItem/AutomaticProjectItem, kept in the
 * same shape so ProjectListModal can render any of them at index -1 without
 * special-casing the layout or the keyboard cycle.
 */
export default function AllArchivedProjectItem({ selectedProjectId, onProjectSelect, active, label }) {
    const onPress = () => {
        onProjectSelect(null, null, { id: ALL_ARCHIVED_PROJECTS_OPTION })
    }

    return (
        <View>
            <TouchableOpacity onPress={onPress} accessibilityRole="button" testID={'all-archived-projects-option'}>
                <View style={[localStyles.container, active && localStyles.containerSelected]}>
                    <View style={localStyles.headerContainer}>
                        <Icon name="archive" size={24} color={colors.Text03} style={localStyles.icon} />
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.subtitle1,
                                localStyles.projectName,
                                active && localStyles.projectNameSelected,
                            ]}
                        >
                            {translate(label || 'All archived')}
                        </Text>
                    </View>

                    {selectedProjectId === ALL_ARCHIVED_PROJECTS_OPTION && (
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
        paddingVertical: 16,
    },
    icon: {
        marginRight: 8,
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
})
