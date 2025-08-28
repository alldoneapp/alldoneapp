import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyVat({ vatRef, vat, updateVat }) {
    return (
        <View style={localStyles.headerContainer}>
            <DataInput
                inputRef={vatRef}
                headerText={'VAT'}
                placeholder={'Type VAT'}
                value={vat}
                setValue={updateVat}
                keyboardType="numeric"
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerContainer: {
        marginTop: 12,
    },
})
