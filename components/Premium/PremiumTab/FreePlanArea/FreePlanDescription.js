import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles from '../../../styles/global'
import FreeSvg from '../../../../assets/svg/FreeSvg'
import { translate } from '../../../../i18n/TranslationService'
import FreeFeatures from './FreeFeatures'

export default function FreePlanDescription() {
    return (
        <View style={{ paddingHorizontal: 16 }}>
            <View style={localStyles.title}>
                <FreeSvg height={34} width={34} style={{ marginRight: 8 }} />
                <Text style={styles.title6}>{translate('Free, but limited usage')}</Text>
            </View>
            <Text style={[styles.body2, { marginTop: 16 }]}>{translate('Free, but limited usage description')}</Text>
            <Text style={[styles.body2, { marginTop: 22 }]}>{translate('Free includes')}</Text>
            <FreeFeatures />
        </View>
    )
}

const localStyles = StyleSheet.create({
    title: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
