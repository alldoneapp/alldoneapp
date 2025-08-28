import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'

export default function CurrencyArea({ currency, setCurrency }) {
    return (
        <View style={localStyles.currency}>
            <Button
                type={'ghost'}
                buttonStyle={[{ marginLeft: 8 }, currency === 'EUR' && localStyles.borderColor]}
                onPress={() => setCurrency('EUR')}
                textColor={currency === 'EUR' && colors.Primary100}
                title={'EUR'}
            />
            <Button
                type={'ghost'}
                buttonStyle={currency === 'USD' && localStyles.borderColor}
                onPress={() => setCurrency('USD')}
                textColor={currency === 'USD' && colors.Primary100}
                title={'USD'}
            />
            <Button
                type={'ghost'}
                buttonStyle={currency === 'GBP' && localStyles.borderColor}
                onPress={() => setCurrency('GBP')}
                textColor={currency === 'GBP' && colors.Primary100}
                title={'GBP'}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    borderColor: {
        borderWidth: 1,
        borderColor: colors.Primary100,
    },
    currency: {
        justifyContent: 'space-evenly',
        flexDirection: 'row',
    },
})
