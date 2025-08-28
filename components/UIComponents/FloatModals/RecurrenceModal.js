import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import PropTypes from 'prop-types'
import Icon from '../../Icon'
import Backend from '../../../utils/BackendBridge'
import store from '../../../redux/store'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import { withWindowSizeHook } from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'
import {
    RECURRENCE_MAP,
    RECURRENCE_NEVER,
    RECURRENCE_DAILY,
    RECURRENCE_EVERY_WORKDAY,
    RECURRENCE_WEEKLY,
    RECURRENCE_EVERY_2_WEEKS,
    RECURRENCE_EVERY_3_WEEKS,
    RECURRENCE_MONTHLY,
    RECURRENCE_EVERY_3_MONTHS,
    RECURRENCE_EVERY_6_MONTHS,
    RECURRENCE_ANNUALLY,
} from '../../TaskListView/Utils/TasksHelper'
import { setTaskRecurrence } from '../../../utils/backends/Tasks/tasksFirestore'

class RecurrenceModal extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.recurrences = [
            RECURRENCE_NEVER,
            RECURRENCE_DAILY,
            RECURRENCE_EVERY_WORKDAY,
            RECURRENCE_WEEKLY,
            RECURRENCE_EVERY_2_WEEKS,
            RECURRENCE_EVERY_3_WEEKS,
            RECURRENCE_MONTHLY,
            RECURRENCE_EVERY_3_MONTHS,
            RECURRENCE_EVERY_6_MONTHS,
            RECURRENCE_ANNUALLY,
        ]
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

    selectRecurrence = recurrence => {
        let { task, projectId, showBackButton, saveRecurrenceBeforeSaveTask } = this.props
        if (!showBackButton) {
            if (saveRecurrenceBeforeSaveTask !== undefined) {
                saveRecurrenceBeforeSaveTask(recurrence)
            } else if (task.id !== 'temp') {
                setTaskRecurrence(projectId, task.id, recurrence, task)
            }
        }
        this.props.closePopover(recurrence)
    }

    renderRecurrenceSection = (recurrence, i) => {
        const { task } = this.props
        const { smallScreenNavigation } = this.state

        const { large: recurrenceText, shortcut } = RECURRENCE_MAP[recurrence]
        return (
            <View key={recurrence}>
                <Hotkeys
                    key={i}
                    keyName={shortcut}
                    onKeyDown={(sht, event) => this.selectRecurrence(recurrence)}
                    filter={e => true}
                >
                    <TouchableOpacity
                        style={localStyles.recurrenceSectionItem}
                        onPress={() => {
                            this.selectRecurrence(recurrence)
                        }}
                    >
                        <View style={localStyles.recurrenceSectionItem}>
                            <View style={localStyles.sectionItemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                    {translate(recurrenceText)}
                                </Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {!smallScreenNavigation ? (
                                    <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />
                                ) : (
                                    task.recurrence === recurrence && (
                                        <Icon name={'check'} size={24} color={'#ffffff'} />
                                    )
                                )}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    closePopup = e => {
        const { closePopover } = this.props
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        closePopover()
    }

    render() {
        const { closePopover, showBackButton, windowSize } = this.props
        const { smallScreenNavigation } = this.state

        return (
            <View
                style={[
                    localStyles.container,
                    applyPopoverWidth(),
                    { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                ]}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Recurring')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Select the recurrence for this task')}
                        </Text>
                    </View>

                    <View style={localStyles.recurrenceSection}>
                        {this.recurrences.slice(0, 1).map(this.renderRecurrenceSection)}
                    </View>

                    <View style={localStyles.sectionSeparator} />

                    <View style={localStyles.recurrenceSection}>
                        {this.recurrences.slice(1, 10).map(this.renderRecurrenceSection)}
                    </View>

                    {showBackButton && (
                        <Hotkeys keyName={'B'} onKeyDown={(s, e) => this.closePopup(e)} filter={e => true}>
                            <TouchableOpacity style={localStyles.backContainer} onPress={closePopover}>
                                <Icon name="chevron-left" size={24} color={colors.Text03} />
                                <Text style={[styles.subtitle1, localStyles.backText]}>{translate('Back')}</Text>
                                {!smallScreenNavigation && (
                                    <View style={localStyles.shortcut}>
                                        <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                                    </View>
                                )}
                            </TouchableOpacity>
                        </Hotkeys>
                    )}

                    <View style={localStyles.closeContainer}>
                        <Hotkeys keyName={'esc'} onKeyDown={(s, e) => this.closePopup(e)} filter={e => true}>
                            <TouchableOpacity style={localStyles.closeButton} onPress={this.closePopup}>
                                <Icon name="x" size={24} color={colors.Text03} />
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>
                </CustomScrollView>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    title: {
        marginBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
    },
    recurrenceSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
    },
    recurrenceSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        justifyContent: 'flex-end',
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    backContainer: {
        flexDirection: 'row',
        marginTop: 8,
        paddingTop: 20,
        paddingBottom: 12,
        paddingLeft: 16,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    backText: {
        color: '#FFFFFF',
        fontWeight: '500',
        marginLeft: 8,
    },
    shortcut: {
        position: 'absolute',
        marginTop: 4,
        right: 16,
    },
})

RecurrenceModal.propTypes = {
    task: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    closePopover: PropTypes.func,
    showBackButton: PropTypes.bool,
}

RecurrenceModal.defaultProps = {
    showBackButton: false,
}

export default withWindowSizeHook(RecurrenceModal)
