import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import Icon from '../../Icon'
import { PROJECT_COLOR_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import {
    PROJECT_COLOR_BLUE,
    PROJECT_COLOR_DEFAULT,
    PROJECT_COLOR_GREEN,
    PROJECT_COLOR_LIME,
    PROJECT_COLOR_ORANGE,
    PROJECT_COLOR_PELOROUS,
    PROJECT_COLOR_PINK,
    PROJECT_COLOR_PURPLE,
    PROJECT_COLOR_RED,
    PROJECT_COLOR_VIOLET,
    PROJECT_COLOR_YELLOW,
} from '../../../Themes/Modern/ProjectColors'
import { translate } from '../../../i18n/TranslationService'

export default function ColorPickerModal({ color, selectColor, closePopover, inSidebar = false }) {
    const [selectedColor, setSelectedColor] = useState(color || PROJECT_COLOR_DEFAULT)

    const colors1 = [
        PROJECT_COLOR_BLUE,
        PROJECT_COLOR_VIOLET,
        PROJECT_COLOR_ORANGE,
        PROJECT_COLOR_PELOROUS,
        PROJECT_COLOR_YELLOW,
    ]

    const colors2 = [
        PROJECT_COLOR_GREEN,
        PROJECT_COLOR_PINK,
        PROJECT_COLOR_RED,
        PROJECT_COLOR_LIME,
        PROJECT_COLOR_PURPLE,
    ]

    const setColor = color => {
        setSelectedColor(color)
        selectColor(color)
    }

    useEffect(() => {
        storeModal(PROJECT_COLOR_MODAL_ID)
        return () => removeModal(PROJECT_COLOR_MODAL_ID)
    }, [])

    return (
        <View style={[localStyles.container, inSidebar && { width: 239, marginLeft: 7 }]}>
            <View style={{ marginBottom: 20 }}>
                <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Project color')}</Text>
                <Text style={[styles.body2, { color: colors.Text03 }]}>
                    {translate('Select a color for your project')}
                </Text>
            </View>
            <View style={localStyles.colorSection}>
                <View style={localStyles.colorSectionRow}>
                    {colors1.map((color, i) => {
                        return (
                            <View key={i}>
                                <TouchableOpacity style={localStyles.colorSectionItem} onPress={() => setColor(color)}>
                                    <View style={localStyles.colorSectionItem}>
                                        <View style={localStyles.sectionItemText}>
                                            {selectedColor === color ? (
                                                <View>
                                                    <Icon name={'circle-poject_color'} size={32} color={color} />
                                                    <View style={localStyles.colorChecked}>
                                                        <Icon name={'check'} size={16} color={'#ffffff'} />
                                                    </View>
                                                </View>
                                            ) : (
                                                <Icon name={'circle-poject_color'} size={24} color={color} />
                                            )}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )
                    })}
                </View>
                <View style={[localStyles.colorSectionRow, { marginTop: 19, marginBottom: 12 }]}>
                    {colors2.map((color, i) => {
                        return (
                            <View key={i}>
                                <TouchableOpacity style={localStyles.colorSectionItem} onPress={() => setColor(color)}>
                                    <View style={localStyles.colorSectionItem}>
                                        <View style={localStyles.sectionItemText}>
                                            {selectedColor === color ? (
                                                <View>
                                                    <Icon name={'circle-poject_color'} size={32} color={color} />
                                                    <View style={localStyles.colorChecked}>
                                                        <Icon name={'check'} size={16} color={'#ffffff'} />
                                                    </View>
                                                </View>
                                            ) : (
                                                <Icon name={'circle-poject_color'} size={24} color={color} />
                                            )}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )
                    })}
                </View>
            </View>
            <View style={localStyles.closeContainer}>
                <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                    <Icon name="x" size={24} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
        borderRadius: 4,
        width: 272,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    colorSection: {
        flex: 1,
    },
    colorSectionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    colorSectionItem: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionItemText: {
        alignItems: 'center',
        flexDirection: 'row',
        flexGrow: 1,
    },
    colorChecked: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
