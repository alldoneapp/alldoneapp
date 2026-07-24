import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'
import { setUserAutoPostponeAfterDaysOverdue } from '../../../utils/backends/Users/usersFirestore'
import {
    autoPostponeAfterDaysOverdueOptions,
    AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER,
    formatAutoPostponeAfterDaysOverdue,
    normalizeAutoPostponeAfterDaysOverdue,
} from '../../SettingsView/Customizations/Properties/autoPostponeAfterDaysOverdueHelper'

export default function AutoPostponeAfterDaysOverdueModal({ userId, autoPostponeAfterDaysOverdue, closePopover }) {
    const [width, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const currentValue = normalizeAutoPostponeAfterDaysOverdue(autoPostponeAfterDaysOverdue)

    const onSelectValue = (value, event) => {
        if (event != null) {
            event.preventDefault()
            event.stopPropagation()
        }

        setUserAutoPostponeAfterDaysOverdue(userId, value)
        closePopover()
    }

    const renderItem = option => {
        const isSelected = option.value === currentValue
        const { textKey, interpolations } = formatAutoPostponeAfterDaysOverdue(option.value)
        const label = translate(textKey, interpolations)

        return (
            <View key={option.shortcut}>
                <Hotkeys
                    key={option.shortcut}
                    keyName={option.shortcut}
                    onKeyDown={(shortcut, event) => onSelectValue(option.value, event)}
                    filter={e => true}
                >
                    <TouchableOpacity style={localStyles.item} onPress={event => onSelectValue(option.value, event)}>
                        <View style={localStyles.item}>
                            <View style={localStyles.itemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{label}</Text>
                                {option.value !== AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER && (
                                    <Text style={[styles.subtitle1, { color: colors.Text03 }]}>
                                        {' • '}
                                        {translate('Auto-remind overdue tasks after this many full days')}
                                    </Text>
                                )}
                            </View>
                            <View style={localStyles.itemCheck}>
                                {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                {!mobile && (
                                    <Shortcut
                                        text={option.shortcut}
                                        theme={SHORTCUT_LIGHT}
                                        containerStyle={{ marginLeft: 4 }}
                                    />
                                )}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Hotkeys keyName={'esc'} onKeyDown={closePopover} filter={e => true}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>
                            {translate('Auto-Postpone after days overdue')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate(
                                'At midnight in your timezone, overdue tasks at or past this threshold are auto-reminded'
                            )}
                        </Text>
                    </View>
                </Hotkeys>

                {autoPostponeAfterDaysOverdueOptions.map(renderItem)}

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
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
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    item: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    itemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    itemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
