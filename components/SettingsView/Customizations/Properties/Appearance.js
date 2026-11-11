import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { setUserColorMode } from '../../../../utils/backends/Users/usersFirestore'
import {
    COLOR_MODE_AUTO,
    COLOR_MODE_DARK,
    COLOR_MODE_LIGHT,
    setColorModePreference,
    useColorMode,
    themed,
} from '../../../../Themes/colorMode'

export const appearanceOptions = [
    { value: COLOR_MODE_AUTO, label: 'Appearance auto', icon: 'monitor' },
    { value: COLOR_MODE_LIGHT, label: 'Appearance light', icon: 'sun' },
    { value: COLOR_MODE_DARK, label: 'Appearance dark', icon: 'moon' },
]

/** Settings row: Auto (follow the device) / Light / Dark. */
export default function Appearance({ userId }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const { preference } = useColorMode()

    const currentOption = appearanceOptions.find(option => option.value === preference) || appearanceOptions[0]

    const select = value => {
        setColorModePreference(value)
        if (userId) setUserColorMode(userId, value)
        setOpen(false)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'moon'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Appearance')}
                </Text>
            </View>

            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <AppPopover
                    content={
                        <View style={localStyles.optionsContainer}>
                            {appearanceOptions.map(option => {
                                const selected = option.value === currentOption.value
                                return (
                                    <TouchableOpacity
                                        key={option.value}
                                        style={localStyles.optionItem}
                                        onPress={() => select(option.value)}
                                        accessibilityRole={'menuitem'}
                                        accessibilityState={{ selected }}
                                    >
                                        <View style={localStyles.optionLabel}>
                                            <Icon
                                                name={option.icon}
                                                size={20}
                                                color={'#ffffff'}
                                                style={{ marginRight: 8 }}
                                            />
                                            <Text style={[styles.subtitle1, localStyles.optionText]}>
                                                {translate(option.label)}
                                            </Text>
                                        </View>
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
                        icon={currentOption.icon}
                        type={'ghost'}
                        title={translate(currentOption.label)}
                        onPress={() => setOpen(true)}
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
    },
    optionsContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        minWidth: 260,
        paddingVertical: 8,
        boxShadow: themed.PopupShadow,
        elevation: 3,
    },
    optionItem: {
        height: 40,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionLabel: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    optionText: {
        color: '#ffffff',
    },
})
