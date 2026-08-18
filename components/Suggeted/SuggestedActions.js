import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../UIControls/Button'
import BypassWorkflowButton from '../WorkflowModal/BypassWorkflowButton'
import { translate } from '../../i18n/TranslationService'

export default function SuggestedActions({
    isAssistantSuggestion,
    disabled,
    showBypassWorkflow,
    bypassWorkflowLabel,
    onNextStepPress,
    onAcceptPress,
    onBypassWorkflowPress,
}) {
    return (
        <View testID="suggested-actions">
            <View testID="suggested-actions-buttons" style={localStyles.buttonsContainer}>
                <Button
                    disabled={disabled}
                    // The icon has to follow the label: rejecting an assistant suggestion is not a
                    // workflow step, so it gets the plain "x" that pairs with the accept action
                    // (AT-2210). Handing a human suggestion on really is a workflow move.
                    icon={isAssistantSuggestion ? 'x' : 'next-workflow'}
                    title={translate(isAssistantSuggestion ? 'Reject' : 'Go to next step')}
                    type="secondary"
                    buttonStyle={{ marginRight: 8 }}
                    onPress={onNextStepPress}
                />
                <Button title={translate('Accept')} type={'primary'} onPress={onAcceptPress} />
            </View>
            {showBypassWorkflow && (
                <BypassWorkflowButton disabled={disabled} label={bypassWorkflowLabel} onPress={onBypassWorkflowPress} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonsContainer: {
        // Same 72px row as the workflow modal, but with both paddings stated explicitly so
        // the bypass link below keeps the identical 24px of separation from the buttons
        // even if they grow taller (AT-2354).
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
        paddingBottom: 16,
    },
})
