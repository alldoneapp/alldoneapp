import React, { useEffect, useRef, useState } from 'react'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import AssistantToolsModal from '../../../UIComponents/FloatModals/AssistantToolsModal/AssistantToolsModal'
import BrowserAllowlistModal from '../../../UIComponents/FloatModals/BrowserAllowlistModal/BrowserAllowlistModal'
import { updateAssistant } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { BROWSER_TOOL_KEY, TOOL_OPTIONS, normalizeAllowedTools } from './toolOptions'

export default function ToolsAccessWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    // The allowlist lives on the project, so the row's count follows a project change without this
    // component owning any copy of it.
    const browserAutomation = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.browserAutomation)

    const [isOpen, setIsOpen] = useState(false)
    const [allowlistOpen, setAllowlistOpen] = useState(false)
    const isOpenRef = useRef(false)

    const allowedTools = normalizeAllowedTools(assistant.allowedTools)
    const allowedDomains = Array.isArray(browserAutomation?.allowedDomains) ? browserAutomation.allowedDomains : []

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const closeAllowlist = () => {
        setAllowlistOpen(false)
        dispatch(hideFloatPopup())
    }

    /**
     * Hand over from the tools modal to the allowlist editor SEQUENTIALLY rather than nesting one
     * popover inside the other: a nested `react-tiny-popover` treats a tap in the child as an
     * outside click of the parent and closes the whole thing (see the EmailLabelChip note in
     * CLAUDE.md). Closing first also means the tool selection the user has made so far is applied
     * before they leave, so it is not silently discarded.
     */
    const openAllowlist = pendingTools => {
        if (Array.isArray(pendingTools)) applyTools(pendingTools)
        setIsOpen(false)
        setAllowlistOpen(true)
    }

    useEffect(() => {
        isOpenRef.current = isOpen || allowlistOpen
    }, [isOpen, allowlistOpen])

    useEffect(() => {
        return () => {
            if (isOpenRef.current) dispatch(hideFloatPopup())
        }
    }, [])

    const applyTools = tools => {
        updateAssistant(projectId, { ...assistant, allowedTools: tools }, assistant)
    }

    const buttonLabel = `${translate('Edit')} (${allowedTools.length}/${TOOL_OPTIONS.length})`

    return (
        <AppPopover
            content={
                allowlistOpen ? (
                    <BrowserAllowlistModal
                        projectId={projectId}
                        browserAutomation={browserAutomation}
                        closeModal={closeAllowlist}
                    />
                ) : (
                    <AssistantToolsModal
                        allowedTools={allowedTools}
                        onApply={applyTools}
                        closeModal={closeModal}
                        onEditBrowserAllowlist={openAllowlist}
                        browserAllowlistCount={allowedDomains.length}
                    />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={allowlistOpen ? closeAllowlist : closeModal}
            isOpen={isOpen || allowlistOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+O'}
                disabled={blockShortcuts || isOpen || allowlistOpen || disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.btnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit-2'}
                    onPress={openModal}
                    disabled={isOpen || allowlistOpen || disabled}
                    shortcutText={'O'}
                    title={buttonLabel}
                />
            </Hotkeys>
        </AppPopover>
    )
}

// Exported for the Tools Access suite: the key the allowlist row is attached to must be the same
// key the server fans out into the six browser tools.
export { BROWSER_TOOL_KEY }
