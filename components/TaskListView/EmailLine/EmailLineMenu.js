import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

// The small dark menu behind the Email line's gear icon: hide the line for the
// rest of the day, or jump to Settings > Integrations. "Done for today" is
// undone via "Show email line" in the All Projects "..." menu.
export default function EmailLineMenu({ closePopover, onDoneForToday, onOpenIntegrations }) {
    const runAndClose = action => () => {
        closePopover()
        action()
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity
                style={localStyles.item}
                onPress={runAndClose(onDoneForToday)}
                accessibilityLabel={translate('Done for today')}
            >
                <Icon name="check" size={16} color="#ffffff" style={localStyles.itemIcon} />
                <Text style={[styles.subtitle2, localStyles.itemText]}>{translate('Done for today')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={localStyles.item}
                onPress={runAndClose(onOpenIntegrations)}
                accessibilityLabel={translate('Integrations')}
            >
                <Icon name="settings" size={16} color="#ffffff" style={localStyles.itemIcon} />
                <Text style={[styles.subtitle2, localStyles.itemText]}>{translate('Integrations')}</Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 8,
        minWidth: 200,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    item: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    itemIcon: {
        marginRight: 8,
    },
    itemText: {
        color: '#ffffff',
    },
})
