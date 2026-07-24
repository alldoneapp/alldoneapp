import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import styles from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import {
    generateAssistantDelegationDescription,
    getAssistantDelegationDescriptionStatus,
    updateAssistantDelegationDescriptionManual,
} from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function AssistantDelegationDescriptionModal({
    disabled,
    projectId,
    assistant,
    status,
    closeModal,
    onUpdated,
}) {
    const appLanguage = useSelector(state => state.loggedUser?.language) || 'en'
    const [descriptionText, setDescriptionText] = useState(
        status?.effectiveDescription || status?.delegationToolDescriptionManual || assistant?.description || ''
    )
    const [isGenerating, setIsGenerating] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [errorText, setErrorText] = useState('')

    const effectiveSource = status?.effectiveSource || 'assistant_description_fallback'
    const isStale = !!status?.isStale

    const sourceText = useMemo(() => {
        if (effectiveSource === 'manual') return translate('Manual')
        return translate('Assistant description fallback')
    }, [effectiveSource])

    const saveDescription = async () => {
        try {
            setErrorText('')
            setIsSaving(true)
            await updateAssistantDelegationDescriptionManual(projectId, assistant, descriptionText)
            try {
                await onUpdated?.()
            } catch (refreshError) {
                console.error('Error refreshing delegation description after save:', refreshError)
            }
            closeModal?.()
        } catch (error) {
            console.error('Error saving delegation description:', error)
            setErrorText(error?.message || translate('Error saving delegation description'))
        } finally {
            setIsSaving(false)
        }
    }

    const resetToDefault = async () => {
        try {
            setErrorText('')
            setIsSaving(true)
            await updateAssistantDelegationDescriptionManual(projectId, assistant, '')
            await onUpdated?.()
            const refreshedStatus = await getAssistantDelegationDescriptionStatus(projectId, assistant.uid)
            setDescriptionText(
                refreshedStatus?.effectiveDescription ||
                    refreshedStatus?.delegationToolDescriptionManual ||
                    assistant?.description ||
                    ''
            )
        } catch (error) {
            console.error('Error resetting delegation description:', error)
            setErrorText(error?.message || translate('Error saving delegation description'))
        } finally {
            setIsSaving(false)
        }
    }

    const generate = async () => {
        try {
            setErrorText('')
            setIsGenerating(true)
            const result = await generateAssistantDelegationDescription(projectId, assistant.uid, appLanguage)
            if (result?.effectiveDescription) {
                setDescriptionText(result.effectiveDescription)
            } else if (result?.delegationToolDescriptionManual) {
                setDescriptionText(result.delegationToolDescriptionManual)
            }
            await onUpdated?.()
        } catch (error) {
            console.error('Error generating delegation description:', error)
            setErrorText(error?.message || translate('Error generating delegation description'))
        } finally {
            setIsGenerating(false)
        }
    }

    const processing = isGenerating || isSaving

    return (
        <View style={localStyles.container}>
            <ModalHeader
                title={translate('Delegation tool description')}
                description={translate('Delegation description modal helper')}
                closeModal={closeModal}
            />

            <Text style={localStyles.metaText}>
                {translate('Source')}: {sourceText}
            </Text>

            {isStale && <Text style={localStyles.staleText}>{translate('Delegation description stale hint')}</Text>}

            <Text style={localStyles.label}>{translate('Delegation tool description')}</Text>
            <TextInput
                value={descriptionText}
                onChangeText={setDescriptionText}
                editable={!disabled && !processing}
                multiline={true}
                placeholder={translate('Delegation manual placeholder')}
                placeholderTextColor={colors.Text03}
                style={localStyles.inputContainer}
            />

            {!!errorText && <Text style={localStyles.errorText}>{errorText}</Text>}

            <View style={localStyles.actions}>
                <Button
                    type="ghost"
                    title={translate('Reset to default description')}
                    onPress={resetToDefault}
                    disabled={disabled || processing}
                    buttonStyle={localStyles.actionButton}
                />
                <Button
                    type="ghost"
                    title={translate('Generate')}
                    onPress={generate}
                    disabled={disabled || isSaving}
                    processing={isGenerating}
                    processingTitle={translate('Loading')}
                    buttonStyle={localStyles.actionButton}
                />
                <Button
                    type="primary"
                    title={translate('Save')}
                    onPress={saveDescription}
                    disabled={disabled || isGenerating}
                    processing={isSaving}
                    processingTitle={translate('Saving')}
                    buttonStyle={localStyles.actionButton}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 640,
        maxWidth: 720,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 12,
        marginBottom: 4,
    },
    metaText: {
        ...styles.caption,
        color: colors.Text03,
        marginBottom: 4,
    },
    staleText: {
        ...styles.caption,
        color: '#F5C26B',
        marginBottom: 8,
    },
    inputContainer: {
        ...styles.body1,
        color: '#ffffff',
        minHeight: 120,
        maxHeight: 220,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        textAlignVertical: 'top',
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 12,
    },
    actionButton: {
        marginLeft: 8,
    },
    errorText: {
        ...styles.caption,
        color: '#FF8F8F',
        marginTop: 8,
    },
})
