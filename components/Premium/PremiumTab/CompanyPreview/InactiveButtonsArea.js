import React from 'react'
import { View, StyleSheet } from 'react-native'

import RemoveCompanyWrapper from '../../RemoveCompanyWrapper'
import { removeSubscription } from '../../../../utils/backends/Premium/premiumFirestore'

export default function InactiveButtonsArea() {
    return (
        <View style={localStyles.buttons}>
            <RemoveCompanyWrapper removeCompany={removeSubscription} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 18,
    },
})
