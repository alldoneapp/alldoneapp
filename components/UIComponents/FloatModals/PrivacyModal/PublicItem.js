import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function PublicItem({ selected, hovered, onPress }) {
    return (
        <TouchableOpacity onPress={e => onPress(e)}>
            <View style={[localStyles.elementItem, (hovered || selected) && localStyles.itemSelected]}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                        name={'unlock'}
                        size={24}
                        color={selected ? colors.Primary100 : '#ffffff'}
                        style={{ marginHorizontal: 4 }}
                    />
                    <View style={localStyles.itemTexts}>
                        <Text
                            style={[styles.subtitle1, localStyles.itemName, selected && localStyles.itemNameSelected]}
                            numberOfLines={1}
                        >
                            {translate('Public')}
                        </Text>
                        <Text
                            style={[
                                styles.caption1,
                                localStyles.itemSubName,
                                selected && localStyles.itemSubNameSelected,
                            ]}
                            numberOfLines={1}
                        >
                            {translate('anybody with link can see')}
                        </Text>
                    </View>
                </View>
                {selected ? <Icon name="check" size={24} color="white" /> : <View style={{ width: 24, height: 24 }} />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    elementItem: {
        height: 48,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    itemSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginLeft: -8,
        paddingLeft: 8,
        marginRight: -8,
        paddingRight: 8,
    },
    itemTexts: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    itemName: {
        color: '#ffffff',
        marginLeft: 8,
    },
    itemSubName: {
        color: colors.Text04,
        marginLeft: 8,
    },
    itemNameSelected: {
        color: colors.Primary100,
    },
    itemSubNameSelected: {
        color: colors.Primary300,
    },
})
