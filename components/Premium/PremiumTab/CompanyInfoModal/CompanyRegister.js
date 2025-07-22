import React from 'react'
import { StyleSheet, View } from 'react-native'

import DataInput from './DataInput'

export default function CompanyRegister({ companyRegisterRef, companyRegister, updateCompanyRegister }) {
    return (
        <View style={localStyles.headerContainer}>
            <DataInput
                inputRef={companyRegisterRef}
                headerText={'Company Register'}
                placeholder={'Type Company Register'}
                value={companyRegister}
                setValue={updateCompanyRegister}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerContainer: {
        marginTop: 12,
    },
})
