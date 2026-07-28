import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { setProjectTaskGoalRoutingMode } from '../../../../utils/backends/Projects/projectsFirestore'
import {
    TASK_GOAL_ROUTING_AUTOMATIC,
    TASK_GOAL_ROUTING_OFF,
    TASK_GOAL_ROUTING_SUGGESTIONS,
    normalizeTaskGoalRoutingMode,
} from '../../../../utils/TaskGoalSuggestion'

const OPTIONS = [
    {
        mode: TASK_GOAL_ROUTING_OFF,
        title: 'Off',
        description: 'Do not suggest goals',
    },
    {
        mode: TASK_GOAL_ROUTING_SUGGESTIONS,
        title: 'Suggestions',
        description: 'Suggest a goal without moving the task',
    },
    {
        mode: TASK_GOAL_ROUTING_AUTOMATIC,
        title: 'Automatic',
        description: 'Automatically assign only high-confidence matches',
    },
]

export default function TaskGoalRouting({ projectId, disabled, mode }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const currentMode = normalizeTaskGoalRoutingMode(mode)
    const currentOption = OPTIONS.find(option => option.mode === currentMode)

    const selectMode = async nextMode => {
        setOpen(false)
        await setProjectTaskGoalRoutingMode(projectId, nextMode)
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="target" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Task goal routing')}</Text>
            <View style={localStyles.buttonContainer}>
                <Popover
                    content={
                        <View style={[localStyles.popover, applyPopoverWidth()]}>
                            <Text style={localStyles.popoverTitle}>{translate('Task goal routing')}</Text>
                            {OPTIONS.map(option => (
                                <TouchableOpacity
                                    key={option.mode}
                                    style={localStyles.option}
                                    onPress={() => selectMode(option.mode)}
                                >
                                    <View style={localStyles.optionText}>
                                        <Text style={localStyles.optionTitle}>{translate(option.title)}</Text>
                                        <Text style={localStyles.optionDescription}>
                                            {translate(option.description)}
                                        </Text>
                                    </View>
                                    {option.mode === currentMode && (
                                        <Icon name="check" size={20} color={colors.UtilityGreen200} />
                                    )}
                                </TouchableOpacity>
                            ))}
                            <Text style={localStyles.costNote}>{translate('Uses Gold for each classified task')}</Text>
                        </View>
                    }
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align="end"
                    onClickOutside={() => setOpen(false)}
                    contentLocation={smallScreen ? null : undefined}
                >
                    <Button
                        title={translate(currentOption.title)}
                        icon="target"
                        type="ghost"
                        onPress={() => setOpen(true)}
                        disabled={disabled}
                    />
                </Popover>
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
    buttonContainer: {
        marginLeft: 'auto',
    },
    popover: {
        width: 360,
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    popoverTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginBottom: 8,
    },
    option: {
        minHeight: 64,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    optionText: {
        flex: 1,
        paddingRight: 12,
    },
    optionTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    optionDescription: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 2,
    },
    costNote: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 8,
    },
})
