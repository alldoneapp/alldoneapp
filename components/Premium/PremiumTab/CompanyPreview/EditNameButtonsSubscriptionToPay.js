import React, { useState } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { updateCompanyDataInSubscription } from '../../../../utils/backends/Premium/premiumFirestore'

export default function EditNameButtonsSubscriptionToPay({ companyData, setCompanyData, subscription }) {
    const [originalName, setOriginalName] = useState(companyData.name)
    const newName = companyData.name

    const resetName = () => {
        setCompanyData(companyData => {
            return { ...companyData, name: originalName }
        })
    }

    const updateName = () => {
        updateCompanyDataInSubscription(companyData, subscription)
        setOriginalName(companyData.name)
    }

    return (
        <View style={localStyles.container}>
            <Button icon={'x'} onPress={resetName} type={'secondary'} buttonStyle={{ marginHorizontal: 8 }} />
            <TouchableOpacity
                onPress={updateName}
                style={[localStyles.buttonMaster, newName === originalName && { opacity: 0.5 }]}
                disabled={newName === originalName}
            >
                <Icon name={'save'} size={24} color={'#ffffff'} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 'auto',
        flexDirection: 'row',
    },
    buttonMaster: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        paddingVertical: 8,
        paddingHorizontal: 8,
        height: 40,
        maxHeight: 40,
        minHeight: 40,
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
})
