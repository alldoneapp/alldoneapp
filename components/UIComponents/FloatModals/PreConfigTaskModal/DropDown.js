import React, { useState, useEffect } from 'react'
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

    console.log('DropDown render:', {
        value,
        availableValues: items.map(item => item.value),
        hasMatchingOption: items.some(item => item.value === value),
        placeholder,
    })

    useEffect(() => {
        console.log('DropDown value changed:', {
            newValue: value,
            hasMatchingOption: items.some(item => item.value === value),
        })
    }, [value])

    const handleValueChange = newValue => {
        console.log('DropDown value change:', { from: value, to: newValue })
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
                containerStyle={localStyles.dropDownContainer}
                dropDownContainerStyle={localStyles.optionsContainer}
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
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        height: 42,
        alignContent: 'center',
    },
    optionsContainer: {
        backgroundColor: Colors.GraySidebar,
    },
    optionText: {
        ...styles.body1,
        color: colors.Text03,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    selectedItem: {
        fontWeight: 'bold',
    },
    arrow: {
        width: 24,
        height: 24,
        tintColor: colors.Text03,
    },
})
