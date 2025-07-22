import React, { Component } from 'react'
import Popover from 'react-tiny-popover'
import store from '../../redux/store'
import Button from './Button'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../utils/HelperFunctions'
import SelectStickynessPopup from '../NotesView/NotesDV/PropertiesView/SelectStickynessPopup'
import { translate } from '../../i18n/TranslationService'

class StickyButton extends Component {
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

    hidePopover = () => {
        const { onDismissPopup } = this.props
        this.setState({ visiblePopover: false })
        store.dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditComponent
        setTimeout(async () => {
            this.hidePopover()
        })
    }

    showPopover = () => {
        /* istanbul ignore next */
        if (!this.state.visiblePopover) {
            this.setState({ visiblePopover: true })
            store.dispatch(showFloatPopup())
        }
    }

    getStickyText = () => {
        const { smallScreen } = this.state
        const { note } = this.props
        const days = note.stickyData.days
        const text = smallScreen
            ? null
            : days >= 365
            ? translate('Forever')
            : days > 0
            ? translate(`Sticky amount ${days > 1 ? 'days' : 'day'}`, { amount: days })
            : translate('Make sticky')
        return text
    }

    render() {
        const { note, projectId, disabled, style, saveStickyBeforeSaveNote, shortcutText, isChat } = this.props
        const { visiblePopover, smallScreen } = this.state

        return (
            <Popover
                content={
                    <SelectStickynessPopup
                        projectId={projectId}
                        note={note}
                        hidePopover={this.delayHidePopover}
                        saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                        isChat={isChat}
                    />
                }
                onClickOutside={this.delayHidePopover}
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
                        title={this.getStickyText()}
                        type={'ghost'}
                        noBorder={smallScreen}
                        icon={'sticky-note'}
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

export default StickyButton
