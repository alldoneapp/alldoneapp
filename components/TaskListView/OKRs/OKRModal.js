import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomScrollView from '../../UIControls/CustomScrollView'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import { createOKR, deleteOKR, updateOKR } from '../../../utils/backends/OKRs/okrsFirestore'
import { OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY, OKR_CADENCE_WEEKLY, normalizeOkrNumber } from './okrHelper'

const CADENCE_OPTIONS = [OKR_CADENCE_WEEKLY, OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY]

export default function OKRModal({ projectId, okr, closePopover }) {
    const [width, height] = useWindowSize()
    const editing = !!okr
    const [label, setLabel] = useState(okr ? okr.label : '')
    const [currentValue, setCurrentValue] = useState(okr ? `${okr.currentValue}` : '0')
    const [targetValue, setTargetValue] = useState(okr ? `${okr.targetValue}` : '')
    const [unit, setUnit] = useState(okr ? okr.unit : '')
    const [cadence, setCadence] = useState(okr ? okr.cadence : OKR_CADENCE_MONTHLY)
    const [saving, setSaving] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)

    const currentNumber = normalizeOkrNumber(currentValue, NaN)
    const targetNumber = normalizeOkrNumber(targetValue, NaN)
    const canSave =
        label.trim() &&
        Number.isFinite(currentNumber) &&
        currentNumber >= 0 &&
        Number.isFinite(targetNumber) &&
        targetNumber > 0

    const save = async () => {
        if (!canSave || saving || confirmingDelete) return
        setSaving(true)
        try {
            if (editing) {
                await updateOKR(projectId, okr, {
                    label,
                    currentValue: currentNumber,
                    targetValue: targetNumber,
                    unit,
                    cadence,
                })
            } else {
                await createOKR(projectId, {
                    label,
                    currentValue: currentNumber,
                    targetValue: targetNumber,
                    unit,
                    cadence,
                })
            }
            closePopover()
        } finally {
            setSaving(false)
        }
    }

    const remove = async () => {
        if (!editing || saving) return
        setSaving(true)
        try {
            await deleteOKR(projectId, okr.id)
            closePopover()
        } finally {
            setSaving(false)
        }
    }

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onKeyDown = event => {
            if (event.key === 'Escape') closePopover()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [closePopover])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Hotkeys keyName="enter" onKeyDown={save} filter={e => true}>
                    <View style={localStyles.header}>
                        <Text style={[styles.title7, localStyles.title]}>
                            {translate(editing ? 'Edit OKR' : 'Add OKR')}
                        </Text>
                        <Text style={[styles.body2, localStyles.description]}>
                            {translate(editing ? 'Edit measurable project OKR' : 'Create a measurable project OKR')}
                        </Text>
                    </View>
                </Hotkeys>

                <Text style={localStyles.label}>{translate('OKR target label')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={label}
                    onChangeText={setLabel}
                    placeholder={translate('OKR target placeholder')}
                    placeholderTextColor={colors.Text03}
                />

                <View style={localStyles.row}>
                    <View style={localStyles.halfInput}>
                        <Text style={localStyles.label}>{translate('Current value')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={currentValue}
                            onChangeText={setCurrentValue}
                            placeholder="0"
                            placeholderTextColor={colors.Text03}
                            keyboardType="numeric"
                        />
                    </View>
                    <View style={localStyles.halfInput}>
                        <Text style={localStyles.label}>{translate('Target value')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={targetValue}
                            onChangeText={setTargetValue}
                            placeholder="100"
                            placeholderTextColor={colors.Text03}
                            keyboardType="numeric"
                        />
                    </View>
                </View>

                <Text style={localStyles.label}>{translate('Unit optional')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={unit}
                    onChangeText={setUnit}
                    placeholder={translate('Unit placeholder')}
                    placeholderTextColor={colors.Text03}
                />

                <Text style={localStyles.label}>{translate('Cadence')}</Text>
                <View style={localStyles.cadenceContainer}>
                    {CADENCE_OPTIONS.map(option => (
                        <TouchableOpacity
                            key={option}
                            style={[localStyles.cadenceButton, cadence === option && localStyles.selectedCadence]}
                            onPress={() => setCadence(option)}
                        >
                            <Text
                                style={[
                                    styles.subtitle2,
                                    cadence === option ? localStyles.selectedCadenceText : localStyles.cadenceText,
                                ]}
                            >
                                {translate(`OKR cadence ${option}`)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {confirmingDelete && (
                    <View style={localStyles.deleteConfirmation}>
                        <Text style={[styles.body2, localStyles.deleteConfirmationText]}>
                            {translate('Delete OKR confirmation')}
                        </Text>
                        <View style={localStyles.confirmationButtons}>
                            <Button
                                type="secondary"
                                title={translate('Cancel')}
                                onPress={() => setConfirmingDelete(false)}
                                buttonStyle={{ marginRight: 8 }}
                            />
                            <Button type="danger" title={translate('Delete')} onPress={remove} disabled={saving} />
                        </View>
                    </View>
                )}

                <View style={localStyles.buttonContainer}>
                    {editing && !confirmingDelete && (
                        <Button
                            type="danger"
                            title={translate('Delete')}
                            icon="trash-2"
                            onPress={() => setConfirmingDelete(true)}
                            disabled={saving}
                        />
                    )}
                    <View style={localStyles.buttonSpacer} />
                    <Button
                        type="secondary"
                        title={translate('Cancel')}
                        onPress={closePopover}
                        buttonStyle={{ marginRight: 8 }}
                    />
                    <Button
                        type="primary"
                        title={translate(editing ? 'Save' : 'Create')}
                        onPress={save}
                        disabled={!canSave || saving || confirmingDelete}
                    />
                </View>
            </CustomScrollView>
            <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        paddingBottom: 8,
    },
    header: {
        marginBottom: 16,
        paddingRight: 24,
    },
    title: {
        color: '#ffffff',
    },
    description: {
        color: colors.Text03,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
        marginTop: 8,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        height: 40,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingHorizontal: 12,
        outlineStyle: 'none',
    },
    row: {
        flexDirection: 'row',
        marginHorizontal: -4,
    },
    halfInput: {
        flex: 1,
        marginHorizontal: 4,
    },
    cadenceContainer: {
        flexDirection: 'row',
        marginTop: 4,
        marginBottom: 8,
    },
    cadenceButton: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: colors.Grey400,
        marginRight: 8,
        borderRadius: 4,
    },
    selectedCadence: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    cadenceText: {
        color: colors.Text03,
    },
    selectedCadenceText: {
        color: '#ffffff',
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 16,
    },
    buttonSpacer: {
        flex: 1,
    },
    deleteConfirmation: {
        marginTop: 16,
        padding: 12,
        borderRadius: 4,
        backgroundColor: colors.Secondary300,
    },
    deleteConfirmationText: {
        color: colors.Text02,
        marginBottom: 12,
    },
    confirmationButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    closeButton: {
        position: 'absolute',
        right: 8,
        top: 8,
    },
})
