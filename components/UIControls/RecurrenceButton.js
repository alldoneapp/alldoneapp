import React, { Component } from 'react'
import Popover from 'react-tiny-popover'
import store from '../../redux/store'
import PropTypes from 'prop-types'
import Button from './Button'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RecurrenceModal from '../UIComponents/FloatModals/RecurrenceModal'
import { translate } from '../../i18n/TranslationService'
import { RECURRENCE_MAP } from '../TaskListView/Utils/TasksHelper'

class RecurrenceButton extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            visiblePopover: false,
            smallScreen: storeState.smallScreen,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreen: storeState.smallScreen,
        })
    }

    hidePopover = recurrence => {
        this.setState({ visiblePopover: false })
        store.dispatch(hideFloatPopup())

        if (this.props.onChangeValue !== undefined && recurrence) {
            this.props.onChangeValue(recurrence)
        }
    }

    showPopover = () => {
        this.setState({ visiblePopover: true })
        store.dispatch(showFloatPopup())
    }

    render() {
        const { task, projectId, disabled, style, inEditTask } = this.props
        const { visiblePopover, smallScreen } = this.state

        return (
            <Popover
                content={<RecurrenceModal task={task} projectId={projectId} closePopover={this.hidePopover} />}
                onClickOutside={this.hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <Button
                    title={inEditTask && smallScreen ? null : translate(RECURRENCE_MAP[task.recurrence].large)}
                    type={'ghost'}
                    noBorder={inEditTask && smallScreen}
                    icon={'rotate-cw'}
                    buttonStyle={style}
                    onPress={this.showPopover}
                    disabled={disabled}
                />
            </Popover>
        )
    }
}

RecurrenceButton.propTypes = {
    task: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    inEditTask: PropTypes.bool,
    onChangeValue: PropTypes.func,
}

RecurrenceButton.defaultProps = {
    inEditTask: false,
}

export default RecurrenceButton
