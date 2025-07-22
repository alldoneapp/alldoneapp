import React from 'react'
import { StyleSheet } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import ProgressBar from '../../LimitModal/ProgressBar'

export default function ProgressItem({ text, percent }) {
    return <ProgressBar percent={percent} containerStyle={localStyles.progressItem} headerText={translate(text)} />
}

const localStyles = StyleSheet.create({
    progressItem: {
        width: '50%',
        paddingHorizontal: 16,
    },
})
