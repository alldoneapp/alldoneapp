import React, { useState } from 'react'
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
    micModeOptions,
    readMicModeSetting,
    writeMicModeSetting,
} from '../../../../hooks/rambleMicCapture'

/**
 * Settings → Customizations: how dictation captures the microphone (AT-2357).
 *
 * Stored in localStorage rather than on the user doc on purpose — it describes THIS machine's audio
 * hardware, so the same account on a phone has no reason to inherit a laptop's workaround. That is
 * also why it is plain local state here instead of redux: nothing else in the app reads it, and it
 * cannot change behind this row's back while Settings is open.
 *
 * "Automatic" is the self-correcting path: it detects a microphone that hands the browser digital
 * silence, switches that recording to unprocessed capture, and forgets the switch again when the
 * audio devices change. The two explicit modes exist so the user can overrule it in either
 * direction — the workaround costs noise suppression and auto gain, and must be refusable.
 */
export default function DictationMicrophone() {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState(() => readMicModeSetting())
    const [workaroundActive, setWorkaroundActive] = useState(() => isWorkaroundActive())

    const currentOption = micModeOptions.find(option => option.value === mode) || micModeOptions[0]
    // Automatic is silent by design, so without this the user cannot tell it ever did anything.
    const currentLabel =
        mode === MIC_MODE_AUTO && workaroundActive
            ? `${translate(currentOption.label)} (${translate('compatibility in use')})`
            : translate(currentOption.label)

    const onSelect = value => {
        writeMicModeSetting(value)
        setMode(readMicModeSetting())
        setWorkaroundActive(isWorkaroundActive())
        setOpen(false)
    }

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
                                    'Some microphones record silence with browser audio processing on. Automatic detects that and turns it off for you.'
                                )}
                            </Text>
                            {micModeOptions.map(option => {
                                const selected = option.value === currentOption.value

                                return (
                                    <TouchableOpacity
                                        key={option.value}
                                        style={localStyles.optionItem}
                                        onPress={() => onSelect(option.value)}
                                    >
                                        <Text style={[styles.subtitle1, localStyles.optionText]}>
                                            {translate(option.label)}
                                        </Text>
                                        {selected && <Icon name={'check'} size={20} color={'#ffffff'} />}
                                    </TouchableOpacity>
                                )
                            })}
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
                            // Re-read on open: automatic may have learned something since mount.
                            setMode(readMicModeSetting())
                            setWorkaroundActive(isWorkaroundActive())
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
})
