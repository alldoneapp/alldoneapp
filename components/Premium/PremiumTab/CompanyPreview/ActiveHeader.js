import React from 'react'
import { StyleSheet } from 'react-native'
import moment from 'moment'

import Icon from '../../../Icon'
import styles, { colors } from '../../../.../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { PRICE } from '../../PremiumHelper'
import MultilineParser from '../../../Feeds/TextParser/MultilineParser'
import { generatorParserCustomElement, generatorParserTextElement } from '../../../Feeds/Utils/HelperFunctions'

export default function ActiveHeader({ selectedUsersAmount, nextPaymentDate }) {
    const date = moment(nextPaymentDate).format('DD.MM.YYYY')
    const nextPaymentText = `${translate('Next payment on')} ${date}`
    const billedText = `• ${translate('Billed monthly')} €${selectedUsersAmount * PRICE}`

    const elementsData = []

    const parseFeed = () => {
        const custom1 = generatorParserCustomElement(
            <Icon name={'calendar'} size={20} color={colors.Primary200} style={{ marginRight: 4 }} />
        )
        elementsData.push(custom1)

        const text1 = generatorParserTextElement(localStyles.text1, nextPaymentText)
        elementsData.push(text1)

        const text2 = generatorParserTextElement(localStyles.text2, billedText)
        elementsData.push(text2)
    }

    parseFeed()

    return <MultilineParser elementsData={elementsData} externalContainerStyle={localStyles.info} />
}

const localStyles = StyleSheet.create({
    info: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        minHeight: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        backgroundColor: colors.UtilityBlue112,
        padding: 12,
        marginLeft: 0,
    },
    text1: {
        ...styles.subtitle1,
        color: colors.Primary200,
        marginLeft: 4,
    },
    text2: {
        ...styles.body2,
        color: colors.Primary200,
        marginLeft: 4,
    },
})
