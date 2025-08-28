import React from 'react'
import Hotkeys from 'react-hot-keys'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles from '../styles/global'
import Icon from '../Icon'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'
import OptionShortcutCaption from './OptionShortcutCaption'

export default function ChangeNextStep({ currentStep, openWorkFlowSelection }) {
    const inOpen = currentStep === OPEN_STEP

    const shortcutText = '3'
    const text = translate(inOpen ? 'Select next step' : 'Change workflow step')

    return (
        <Hotkeys keyName={shortcutText} onKeyDown={openWorkFlowSelection} filter={e => true}>
            <TouchableOpacity style={localStyles.estimation} onPress={openWorkFlowSelection}>
                <Icon name="next-workflow" size={24} color="white" />
                <Text style={localStyles.uploadText}>{text}</Text>
                <OptionShortcutCaption text={shortcutText} />
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
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
})
