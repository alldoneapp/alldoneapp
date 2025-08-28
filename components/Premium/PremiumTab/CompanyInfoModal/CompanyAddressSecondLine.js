import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyAddressSecondLine({ addreesSecondLineRef, addressLine2, updateAddressLine2 }) {
    return (
        <View style={localStyles.headerContainer}>
            <DataInput
                inputRef={addreesSecondLineRef}
                headerText={'Address line 2'}
                placeholder={'Type address'}
                value={addressLine2}
                setValue={updateAddressLine2}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerContainer: {
        marginTop: 12,
    },
})
