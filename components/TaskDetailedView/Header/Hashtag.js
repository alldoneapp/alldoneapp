import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'

const Hashtag = ({ children }) =>
    children ? (
        <View>
            <Text style={[styles.title6, localStyles.hashtagText]}>{'#' + children}</Text>
        </View>
    ) : null

const localStyles = StyleSheet.create({
    hashtagText: {
        color: colors.Primary300,
        backgroundColor: colors.UtilityBlue100,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 16,
    },
})

export default Hashtag
