import React, { PureComponent } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import moment from 'moment'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

export default class FeedEntry extends PureComponent {
    constructor(props) {
        super(props)
    }

    render() {
        // Tech Debt: If you do a simple console.log(this.props) you'll see how the feed object contains most of the fields passed as props. Please consult before making this can of additions.
        const color1 = this.props.feed
            ? this.props.feed.changedProperty === 'projectColor'
                ? this.props.feed.oldValue
                : colors.Text03
            : colors.Text03
        const color2 = this.props.feed
            ? this.props.feed.changedProperty === 'projectColor'
                ? this.props.feed.newValue
                : colors.Text03
            : colors.Text03

        const subHintTime = this.parseDate(this.props.date)

        const numberOfLines = !this.props.editMode ? { numberOfLines: 1 } : undefined

        return (
            <TouchableOpacity style={localStyles.container} onPress={this.props.onPress}>
                <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Image style={localStyles.userImage} source={{ uri: this.props.userPhotoURL }} />
                        <View style={{ marginLeft: 15 }}>
                            <Text style={[styles.body1, { color: colors.Text01 }]} numberOfLines={1}>
                                {`${this.props.userName}`} {this.props.action}
                            </Text>
                        </View>
                    </View>
                </View>

                <View style={localStyles.feedHint}>
                    <Icon name={this.props.icon} size={24} color={color2} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text
                            style={[
                                styles.body1,
                                { color: this.props.icon === 'feed' ? colors.Text01 : colors.Text02 },
                            ]}
                            {...numberOfLines}
                        >
                            {this.props.hint}
                        </Text>
                    </View>
                </View>
                <Text style={localStyles.dateAndSubHint} {...numberOfLines}>
                    <Text
                        style={[
                            styles.body2,
                            localStyles.subHintText,
                            { minWidth: subHintTime.length === 8 ? 72 : 180 },
                        ]}
                    >
                        {`${subHintTime} ${this.props.subHint ? '•' : ''}`}{' '}
                    </Text>
                    {this.props.subHint && <Icon name={this.props.icon} size={20} color={color1} style={{ top: 2 }} />}
                    <Text style={[styles.body2, localStyles.subHintText, { marginLeft: 6 }]} {...numberOfLines}>
                        {this.props.subHint}
                    </Text>
                </Text>
            </TouchableOpacity>
        )
    }

    parseDate(date) {
        if (Date.now() - date < 60) {
            return 'Just now'
        }

        return `At ${moment(date).format(`${getTimeFormat(true)} of ${getDateFormat()}`)}`
    }
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 118,
        flexDirection: 'column',
        flex: 1,
        paddingTop: 18,
        paddingBottom: 8,
        overflow: 'hidden',
    },
    userImage: {
        width: 32,
        height: 32,
        borderRadius: 100,
    },
    feedHint: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        marginLeft: 48,
        minHeight: 40,
        paddingTop: 8,
        paddingBottom: 8,
    },
    dateAndSubHint: {
        flex: 1,
        marginLeft: 48,
        minHeight: 32,
        paddingTop: 5,
        paddingBottom: 5,
        flexDirection: 'row',
        alignItems: 'flex-start',
        overflow: 'hidden',
    },
    subHintText: {
        color: colors.Text03,
        alignItems: 'flex-start',
    },
})
