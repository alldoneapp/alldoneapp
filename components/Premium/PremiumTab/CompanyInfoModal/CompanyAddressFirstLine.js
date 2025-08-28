import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyAddressFirstLine({ autofocus, addreesFirstLineRef, addressLine1, updateAddressLine1 }) {
    return (
        <View style={localStyles.headerContainer}>
            <DataInput
                autofocus={autofocus}
                inputRef={addreesFirstLineRef}
                headerText={'Address line 1'}
                placeholder={'Type address'}
                value={addressLine1}
                setValue={updateAddressLine1}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    dataContainer: {
        flexDirection: 'row',
        marginTop: 16,
    },
    inputContainer: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
    },
    imagePickerContainer: {
        marginTop: 10,
    },
    headerContainer: {
        marginTop: 12,
    },
})
