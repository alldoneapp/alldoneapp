import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { getEstimationIconByValue } from '../../utils/EstimationHelper'
import { translate } from '../../i18n/TranslationService'
import OptionShortcutCaption from './OptionShortcutCaption'

export default function ChangeAssigneeEstimation({ estimations, projectId, openAssigneeEstimationModal }) {
    const icon = `count-circle-${getEstimationIconByValue(projectId, estimations[OPEN_STEP])}`
    const shortcutText = '2'

    return (
        <View style={localStyles.container}>
            <Hotkeys keyName={shortcutText} onKeyDown={openAssigneeEstimationModal} filter={e => true}>
                <TouchableOpacity style={localStyles.estimation} onPress={openAssigneeEstimationModal}>
                    <Icon name={icon} size={24} color="white" />
                    <Text style={localStyles.uploadText}>{translate('Change estimation')}</Text>
                    <OptionShortcutCaption text={shortcutText} />
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    uploadText: {
        ...styles.subtitle1,
        color: 'white',
        marginLeft: 8,
    },
    estimation: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    estimationSection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    userImage: {
        marginLeft: 8,
        backgroundColor: undefined,
    },
})
