import React from 'react'
import { StyleSheet, View } from 'react-native'

import FeatureDescription from '../FeatureDescription'

export default function FreeFeatures() {
    return (
        <View style={localStyles.block}>
            <FeatureDescription text="All the features unlocked" />
            <FeatureDescription text="Usage limited by our fair use policy (number of tasks & traffic)" />
            <FeatureDescription text="Limited past tasks & search history" />
        </View>
    )
}

const localStyles = StyleSheet.create({
    block: {
        marginTop: 16,
    },
})
