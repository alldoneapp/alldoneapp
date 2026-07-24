import React, { Component } from 'react'
import HighlightColorModal from './HighlightColorModal'
import Circle from './Circle'
import Popover from 'react-tiny-popover'
import store from '../../../../redux/store'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import GhostButton from '../../../UIControls/GhostButton'
import Backend from '../../../../utils/BackendBridge'
import {
    FEED_CHAT_OBJECT_TYPE,
    FEED_CONTACT_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_MILESTONE_OBJECT_TYPE,
    FEED_NOTE_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_TASK_OBJECT_TYPE,
    FEED_USER_OBJECT_TYPE,
} from '../../../Feeds/Utils/FeedsConstants'
import { BACKGROUND_COLORS } from '../../../../utils/ColorConstants'
import { findIndex } from 'lodash'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { setProjectContactHighlight } from '../../../../utils/backends/Contacts/contactsFirestore'
import { setTaskHighlight } from '../../../../utils/backends/Tasks/tasksFirestore'
import { updateNoteHighlight } from '../../../../utils/backends/Notes/notesFirestore'
import { setChatTopicHighlight } from '../../../../utils/backends/Chats/chatsFirestore'
import { setUserHighlightInProject } from '../../../../utils/backends/Users/usersFirestore'

class HighlightButton extends Component {
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

    delayHidePopover = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
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

    onPress = (e, data) => {
        const {
            projectId,
            object,
            objectType,
            saveHighlightBeforeSaveObject,
            callback,
            updateHighlight,
            closeWithDelay,
        } = this.props
        const { loggedUser } = store.getState()
        if (e != null) {
            e.preventDefault()
            e.stopPropagation()
        }

        if (saveHighlightBeforeSaveObject !== undefined) {
            this.delayHidePopover()
            if (callback) callback(data.color)
            saveHighlightBeforeSaveObject(data.color)
        } else {
            if (callback) callback(data.color)

            if (objectType === FEED_TASK_OBJECT_TYPE) {
                setTaskHighlight(projectId, object.id, data.color, object)
                this.hidePopover()
            } else if (objectType === FEED_NOTE_OBJECT_TYPE) {
                updateNoteHighlight(projectId, object.id, data.color)
                this.hidePopover()
            } else if (objectType === FEED_USER_OBJECT_TYPE) {
                const project = ProjectHelper.getProjectById(projectId)
                setUserHighlightInProject(project, object, data.color)
                this.hidePopover()
            } else if (objectType === FEED_CONTACT_OBJECT_TYPE) {
                setProjectContactHighlight(projectId, object, object.uid, data.color)
                this.hidePopover()
            } else if (objectType === FEED_CHAT_OBJECT_TYPE) {
                setChatTopicHighlight(projectId, object.id, data.color)
                this.hidePopover()
            } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
                closeWithDelay && data.color === object.hasStar ? this.delayHidePopover() : this.hidePopover()
                updateHighlight(data.color)
            } else if (objectType === FEED_MILESTONE_OBJECT_TYPE) {
                this.hidePopover()
                updateHighlight(data.color)
            } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
                closeWithDelay && data.color === object.hasStar ? this.delayHidePopover() : this.hidePopover()
                updateHighlight(data.color)
            }
        }
    }

    render() {
        const { disabled, style, shortcutText, inEditComponent, object, inMultiSelect } = this.props
        const { visiblePopover, smallScreen } = this.state
        const index = findIndex(BACKGROUND_COLORS, ['color', object.hasStar])
        const buttonTitle = translate(BACKGROUND_COLORS[index >= 0 ? index : 0].name)

        return (
            <Popover
                content={<HighlightColorModal onPress={this.onPress} selectedColor={object.hasStar} />}
                onClickOutside={this.delayHidePopover}
                isOpen={visiblePopover}
                position={inMultiSelect ? 'top' : ['left', 'right', 'top', 'bottom']}
                padding={inMultiSelect ? (smallScreen ? 20 : 12) : 4}
                align={inMultiSelect ? 'center' : 'start'}
                contentLocation={smallScreen ? null : undefined}
            >
                {inMultiSelect ? (
                    <Button
                        ref={ref => (this.buttonRef = ref)}
                        title={inEditComponent && smallScreen ? null : buttonTitle}
                        type={'primary'}
                        noBorder={true}
                        icon={
                            <Circle
                                color={index >= 0 ? object.hasStar : '#FFFFFF'}
                                inButton={true}
                                icoForcedColor={'#ffffff'}
                            />
                        }
                        buttonStyle={style}
                        onPress={this.showPopover}
                        disabled={disabled}
                        shortcutText={shortcutText}
                        accessible={false}
                    />
                ) : (
                    <Hotkeys
                        keyName={`alt+${shortcutText}`}
                        disabled={disabled || store.getState().blockShortcuts}
                        onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, this.showPopover, event)}
                        filter={e => true}
                    >
                        <GhostButton
                            ref={ref => (this.buttonRef = ref)}
                            title={inEditComponent && smallScreen ? null : buttonTitle}
                            type={'ghost'}
                            noBorder={inEditComponent && smallScreen}
                            icon={<Circle color={index >= 0 ? object.hasStar : '#FFFFFF'} inButton={true} />}
                            buttonStyle={style}
                            onPress={this.showPopover}
                            disabled={disabled}
                            shortcutText={shortcutText}
                            accessible={false}
                        />
                    </Hotkeys>
                )}
            </Popover>
        )
    }
}

export default HighlightButton
