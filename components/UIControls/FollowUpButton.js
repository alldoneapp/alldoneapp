import React, { Component } from 'react'
import Popover from 'react-tiny-popover'
import store from '../../redux/store'
import Button from './Button'
import { setLastSelectedDueDate } from '../../redux/actions'
import FollowUpDueDate from '../FollowUp/FollowUpDueDate'
import CustomFollowUpDateModal from '../FollowUp/CustomFollowUpDateModal'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import { createFloatPopupLock } from '../../hooks/useFloatPopupLock'

class FollowUpButton extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()
        this._isUnmounted = false
        this._timeouts = []
        this.popupLock = createFloatPopupLock(store.dispatch)
        this.state = {
            inDueDate: true,
            inCalendar: false,
            visiblePopover: false,
            smallScreen: storeState.smallScreen,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentWillUnmount() {
        this._isUnmounted = true
        this._timeouts.forEach(timeout => clearTimeout(timeout))
        this._timeouts = []
        this.popupLock.release()
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreen: storeState.smallScreen,
        })
    }

    hidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
        const timeout = setTimeout(async () => {
            if (this._isUnmounted) return
            const { onDismissPopup } = this.props
            this.setState({ visiblePopover: false })
            this.popupLock.release()
            if (onDismissPopup) onDismissPopup()
        })
        this._timeouts.push(timeout)
    }

    showPopover = () => {
        if (!this.state.visiblePopover) {
            this.setState({ visiblePopover: true })
            this.popupLock.acquire()
        }
    }

    closePopover = () => {
        this.setState({ visiblePopover: false })
        this.hidePopover()
    }

    onCustomDatePress = () => {
        this.setState({ inCalendar: true, inDueDate: false })
    }

    backToDueDate = () => {
        this.setState({ inCalendar: false, inDueDate: true })
    }

    selectDate = (dateText, date) => {
        if (date === BACKLOG_DATE_NUMERIC) {
            this.selectBacklog(dateText, date)
        } else {
            const { saveDateBeforeSaveTask } = this.props
            store.dispatch(setLastSelectedDueDate(date.valueOf()))
            saveDateBeforeSaveTask(dateText, date, false)
            this.closePopover()
        }
    }

    selectBacklog = (dateText, date) => {
        const { saveDateBeforeSaveTask } = this.props
        store.dispatch(setLastSelectedDueDate(Number.MAX_SAFE_INTEGER))
        saveDateBeforeSaveTask(dateText, date, true)
        this.closePopover()
    }

    render() {
        const { buttonText, disabled, style, inEditTask, dateText, shortcutText } = this.props
        const { visiblePopover, smallScreen, inDueDate, inCalendar } = this.state
        return (
            <Popover
                content={
                    inDueDate ? (
                        <FollowUpDueDate
                            closePopover={this.closePopover}
                            onCustomDatePress={this.onCustomDatePress}
                            selectDate={this.selectDate}
                            selectBacklog={this.selectBacklog}
                            directFollowUp={true}
                            dateText={dateText}
                        />
                    ) : (
                        inCalendar && (
                            <CustomFollowUpDateModal
                                hidePopover={this.backToDueDate}
                                selectDate={this.selectDate}
                                backToDueDate={this.backToDueDate}
                            />
                        )
                    )
                }
                onClickOutside={this.hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <Hotkeys
                    keyName={`alt+${shortcutText}`}
                    disabled={disabled}
                    onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, this.showPopover, event)}
                    filter={e => true}
                >
                    <Button
                        ref={ref => (this.buttonRef = ref)}
                        title={inEditTask && smallScreen ? null : buttonText}
                        type={'ghost'}
                        noBorder={inEditTask && smallScreen}
                        icon={'calendar-up'}
                        buttonStyle={style}
                        onPress={this.showPopover}
                        disabled={disabled}
                        shortcutText={shortcutText}
                    />
                </Hotkeys>
            </Popover>
        )
    }
}

FollowUpButton.defaultProps = {
    buttonText: translate('Follow up'),
    inEditTask: false,
}

export default FollowUpButton
