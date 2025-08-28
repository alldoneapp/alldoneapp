import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyCountry({ countryRef, country, updateCountry }) {
    return (
        <View style={localStyles.container}>
            <DataInput
                inputRef={countryRef}
                headerText={'Country'}
                placeholder={'Type country'}
                value={country}
                setValue={updateCountry}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 12,
    },
})
