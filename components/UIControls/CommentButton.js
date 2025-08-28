import React, { Component } from 'react'
import Popover from 'react-tiny-popover'
import store from '../../redux/store'
import PropTypes from 'prop-types'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import GhostButton from './GhostButton'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn, popoverToTop } from '../../utils/HelperFunctions'
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

class CommentButton extends Component {
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
            setTimeout(async () => {
                const { onDismissPopup } = this.props
                this.setState({ visiblePopover: false })
                store.dispatch(hideFloatPopup())
                if (onDismissPopup) onDismissPopup()
            })
        }
    }

    showPopover = () => {
        if (!this.state.visiblePopover) {
            this.setState({ visiblePopover: true })
            store.dispatch(showFloatPopup())
        }
    }

    changeValue = (comment, mentions, isPrivate, hasKarma) => {
        const { isQuillTagEditorOpen, openModals, assistantEnabled } = store.getState()
        const { projectId, task } = this.props
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
                createObjectMessage(projectId, task.id, comment, 'tasks', STAYWARD_COMMENT, null, null)
            }
        }
    }

    render() {
        const { disabled, style, inEditTask, projectId, shortcutText, task } = this.props
        const { visiblePopover, smallScreen } = this.state
        return (
            <Popover
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
            </Popover>
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
