import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../../i18n/TranslationService'
import FilterBy from './FilterBy'
import styles, { colors } from '../../styles/global'

export default function StatisticsSectionHeader({ updateFilterData, statisticsFilter }) {
    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Statistics')}</Text>
            <View style={localStyles.filterContainer}>
                <FilterBy
                    updateFilterData={updateFilterData}
                    statisticsFilter={statisticsFilter}
                    modalDescription="Filter the statistics by time period"
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        flexDirection: 'row',
    },
    filterContainer: {
        marginLeft: 'auto',
    },
})
