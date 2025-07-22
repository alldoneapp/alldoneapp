import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyCity({ postalCodeRef, cityRef, city, updateCity, postalCode, updatePostalCode }) {
    return (
        <View style={{ marginTop: 12 }}>
            <View style={localStyles.container}>
                <DataInput
                    inputRef={postalCodeRef}
                    headerText={'Zip/Postal Code'}
                    plainPlaceholder={'00000'}
                    value={postalCode}
                    setValue={updatePostalCode}
                    externalContainerStyle={{ marginRight: 12, flex: 1 }}
                />
                <DataInput
                    inputRef={cityRef}
                    headerText={'City'}
                    placeholder={'Type city'}
                    value={city}
                    setValue={updateCity}
                    externalContainerStyle={{ flex: 1 }}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    cityContainer: {
        marginRight: 12,
    },
})
