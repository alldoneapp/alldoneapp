import React, { Component } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import moment from 'moment'
import Icon from '../Icon'
import store from '../../redux/store'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { translate } from '../../i18n/TranslationService'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'

export default class DateItem extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.relativeDates = {
            Today: moment(),
            Tomorrow: moment().add(1, 'day'),
            'This next Saturday': this.getNextDay('Saturday'),
            'This next Monday': this.getNextDay('Monday'),
            'In 2 days': moment().add(2, 'day'),
            'In 4 days': moment().add(4, 'day'),
            'In 7 days': moment().add(7, 'day'),
            'In 30 days': moment().add(30, 'day'),
            Someday: moment(),
            'Last selected':
                storeState.lastSelectedDueDate === BACKLOG_DATE_NUMERIC
                    ? BACKLOG_DATE_NUMERIC
                    : moment(storeState.lastSelectedDueDate),
            'Custom date': { format: () => <Icon name="chevron-right" size={24} color={colors.Text03} /> },
        }

        this.dateShortcuts = {
            Today: '1',
            Tomorrow: '2',
            'This next Saturday': '3',
            'This next Monday': '4',
            'In 2 days': '5',
            'In 4 days': '6',
            'In 7 days': '7',
            'In 30 days': '8',
            Someday: '9',
            'Last selected': '0',
            'Custom date': 'Q',
        }
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    getNextDay = day => {
        const dateNowDay = new Date()
        const weekDay = moment().day(day)
        const nextDay = dateNowDay.getTime() >= weekDay.valueOf() ? weekDay.add(7, 'day') : weekDay
        return nextDay
    }

    render() {
        const { smallScreenNavigation: mobile } = this.state
        const { children, selected, onPress } = this.props

        const dateText = (withDot = false) => {
            return (
                children !== 'Custom date' &&
                children !== 'Someday' && (
                    <Text
                        style={
                            selected ? [styles.subtitle1, { color: 'white' }] : [styles.body1, { color: colors.Text03 }]
                        }
                    >
                        {withDot && ' • '}
                        {this.relativeDates[children] === BACKLOG_DATE_NUMERIC
                            ? translate('Someday')
                            : this.relativeDates[children].format('DD MMM')}
                    </Text>
                )
            )
        }

        return (
            <Hotkeys
                keyName={this.dateShortcuts[children]}
                onKeyDown={(sht, event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onPress(children, this.relativeDates[children])
                }}
                filter={e => true}
            >
                <TouchableOpacity
                    style={localStyles.container}
                    onPress={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        onPress(children, this.relativeDates[children])
                    }}
                >
                    <Text style={[styles.subtitle1, { color: 'white' }]}>
                        {translate(children)}
                        {!mobile && dateText(true)}
                    </Text>
                    <View style={{ marginLeft: 'auto' }}>
                        {!mobile ? <Shortcut text={this.dateShortcuts[children]} theme={SHORTCUT_LIGHT} /> : dateText()}
                    </View>
                </TouchableOpacity>
            </Hotkeys>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
