import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../UIControls/Button'
import BypassWorkflowButton from '../WorkflowModal/BypassWorkflowButton'
import { translate } from '../../i18n/TranslationService'

export default function SuggestedActions({
    isAssistantSuggestion,
    disabled,
    showBypassWorkflow,
    onNextStepPress,
    onAcceptPress,
    onBypassWorkflowPress,
}) {
    return (
        <View testID="suggested-actions">
            <View style={localStyles.buttonsContainer}>
                <Button
                    disabled={disabled}
                    icon="next-workflow"
                    title={translate(isAssistantSuggestion ? 'Reject' : 'Go to next step')}
                    type="secondary"
                    buttonStyle={{ marginRight: 8 }}
                    onPress={onNextStepPress}
                />
                <Button title={translate('Accept')} type={'primary'} onPress={onAcceptPress} />
            </View>
            {showBypassWorkflow && <BypassWorkflowButton disabled={disabled} onPress={onBypassWorkflowPress} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonsContainer: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
})
