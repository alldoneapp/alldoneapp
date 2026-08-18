import React, { useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import DropDownPicker from 'react-native-dropdown-picker'

import styles, { colors } from '../../../styles/global'
import Colors from '../../../../Themes/Colors'

export default function DropDown({
    items,
    value,
    setValue,
    placeholder,
    header,
    containerStyle,
    arrowStyle,
    disabled,
}) {
    const [open, setOpen] = useState(false)

    const handleValueChange = newValue => {
        setValue(newValue)
    }

    return (
        <View nativeID="dropDown" style={[localStyles.container, containerStyle]}>
            <Text style={localStyles.header}>{header}</Text>
            <DropDownPicker
                open={open}
                value={value}
                items={items}
                setOpen={setOpen}
                setValue={handleValueChange}
                placeholder={placeholder}
                textStyle={localStyles.optionText}
                style={localStyles.dropDown}
                containerStyle={localStyles.dropDownContainer}
                dropDownContainerStyle={localStyles.optionsContainer}
                placeholderStyle={localStyles.placeholder}
                listItemLabelStyle={localStyles.optionText}
                selectedItemLabelStyle={localStyles.selectedItem}
                showTickIcon={false}
                showArrowIcon={true}
                disabled={disabled}
                arrowIconStyle={[localStyles.arrow, arrowStyle]}
                labelProps={{
                    numberOfLines: 1,
                }}
                labelStyle={localStyles.optionText}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        zIndex: 999,
    },
    header: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    dropDownContainer: {
        height: 42,
        alignContent: 'center',
    },
    dropDown: {
        backgroundColor: colors.Secondary400,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 42,
        paddingHorizontal: 0,
    },
    optionsContainer: {
        backgroundColor: colors.Secondary300,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
    },
    optionText: {
        ...styles.body1,
        color: Colors.White,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    placeholder: {
        ...styles.body1,
        color: colors.Text03,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    selectedItem: {
        fontWeight: 'bold',
        color: Colors.White,
    },
    arrow: {
        width: 24,
        height: 24,
        tintColor: colors.Text03,
    },
})
