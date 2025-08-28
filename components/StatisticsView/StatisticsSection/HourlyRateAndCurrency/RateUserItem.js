import React from 'react'
import { View } from 'react-native'

import DataInput from '../../../Premium/PremiumTab/CompanyInfoModal/DataInput'
import UserData from './UserData'

export default function RateUserItem({ user, hourlyRate, setHourlyPerUser }) {
    const { uid, photoURL, displayName } = user

    const onChangeValue = value => {
        setHourlyPerUser(hourlyPerUser => {
            return { ...hourlyPerUser, [uid]: value ? Number(value) : value }
        })
    }

    return (
        <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
            <UserData photoURL={photoURL} displayName={displayName} />
            <DataInput
                placeholder={'type'}
                value={hourlyRate}
                setValue={onChangeValue}
                externalInputStyle={{ width: 110 }}
                keyboardType="numeric"
            />
        </View>
    )
}
