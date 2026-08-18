import React, { useCallback, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import {
    MIC_MODE_AUTO,
    isWorkaroundActive,
    listAudioInputDevices,
    micModeOptions,
    readLearnedInputDevice,
    readMicModeSetting,
    readPreferredInputDevice,
    writeMicModeSetting,
    writePreferredInputDevice,
} from '../../../../hooks/rambleMicCapture'

/**
 * Settings → Customizations: which microphone dictation records from, and how it captures it
 * (AT-2357).
 *
 * Stored in localStorage rather than on the user doc on purpose — it describes THIS machine's audio
 * hardware, so the same account on a phone has no reason to inherit a laptop's workaround. That is
 * also why it is plain local state here instead of redux: nothing else in the app reads it, and it
 * cannot change behind this row's back while Settings is open.
 *
 * The DEVICE list exists because a browser keeps its own microphone preference, separate from the
 * system input source, and a web page can neither read nor change it. When that preference points at
 * the wrong microphone — the reported case: Chrome recording the built-in mic while macOS was set to
 * a webcam — an explicit choice here is the only thing that can override it.
 *
 * "Automatic" is the self-correcting path: it detects a microphone that hands the browser digital
 * silence, switches that recording to unprocessed capture, moves to another input if the device is
 * dead either way, and forgets both again when the audio devices change. The explicit options exist
 * so the user can overrule it in either direction — the workaround costs noise suppression and auto
 * gain, and an automatic device switch must be refusable.
 */

export const SYSTEM_DEFAULT_OPTION_LABEL = 'System default (chosen by the browser)'

// Enough to recognise a device, short enough not to blow up a settings row.
const MAX_LABEL_CHARS = 28

export function shortenDeviceLabel(label) {
    const text = String(label || '').trim()
    if (text.length <= MAX_LABEL_CHARS) return text
    return `${text.slice(0, MAX_LABEL_CHARS - 1)}…`
}

export default function DictationMicrophone() {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState(() => readMicModeSetting())
    const [workaroundActive, setWorkaroundActive] = useState(() => isWorkaroundActive())
    const [preferred, setPreferred] = useState(() => readPreferredInputDevice())
    const [learnedDevice, setLearnedDevice] = useState(() => readLearnedInputDevice())
    const [devices, setDevices] = useState([])
    const [permissionAsked, setPermissionAsked] = useState(false)

    const currentOption = micModeOptions.find(option => option.value === mode) || micModeOptions[0]

    // Deliberately synchronous: everything here is a localStorage read, and a selection must be
    // reflected in the same commit as the click. Device enumeration is the only async part and is
    // kept separate so it can never delay the visible state.
    const refresh = useCallback(() => {
        setMode(readMicModeSetting())
        setWorkaroundActive(isWorkaroundActive())
        setPreferred(readPreferredInputDevice())
        setLearnedDevice(readLearnedInputDevice())
    }, [])

    const refreshDevices = useCallback(async () => {
        setDevices(await listAudioInputDevices())
    }, [])

    // Labels stay empty until microphone permission has been granted once, so an un-prompted browser
    // would show a list of anonymous entries. Asking is opt-in rather than a prompt on open.
    const requestDeviceLabels = useCallback(async () => {
        setPermissionAsked(true)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(track => track.stop())
        } catch (error) {
            // Denied or unavailable: the list stays anonymous, which is still selectable.
        }
        setDevices(await listAudioInputDevices())
    }, [])

    const onSelectMode = value => {
        writeMicModeSetting(value)
        refresh()
        setOpen(false)
    }

    const onSelectDevice = device => {
        writePreferredInputDevice(device)
        refresh()
        setOpen(false)
    }

    // What the row says at a glance: the device first (it is the thing that goes wrong), then any
    // mode that is not the default, then whether Automatic has actually switched something —
    // otherwise the automatic path is completely invisible.
    const deviceLabel = preferred
        ? shortenDeviceLabel(preferred.label) || translate('Selected microphone')
        : translate(SYSTEM_DEFAULT_OPTION_LABEL)
    const suffixes = []
    if (mode !== MIC_MODE_AUTO) suffixes.push(translate(currentOption.label))
    if (mode === MIC_MODE_AUTO && workaroundActive) suffixes.push(translate('compatibility in use'))
    if (!preferred && learnedDevice) suffixes.push(shortenDeviceLabel(learnedDevice.label))
    const currentLabel = suffixes.length ? `${deviceLabel} (${suffixes.join(', ')})` : deviceLabel

    const namedDevices = devices.filter(device => device.deviceId)
    const hasLabels = namedDevices.some(device => device.label)

    const renderOption = (key, label, selected, onPress) => (
        <TouchableOpacity key={key} style={localStyles.optionItem} onPress={onPress}>
            <Text style={[styles.subtitle1, localStyles.optionText]} numberOfLines={2}>
                {label}
            </Text>
            {selected && <Icon name={'check'} size={20} color={'#ffffff'} />}
        </TouchableOpacity>
    )

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'mic'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Dictation microphone')}
                </Text>
            </View>

            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <AppPopover
                    content={
                        <View style={localStyles.optionsContainer}>
                            <Text style={[styles.body2, localStyles.helpText]}>
                                {translate(
                                    'Your browser keeps its own microphone choice, which can differ from the input selected in your system settings. Pick the device to record from here.'
                                )}
                            </Text>

                            <Text style={[styles.caption1, localStyles.sectionLabel]}>{translate('Microphone')}</Text>
                            {renderOption('system-default', translate(SYSTEM_DEFAULT_OPTION_LABEL), !preferred, () =>
                                onSelectDevice(null)
                            )}
                            {namedDevices.map((device, index) =>
                                renderOption(
                                    device.deviceId,
                                    device.label || `${translate('Microphone')} ${index + 1}`,
                                    preferred?.deviceId === device.deviceId,
                                    () => onSelectDevice({ deviceId: device.deviceId, label: device.label })
                                )
                            )}
                            {!hasLabels && !permissionAsked && (
                                <TouchableOpacity style={localStyles.optionItem} onPress={requestDeviceLabels}>
                                    <Text style={[styles.subtitle1, localStyles.linkText]}>
                                        {translate('Show my microphones')}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            <View style={localStyles.divider} />

                            <Text style={[styles.caption1, localStyles.sectionLabel]}>
                                {translate('Audio processing')}
                            </Text>
                            {micModeOptions.map(option =>
                                renderOption(
                                    option.value,
                                    translate(option.label),
                                    option.value === currentOption.value,
                                    () => onSelectMode(option.value)
                                )
                            )}
                        </View>
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={'edit-2'}
                        type={'ghost'}
                        title={currentLabel}
                        onPress={() => {
                            // Re-read on open: automatic may have learned something since mount, and
                            // devices come and go while Settings stays mounted.
                            refresh()
                            refreshDevices()
                            setOpen(true)
                        }}
                    />
                </AppPopover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
        maxWidth: '65%',
    },
    optionsContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        minWidth: 300,
        maxWidth: 340,
        paddingVertical: 8,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    helpText: {
        color: colors.Text03,
        paddingHorizontal: 12,
        paddingBottom: 8,
    },
    sectionLabel: {
        color: colors.Text03,
        paddingHorizontal: 12,
        paddingTop: 4,
        paddingBottom: 2,
        textTransform: 'uppercase',
    },
    divider: {
        height: 1,
        backgroundColor: colors.Grey300,
        marginVertical: 8,
    },
    optionItem: {
        minHeight: 40,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionText: {
        color: '#ffffff',
        flexShrink: 1,
        marginRight: 8,
    },
    linkText: {
        color: colors.Primary100,
        flexShrink: 1,
        marginRight: 8,
    },
})
