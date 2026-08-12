import React, { Component } from 'react'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import store from '../../redux/store'
import PropTypes from 'prop-types'
import GhostButton from './GhostButton'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn, popoverToTop, popoverToTopContainerStyle } from '../../utils/HelperFunctions'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { RECORD_VIDEO_MODAL_ID, RECORD_SCREEN_MODAL_ID } from '../Feeds/CommentsTextInput/textInputHelper'
import {
    BOT_OPTION_MODAL_ID,
    BOT_WARNING_MODAL_ID,
    MENTION_MODAL_ID,
    RUN_OUT_OF_GOLD_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import { STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { createFloatPopupLock } from '../../hooks/useFloatPopupLock'
import { selectAssistantEnabledFor } from '../ChatsView/Utils/assistantEnabledScope'

class CommentButton extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this._isUnmounted = false
        this._timeouts = []
        this.popupLock = createFloatPopupLock(store.dispatch)
        this.setStateIfMounted = (updater, callback) => {
            if (!this._isUnmounted) {
                this.setState(updater, callback)
            }
        }

        this.state = {
            visiblePopover: false,
            smallScreen: storeState.smallScreen,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentWillUnmount() {
        this._isUnmounted = true
        this.state.unsubscribe()
        // Clear any pending timeouts
        this._timeouts.forEach(t => clearTimeout(t))
        this._timeouts = []
        this.popupLock.release()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setStateIfMounted({
            smallScreen: storeState.smallScreen,
        })
    }

    hidePopover = () => {
        const { isQuillTagEditorOpen, openModals } = store.getState()
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            // This timeout is necessary to stop the propagation of the click
            // to close the Modal, and reach the dismiss event of the EditTask
            const t = setTimeout(async () => {
                const { onDismissPopup } = this.props
                this.setStateIfMounted({ visiblePopover: false })
                this.popupLock.release()
                if (onDismissPopup) onDismissPopup()
            })
            this._timeouts.push(t)
        }
    }

    showPopover = () => {
        if (!this.state.visiblePopover) {
            this.setStateIfMounted({ visiblePopover: true })
            this.popupLock.acquire()
        }
    }

    changeValue = (comment, mentions, isPrivate, hasKarma, explicitAssistantEnabled) => {
        const storeState = store.getState()
        const { isQuillTagEditorOpen, openModals } = storeState
        const { projectId, task } = this.props

        // AT-2084: read the assistant flag through THIS task's identity instead of the raw global
        // `state.assistantEnabled`. CommentButton lives in the inline task editor, outside any Chat
        // DV, so nothing here re-armed the flag; a `true` left over from a chat created elsewhere
        // (`createBotQuickTopic` / `generateTaskFromPreConfig` with `skipNavigation: true`) made the
        // comment get posted immediately instead of being deferred until the task edit is saved.
        // An UNSCOPED flag is still honored — that is what RichCommentModal itself dispatches for
        // this very object, and what every in-chat writer produces — so the normal path is unchanged.
        const assistantEnabled = selectAssistantEnabledFor(storeState, projectId, task ? task.id : null)

        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID] &&
            !openModals[BOT_OPTION_MODAL_ID] &&
            !openModals[RUN_OUT_OF_GOLD_MODAL_ID] &&
            !openModals[BOT_WARNING_MODAL_ID]
        ) {
            if (!assistantEnabled) {
                this.props.saveCommentBeforeSaveTask(comment)
                this.hidePopover()
            } else {
                createObjectMessage(
                    projectId,
                    task.id,
                    comment,
                    'tasks',
                    STAYWARD_COMMENT,
                    null,
                    null,
                    false,
                    explicitAssistantEnabled
                )
            }
        }
    }

    render() {
        const { disabled, style, inEditTask, projectId, shortcutText, task } = this.props
        const { visiblePopover, smallScreen } = this.state
        return visiblePopover ? (
            <AppPopover
                content={
                    <RichCommentModal
                        processDone={this.changeValue}
                        closeModal={this.hidePopover}
                        projectId={projectId}
                        objectType={'tasks'}
                        objectId={task.id}
                        currentMentions={[]}
                        userGettingKarmaId={task.userId}
                        showBotButton={true}
                        objectName={task.name}
                        externalAssistantId={task.assistantId}
                    />
                }
                onClickOutside={this.hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                disableReposition={true}
                contentLocation={popoverToTop}
                containerStyle={popoverToTopContainerStyle}
            >
                <Hotkeys
                    keyName={`alt+${shortcutText}`}
                    disabled={disabled}
                    onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, this.showPopover, event)}
                    filter={e => true}
                >
                    <GhostButton
                        ref={ref => (this.buttonRef = ref)}
                        title={inEditTask && smallScreen ? null : translate('Comment')}
                        type={'ghost'}
                        noBorder={inEditTask && smallScreen}
                        icon={'message-circle'}
                        buttonStyle={style}
                        onPress={this.showPopover}
                        disabled={disabled}
                        shortcutText={shortcutText}
                    />
                </Hotkeys>
            </AppPopover>
        ) : (
            <Hotkeys
                keyName={`alt+${shortcutText}`}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, this.showPopover, event)}
                filter={e => true}
            >
                <GhostButton
                    ref={ref => (this.buttonRef = ref)}
                    title={inEditTask && smallScreen ? null : translate('Comment')}
                    type={'ghost'}
                    noBorder={inEditTask && smallScreen}
                    icon={'message-circle'}
                    buttonStyle={style}
                    onPress={this.showPopover}
                    disabled={disabled}
                    shortcutText={shortcutText}
                />
            </Hotkeys>
        )
    }
}

CommentButton.propTypes = {
    disabled: PropTypes.bool,
    style: PropTypes.object,
    inEditTask: PropTypes.bool,
    saveCommentBeforeSaveTask: PropTypes.func,
    projectId: PropTypes.string,
    shortcutText: PropTypes.string,
    task: PropTypes.object,
}

export default CommentButton
