import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import Button from '../../../UIControls/Button'
import Switch from '../../../UIControls/Switch'
import styles, { colors } from '../../../styles/global'
import { copyTextToClipboard } from '../../../../utils/HelperFunctions'
import { getBookingSettings, saveBookingSettings } from '../../../../utils/backends/Booking/bookingFirestore'
import { translate } from '../../../../i18n/TranslationService'

const DEFAULT_SETTINGS = {
    enabled: false,
    slug: '',
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    includeWeekends: false,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
}

const numericFields = new Set(['durationMinutes', 'slotIntervalMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes'])

export default function PublicBookingSettings() {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS)
    const [publicUrl, setPublicUrl] = useState('')
    const [connectedCalendarCount, setConnectedCalendarCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    const loadSettings = async () => {
        try {
            const result = await getBookingSettings()
            setSettings({ ...DEFAULT_SETTINGS, ...(result.settings || {}) })
            setPublicUrl(result.publicUrl || '')
            setConnectedCalendarCount(result.connectedCalendarCount || 0)
        } catch (loadError) {
            console.error('PublicBookingSettings: failed to load settings', loadError)
            setError(loadError.message || translate('Failed to load booking settings'))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadSettings()
    }, [])

    const updateField = (field, value) => {
        setMessage('')
        setError('')
        setSettings(current => ({
            ...current,
            [field]: numericFields.has(field) ? value.replace(/[^0-9]/g, '') : value,
        }))
    }

    const onSave = async () => {
        setSaving(true)
        setMessage('')
        setError('')
        try {
            const result = await saveBookingSettings(settings)
            setSettings({ ...DEFAULT_SETTINGS, ...(result.settings || {}) })
            setPublicUrl(result.publicUrl || '')
            setConnectedCalendarCount(result.connectedCalendarCount || 0)
            setMessage(translate('Booking settings saved'))
        } catch (saveError) {
            console.error('PublicBookingSettings: failed to save settings', saveError)
            setError(saveError.message || translate('Failed to save booking settings'))
        } finally {
            setSaving(false)
        }
    }

    const disabledByCalendar = connectedCalendarCount === 0
    const switchDisabled = loading || (!settings.enabled && disabledByCalendar)

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerRow}>
                <View style={localStyles.headerText}>
                    <Text style={localStyles.title}>{translate('Public booking link')}</Text>
                    <Text style={localStyles.description}>
                        {translate('Public booking link description')}
                    </Text>
                </View>
                <Switch
                    active={settings.enabled}
                    activeSwitch={() => updateField('enabled', true)}
                    deactiveSwitch={() => updateField('enabled', false)}
                    disabled={switchDisabled}
                />
            </View>

            {loading ? (
                <Text style={localStyles.meta}>{translate('Loading booking settings')}</Text>
            ) : (
                <>
                    {disabledByCalendar && (
                        <Text style={localStyles.warning}>
                            {translate('Connect calendar before enabling booking link')}
                        </Text>
                    )}
                    <View style={localStyles.grid}>
                        <LabeledInput
                            label={translate('Link slug')}
                            value={settings.slug}
                            onChangeText={v => updateField('slug', v)}
                        />
                        <LabeledInput
                            label={translate('Duration minutes')}
                            value={String(settings.durationMinutes)}
                            onChangeText={v => updateField('durationMinutes', v)}
                        />
                        <LabeledInput
                            label={translate('Slot interval minutes')}
                            value={String(settings.slotIntervalMinutes)}
                            onChangeText={v => updateField('slotIntervalMinutes', v)}
                        />
                        <LabeledInput
                            label={translate('Work starts')}
                            value={settings.workingHoursStart}
                            onChangeText={v => updateField('workingHoursStart', v)}
                        />
                        <LabeledInput
                            label={translate('Work ends')}
                            value={settings.workingHoursEnd}
                            onChangeText={v => updateField('workingHoursEnd', v)}
                        />
                        <LabeledInput
                            label={translate('Buffer before')}
                            value={String(settings.bufferBeforeMinutes)}
                            onChangeText={v => updateField('bufferBeforeMinutes', v)}
                        />
                        <LabeledInput
                            label={translate('Buffer after')}
                            value={String(settings.bufferAfterMinutes)}
                            onChangeText={v => updateField('bufferAfterMinutes', v)}
                        />
                    </View>

                    <View style={localStyles.weekendRow}>
                        <Text style={localStyles.label}>{translate('Include weekends')}</Text>
                        <Switch
                            active={settings.includeWeekends}
                            activeSwitch={() => updateField('includeWeekends', true)}
                            deactiveSwitch={() => updateField('includeWeekends', false)}
                        />
                    </View>

                    {!!publicUrl && settings.enabled && (
                        <View style={localStyles.linkRow}>
                            <Text style={localStyles.linkText} numberOfLines={1}>
                                {publicUrl}
                            </Text>
                            <Button
                                title={translate('Copy')}
                                type="ghost"
                                onPress={() => {
                                    copyTextToClipboard(publicUrl)
                                    setMessage(translate('Link copied'))
                                }}
                            />
                        </View>
                    )}

                    {!!error && <Text style={localStyles.error}>{error}</Text>}
                    {!!message && <Text style={localStyles.success}>{message}</Text>}

                    <Button
                        title={translate('Save booking settings')}
                        onPress={onSave}
                        processing={saving}
                        processingTitle={translate('Saving')}
                        disabled={saving}
                        buttonStyle={localStyles.saveButton}
                    />
                </>
            )}
        </View>
    )
}

function LabeledInput({ label, value, onChangeText }) {
    return (
        <View style={localStyles.inputWrap}>
            <Text style={localStyles.label}>{label}</Text>
            <TextInput value={value} onChangeText={onChangeText} style={localStyles.input} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    headerText: {
        flex: 1,
        paddingRight: 16,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 12,
    },
    warning: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginTop: 12,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 16,
        marginHorizontal: -6,
    },
    inputWrap: {
        width: 180,
        marginHorizontal: 6,
        marginBottom: 12,
    },
    label: {
        ...styles.caption2,
        color: colors.Text03,
        marginBottom: 4,
    },
    input: {
        height: 40,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        paddingHorizontal: 10,
        color: colors.Text01,
        backgroundColor: '#FFFFFF',
    },
    weekendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
    },
    linkText: {
        ...styles.body2,
        flex: 1,
        color: colors.Text02,
        marginRight: 12,
    },
    error: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginTop: 12,
    },
    success: {
        ...styles.body2,
        color: colors.UtilityGreen200,
        marginTop: 12,
    },
    saveButton: {
        alignSelf: 'flex-start',
        marginTop: 16,
    },
})
