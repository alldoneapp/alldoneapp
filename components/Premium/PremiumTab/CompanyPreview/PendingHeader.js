import React from 'react'
import { StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { PRICE } from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'
import MultilineParser from '../../../Feeds/TextParser/MultilineParser'
import { generatorParserCustomElement, generatorParserTextElement } from '../../../Feeds/Utils/HelperFunctions'

export default function PendingHeader({ selectedUsersAmount }) {
    const headerText = `${translate('Pending payment')} ${selectedUsersAmount * PRICE} €`

    const elementsData = []

    const parseFeed = () => {
        const custom1 = generatorParserCustomElement(
            <Icon name={'rotate-cw'} size={20} color={colors.Primary200} style={{ marginRight: 4 }} />
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
        backgroundColor: colors.UtilityBlue112,
        padding: 12,
        marginLeft: 0,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Primary200,
        marginLeft: 4,
    },
})
