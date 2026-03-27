import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { sidebarNavigationModeOptions } from '../../../../utils/SidebarNavigationModes'
import { setUserSidebarNavigationMode } from '../../../../utils/backends/Users/usersFirestore'

export default function SidebarNavigation({ userId, sidebarNavigationMode }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    const currentOption =
        sidebarNavigationModeOptions.find(option => option.value === sidebarNavigationMode) ||
        sidebarNavigationModeOptions[0]

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'list'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Sidebar navigation')}
                </Text>
            </View>

            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <View style={localStyles.optionsContainer}>
                            {sidebarNavigationModeOptions.map(option => {
                                const selected = option.value === currentOption.value

                                return (
                                    <TouchableOpacity
                                        key={option.value}
                                        style={localStyles.optionItem}
                                        onPress={() => {
                                            setUserSidebarNavigationMode(userId, option.value)
                                            setOpen(false)
                                        }}
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
                        title={translate(currentOption.label)}
                        onPress={() => setOpen(true)}
                    />
                </Popover>
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    optionItem: {
        height: 40,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionText: {
        color: '#ffffff',
    },
})
