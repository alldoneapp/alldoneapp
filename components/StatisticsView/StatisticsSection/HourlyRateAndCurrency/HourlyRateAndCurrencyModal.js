import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import useWindowSize from '../../../../utils/useWindowSize'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { UpdateHourlyRatesAndCurrency } from '../../../../utils/backends/firestore'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import CurrencyArea from './CurrencyArea'
import HourlyRateArea from './HourlyRateArea'
import store from '../../../../redux/store'

export default function HourlyRateAndCurrencyModal({ projectId, closeModal, hourlyRatesData }) {
    const [currency, setCurrency] = useState(hourlyRatesData.currency)
    const [hourlyPerUser, setHourlyPerUser] = useState(() => {
        const rates = {}
        const { projectUsers } = store.getState()
        projectUsers[projectId].forEach(user => {
            const userRate = hourlyRatesData.hourlyRates[user.uid]
            rates[user.uid] = userRate ? userRate : 0
        })
        return rates
    })

    const [width, height] = useWindowSize()

    const setData = () => {
        UpdateHourlyRatesAndCurrency(projectId, currency, hourlyPerUser)
        closeModal()
    }

    const onKeyDown = event => {
        if (event.key === 'Enter') setData()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Hourly rate and currency')}
                description={translate('Select the hourly rate per user')}
            />
            <CurrencyArea currency={currency} setCurrency={setCurrency} />
            <HourlyRateArea hourlyPerUser={hourlyPerUser} setHourlyPerUser={setHourlyPerUser} projectId={projectId} />
            <Button
                title={translate('Save')}
                buttonStyle={{ alignSelf: 'center', marginTop: 16 }}
                onPress={setData}
                shortcutText={'Enter'}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
})
