import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import {
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_NONE,
    TASK_PRIORITY_SHOULD_DO,
    getTaskPriorityLabel,
    normalizeTaskPriority,
} from '../../../../utils/TaskPriority'
import { getTaskPriorityColors } from '../../../TaskListView/Utils/TaskPriorityPresentation'

const PRIORITY_OPTIONS = [TASK_PRIORITY_MUST_DO, TASK_PRIORITY_SHOULD_DO, TASK_PRIORITY_COULD_DO, TASK_PRIORITY_NONE]

export default function TaskPriorityModal({ priority, setPriority, closeModal }) {
    const [, height] = useWindowSize()
    const smallScreen = useSelector(state => state.smallScreen)
    const selectedPriority = normalizeTaskPriority(priority)

    const selectPriority = selected => {
        if (selected !== selectedPriority) setPriority(selected)
        closeModal()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Select priority')}
                    description={translate('Choose how important this task is')}
                />
                <View style={localStyles.options}>
                    {PRIORITY_OPTIONS.map(option => {
                        const selected = option === selectedPriority
                        const priorityColors = getTaskPriorityColors(option)
                        return (
                            <TouchableOpacity
                                key={option}
                                style={[localStyles.option, selected && localStyles.selectedOption]}
                                onPress={() => selectPriority(option)}
                            >
                                <View
                                    style={[
                                        localStyles.priorityIcon,
                                        { backgroundColor: priorityColors.backgroundColor },
                                    ]}
                                >
                                    <Icon name={'flag'} size={18} color={priorityColors.foregroundColor} />
                                </View>
                                <Text style={localStyles.optionText}>{translate(getTaskPriorityLabel(option))}</Text>
                                {selected && (
                                    <Icon
                                        name={'check'}
                                        size={24}
                                        color={'white'}
                                        style={[localStyles.check, smallScreen && localStyles.checkSmall]}
                                    />
                                )}
                            </TouchableOpacity>
                        )
                    })}
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    options: {
        marginHorizontal: -8,
    },
    option: {
        minHeight: 48,
        padding: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    selectedOption: {
        backgroundColor: '#1e2a51',
        borderRadius: 4,
    },
    priorityIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionText: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 12,
    },
    check: {
        marginLeft: 'auto',
        marginRight: 11,
    },
    checkSmall: {
        marginRight: 3,
    },
})
