import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import WorkflowTag from './WorkflowTag'
import { translate } from '../../../../i18n/TranslationService'

export default function NextWorkflowOption({
    wasSelectedACustomStep,
    openNextWorkflowStepModal,
    steps,
    selectedNextStep,
    task,
    projectId,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <View style={localStyles.container}>
            <Hotkeys keyName="3" onKeyDown={openNextWorkflowStepModal} filter={e => true}>
                <TouchableOpacity style={localStyles.button} onPress={openNextWorkflowStepModal}>
                    <Icon name="next-workflow" size={24} color="white" />
                    <Text style={localStyles.text}>{translate('Select next step')}</Text>
                    <View style={{ marginLeft: 'auto' }}>
                        {smallScreenNavigation ? (
                            <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                        ) : (
                            <Shortcut text="3" theme={SHORTCUT_LIGHT} />
                        )}
                    </View>
                </TouchableOpacity>
            </Hotkeys>
            {wasSelectedACustomStep && (
                <WorkflowTag projectId={projectId} steps={steps} selectedNextStep={selectedNextStep} task={task} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    button: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: 'white',
        marginLeft: 8,
    },
})
