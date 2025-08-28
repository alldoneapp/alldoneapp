import React  from 'react'
import { StyleSheet, Text, View } from 'react-native'
import PropTypes from 'prop-types'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

const ProjectMembersHeader = ({ amount }) => {
    const parseText = number => {
        if (number == null || number <= 0) {
            return translate('No members yet')
        } else if (number > 1) {
            return translate('Number members', { number })
        }
        return translate('Number member', { number })
    }

    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Project members')}</Text>
            <View style={localStyles.headerCaption}>
                <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(amount)}</Text>
            </View>
        </View>
    )
}

ProjectMembersHeader.propTypes = {
    amount: PropTypes.number.isRequired,
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
})

export default ProjectMembersHeader
