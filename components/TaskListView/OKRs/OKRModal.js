import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomScrollView from '../../UIControls/CustomScrollView'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import { createOKR, deleteOKR, updateOKR } from '../../../utils/backends/OKRs/okrsFirestore'
import {
    OKR_CADENCE_DAILY,
    OKR_CADENCE_MONTHLY,
    OKR_CADENCE_QUARTERLY,
    OKR_CADENCE_WEEKLY,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    formatOkrValue,
    getOkrPeriodForCadence,
    normalizeOkrNumber,
    normalizeOkrType,
} from './okrHelper'
import useOkrRevenueValue from './useOkrRevenueValue'

const CADENCE_OPTIONS = [OKR_CADENCE_DAILY, OKR_CADENCE_WEEKLY, OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY]
const TYPE_OPTIONS = [OKR_TYPE_MANUAL, OKR_TYPE_TIME_LOGGED_REVENUE]

export default function OKRModal({ projectId, okr, closePopover }) {
    const [, height] = useWindowSize()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const editing = !!okr
    const [type, setType] = useState(okr ? normalizeOkrType(okr.type) : OKR_TYPE_MANUAL)
    const [label, setLabel] = useState(okr ? okr.label : '')
    const [currentValue, setCurrentValue] = useState(okr ? `${okr.currentValue}` : '0')
    const [targetValue, setTargetValue] = useState(okr ? `${okr.targetValue}` : '')
    const [unit, setUnit] = useState(okr ? okr.unit : '')
    const [cadence, setCadence] = useState(okr ? okr.cadence : OKR_CADENCE_MONTHLY)
    const [saving, setSaving] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
    const revenueOkr = type === OKR_TYPE_TIME_LOGGED_REVENUE
    const previewPeriod = useMemo(() => {
        if (editing && cadence === okr.cadence) {
            return { periodStart: okr.periodStart, periodEnd: okr.periodEnd }
        }
        return getOkrPeriodForCadence(cadence)
    }, [cadence, editing, okr])
    const revenueValue = useOkrRevenueValue({
        projectId,
        ownerId: revenueOkr ? okr?.ownerId || currentUserId : null,
        periodStart: previewPeriod.periodStart,
        periodEnd: previewPeriod.periodEnd,
    })

    const currentNumber = normalizeOkrNumber(currentValue, NaN)
    const targetNumber = normalizeOkrNumber(targetValue, NaN)
    const canSave =
        label.trim() &&
        (revenueOkr || (Number.isFinite(currentNumber) && currentNumber >= 0)) &&
        Number.isFinite(targetNumber) &&
        targetNumber > 0

    const save = async () => {
        if (!canSave || saving || confirmingDelete) return
        setSaving(true)
        try {
            if (editing) {
                await updateOKR(projectId, okr, {
                    label,
                    type,
                    currentValue: revenueOkr ? 0 : currentNumber,
                    targetValue: targetNumber,
                    unit: revenueOkr ? revenueValue.currency : unit,
                    cadence,
                })
            } else {
                await createOKR(projectId, {
                    label,
                    type,
                    currentValue: revenueOkr ? 0 : currentNumber,
                    targetValue: targetNumber,
                    unit: revenueOkr ? revenueValue.currency : unit,
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

                <Text style={localStyles.label}>{translate('OKR type')}</Text>
                <OKRTypeDropdown
                    type={type}
                    setType={setType}
                    isOpen={typeDropdownOpen}
                    setIsOpen={setTypeDropdownOpen}
                />

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
                        {revenueOkr ? (
                            <View style={localStyles.calculatedValue}>
                                <Text style={[styles.body1, localStyles.calculatedValueText]}>
                                    {formatOkrValue(revenueValue.currentValue, revenueValue.currency)}
                                </Text>
                                <Text style={[styles.caption1, localStyles.calculatedValueHint]} numberOfLines={2}>
                                    {translate(
                                        revenueValue.missingHourlyRate
                                            ? 'OKR hourly rate missing'
                                            : 'OKR revenue current value hint'
                                    )}
                                </Text>
                            </View>
                        ) : (
                            <TextInput
                                style={localStyles.input}
                                value={currentValue}
                                onChangeText={setCurrentValue}
                                placeholder="0"
                                placeholderTextColor={colors.Text03}
                                keyboardType="numeric"
                            />
                        )}
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

                {revenueOkr ? (
                    <Text style={[styles.caption1, localStyles.currencyHint]}>
                        {translate('OKR revenue currency hint', { currency: revenueValue.currency })}
                    </Text>
                ) : (
                    <>
                        <Text style={localStyles.label}>{translate('Unit optional')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={unit}
                            onChangeText={setUnit}
                            placeholder={translate('Unit placeholder')}
                            placeholderTextColor={colors.Text03}
                        />
                    </>
                )}

                <Text style={localStyles.label}>{translate('Cadence')}</Text>
                <View style={localStyles.cadenceContainer}>
                    {CADENCE_OPTIONS.map(option => (
                        <View key={option} style={localStyles.cadenceButtonWrapper}>
                            <TouchableOpacity
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
                        </View>
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

function OKRTypeDropdown({ type, setType, isOpen, setIsOpen }) {
    const selectType = option => {
        setType(option)
        setIsOpen(false)
    }

    return (
        <View style={localStyles.typeDropdownWrapper}>
            <TouchableOpacity style={localStyles.typeDropdownButton} onPress={() => setIsOpen(!isOpen)}>
                <Text style={[styles.body1, localStyles.typeDropdownText]} numberOfLines={1}>
                    {translate(`OKR type ${type}`)}
                </Text>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.Text03} />
            </TouchableOpacity>
            {isOpen && (
                <View style={localStyles.typeDropdownMenu}>
                    {TYPE_OPTIONS.map(option => {
                        const selected = option === type
                        return (
                            <TouchableOpacity
                                key={option}
                                style={[localStyles.typeDropdownOption, selected && localStyles.typeDropdownSelected]}
                                onPress={() => selectType(option)}
                            >
                                <Text
                                    style={[
                                        styles.subtitle2,
                                        selected
                                            ? localStyles.typeDropdownSelectedText
                                            : localStyles.typeDropdownOptionText,
                                    ]}
                                >
                                    {translate(`OKR type ${option}`)}
                                </Text>
                                {selected && <Icon name="check" size={16} color="#ffffff" />}
                            </TouchableOpacity>
                        )
                    })}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 9999,
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
    typeDropdownWrapper: {
        zIndex: 3,
    },
    typeDropdownButton: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        marginTop: 4,
    },
    typeDropdownText: {
        color: '#ffffff',
        flex: 1,
        marginRight: 8,
    },
    typeDropdownMenu: {
        position: 'absolute',
        top: 46,
        left: 0,
        right: 0,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        borderWidth: 1,
        borderColor: colors.Grey400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        zIndex: 4,
    },
    typeDropdownOption: {
        minHeight: 40,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    typeDropdownSelected: {
        backgroundColor: colors.Primary100,
    },
    typeDropdownOptionText: {
        color: colors.Text02,
        flex: 1,
        marginRight: 8,
    },
    typeDropdownSelectedText: {
        color: '#ffffff',
        flex: 1,
        marginRight: 8,
    },
    calculatedValue: {
        minHeight: 40,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        justifyContent: 'center',
    },
    calculatedValueText: {
        color: '#ffffff',
    },
    calculatedValueHint: {
        color: colors.Text03,
        marginTop: 2,
    },
    currencyHint: {
        color: colors.Text03,
        marginTop: 8,
    },
    cadenceContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 4,
        marginRight: -8,
        marginBottom: 0,
    },
    cadenceButtonWrapper: {
        marginRight: 8,
        marginBottom: 8,
    },
    cadenceButton: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: colors.Grey400,
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
