import React, { Component } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import moment from 'moment'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { getDateFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../../i18n/TranslationService'

export default class Creator extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        const { creator, createdDate } = this.props

        return (
            <View style={localStyles.container}>
                <View style={localStyles.userImageContainer}>
                    {creator != null && creator.photoURL != null && creator.photoURL !== '' ? (
                        <Image style={localStyles.userImage} source={{ uri: creator.photoURL }} />
                    ) : (
                        <View style={localStyles.userImage}>
                            <SVGGenericUser width={40} height={40} svgid={'creatorAvatarId'} />
                        </View>
                    )}
                </View>
                <View style={localStyles.userInfo}>
                    <Text style={[styles.body1, { color: colors.Text01 }]}>
                        {creator != null ? creator.displayName : translate('Unknown user')}
                    </Text>
                    <Text style={[styles.caption2, { color: colors.Text03 }]}>
                        {this.parseDate(moment(createdDate))}
                    </Text>
                </View>
            </View>
        )
    }

    parseDate(date) {
        return `${translate(date.isSame(moment(), 'day') ? 'on Day' : 'on the Day')} ` + date.format(getDateFormat())
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
    userImage: {
        width: 40,
        height: 40,
        borderRadius: 100,
        overflow: 'hidden',
    },
    userImageContainer: {
        flex: 1,
        marginRight: 12,
    },
    userInfo: {
        flexDirection: 'column',
    },
})
