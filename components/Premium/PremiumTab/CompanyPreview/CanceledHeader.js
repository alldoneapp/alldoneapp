import React from 'react'
import { StyleSheet } from 'react-native'
import moment from 'moment'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { getDateFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import MultilineParser from '../../../Feeds/TextParser/MultilineParser'
import { generatorParserCustomElement, generatorParserTextElement } from '../../../Feeds/Utils/HelperFunctions'

export default function CanceledHeader({ subscription }) {
    const { nextPaymentDate } = subscription
    const date = moment(nextPaymentDate, 'YYYY-MM-DD').format(getDateFormat())
    const headerText = `${translate('Will downgrade to free on')} ${date}`

    const elementsData = []

    const parseFeed = () => {
        const custom1 = generatorParserCustomElement(
            <Icon name={'calendar'} size={20} color={colors.UtilityOrange200} style={{ marginRight: 4 }} />
        )
        elementsData.push(custom1)

        const text1 = generatorParserTextElement(localStyles.text, headerText)
        elementsData.push(text1)
    }

    parseFeed()

    return <MultilineParser elementsData={elementsData} externalContainerStyle={localStyles.container} />
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        minHeight: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        backgroundColor: colors.UtilityOrange112,
        padding: 12,
        marginLeft: 0,
    },
    text: {
        ...styles.subtitle1,
        color: colors.UtilityOrange200,
        marginLeft: 4,
    },
})
