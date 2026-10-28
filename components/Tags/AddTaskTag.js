import { taskHierarchyStyles } from '../TaskListView/TaskHierarchy'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import styles, {
    colors,
    PROJECT_LINE_TAG_HEIGHT,
    PROJECT_LINE_TAG_MOBILE_WIDTH,
    windowTagStyle,
} from '../styles/global'
import Icon from '../Icon'
import RichCreateTaskModal from '../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import withSafePopover from '../UIComponents/HOC/withSafePopover'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import useModalSizing from '../../hooks/useModalSizing'
import useLiftAboveKeyboard from '../../hooks/useLiftAboveKeyboard'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'
import useTaskEditorLock from '../../hooks/useTaskEditorLock'
import { MODAL_EDGE_GAP } from '../styles/modals'
import {
    FLOATING_ACTION_POPOVER_GAP,
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
} from '../UIComponents/floatingActionLayout'
import { isEditableElementFocused } from '../../utils/editingGuard'
import usePushToTalkGesture from '../../hooks/usePushToTalkGesture'
import { isDictationSupported } from '../../hooks/useRambleRecorder'
import { POINTER_CLICK_SUPPRESSION_MS, PUSH_TO_TALK_HOLD_MS } from '../UIControls/pushToTalk'
import { createPushToTalkHandoff } from '../UIControls/pushToTalkHandoff'
import { swallowNextClick } from '../../utils/swallowNextClick'

function AddTaskTag({
    projectId,
    getInitialProjectId,
    objectId,
    style,
    sourceIsPublicFor,
    lockKey,
    setPressedShowMoreMainSection,
    sourceType,
    tryExpandTasksListInGoalWhenAddTask,
    useLoggedUser,
    disabled,
    showProjectSelector,
    forceShrink,
    expandTaskListIfNeeded,
    primary,
    headerAction = true,
    iconSize,
    floating,
    // The empty-inbox call to action (AT-2306) is the same control at a bigger
    // size — sharing the component keeps one popup wiring (popover, float-popup
    // bookkeeping, mention-modal-aware close) instead of a second copy of it.
    large,
    initialTaskName,
    autoOpenKey,
    onAutoOpen,
    plusShortcutEnabled,
    // AT-2823: holding this button opens the popup straight into the title mic's push-to-talk
    // hold (release → transcribe → create the task), exactly as holding that mic would. A short
    // tap still just opens the popup. Only the board's floating "+" opts in.
    holdToDictate,
    openPopover,
    closePopover,
    isOpen,
}) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    // Keyboard-aware popup geometry (AT-2220 follow-up, iPad): the popover
    // portal is position: fixed, so when the on-screen keyboard arrives the
    // card must cap its height to the visible area and lift itself clear of
    // the keyboard — the shell shrink and the popover's viewport nudge cannot
    // do either for it. Both resolve to no-ops on desktop, and in sheet mode
    // (isSheet) the BottomSheet already rides the keyboard itself.
    const popupCardRef = useRef(null)
    const autoOpenedKeyRef = useRef(null)
    const autoOpenInitialTaskNameRef = useRef('')
    const popupLock = useFloatPopupLock()
    const taskEditorLock = useTaskEditorLock()
    const [opening, setOpening] = useState({ projectId, sequence: 0, pushToTalkHandoff: null })
    const { maxHeight: popupMaxHeight, isSheet, windowHeight, safeAreaInsets } = useModalSizing({ size: 'L' })
    const keyboardLift = useLiftAboveKeyboard(popupCardRef)
    const floatingPopupMaxHeight = Math.max(
        windowHeight -
            safeAreaInsets.top -
            safeAreaInsets.bottom -
            MODAL_EDGE_GAP -
            FLOATING_ACTION_VIEWPORT_GAP -
            FLOATING_ACTION_SIZE -
            FLOATING_ACTION_POPOVER_GAP,
        0
    )
    const resolvedPopupMaxHeight = floating ? Math.min(popupMaxHeight, floatingPopupMaxHeight) : popupMaxHeight

    const handleOpen = useCallback(
        pushToTalkHandoff => {
            // Resolve before opening: focusing the editor or locking the mobile scroller can change layout.
            const initialProjectId = getInitialProjectId ? getInitialProjectId() : projectId
            setOpening(previous => ({
                projectId: initialProjectId,
                sequence: previous.sequence + 1,
                // Only a real handoff object; `onPress` passes the press event here.
                pushToTalkHandoff: pushToTalkHandoff?.claim ? pushToTalkHandoff : null,
            }))
            openPopover()
            popupLock.acquire()
            taskEditorLock.acquire()
        },
        [getInitialProjectId, projectId, openPopover, popupLock, taskEditorLock]
    )
    const handleOpenRef = useRef(handleOpen)
    handleOpenRef.current = handleOpen

    // --- hold to dictate (AT-2823) -------------------------------------------------------------
    // The press is tracked with the mic's own gesture hook so mouse, touch and pen behave exactly
    // like a hold on the mic. Unlike the mic, nothing is recorded on press-down: a tap on "+" must
    // never switch the microphone on. Once the press has lasted `PUSH_TO_TALK_HOLD_MS` it counts
    // as a hold, the popup opens, and the hold is handed to the popup's title mic, which records,
    // draws the ring and decides on release (submit, or discard after sliding out of the ring).
    const holdToDictateEnabled = !!holdToDictate && !disabled && isDictationSupported()
    const [triggerNode, setTriggerNode] = useState(null)
    const holdTimerRef = useRef(null)
    const handoffRef = useRef(null)
    const gestureEndedAtRef = useRef(0)
    const clearHoldTimer = () => {
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current)
            holdTimerRef.current = null
        }
    }
    useEffect(() => clearHoldTimer, [])

    usePushToTalkGesture(triggerNode, {
        enabled: holdToDictateEnabled,
        onPressStart: point => {
            clearHoldTimer()
            handoffRef.current = null
            holdTimerRef.current = setTimeout(() => {
                holdTimerRef.current = null
                const handoff = createPushToTalkHandoff({ origin: point })
                handoffRef.current = handoff
                handleOpenRef.current(handoff)
            }, PUSH_TO_TALK_HOLD_MS)
        },
        onPressMove: travel => handoffRef.current?.move(travel),
        onPressEnd: release => {
            clearHoldTimer()
            gestureEndedAtRef.current = Date.now()
            const handoff = handoffRef.current
            handoffRef.current = null
            if (handoff) {
                // A mouse/pen press leaves a trailing `click`, and by now the popup is open with its
                // outside-click dismissal armed while this button no longer takes pointer events —
                // so that click would close the popup the hold just opened, mid-dictation.
                if (release.kind !== 'touch') swallowNextClick(POINTER_CLICK_SUPPRESSION_MS)
                // The timer fired at the hold threshold, so this press IS a hold even if the clock
                // the gesture reads lands a hair short of it.
                handoff.end({ ...release, heldMs: Math.max(release.heldMs, PUSH_TO_TALK_HOLD_MS) })
                return
            }
            // A tap. Same rule a plain button follows: dragging off before letting go is a no.
            if (release.cancelled || !release.releasedInside) return
            // Opening on pointerup instead of on click: the click that follows must not reach the
            // just-armed outside-click dismissal either.
            if (release.kind !== 'touch') swallowNextClick(POINTER_CLICK_SUPPRESSION_MS)
            handleOpen()
        },
    })

    useEffect(() => {
        if (!autoOpenKey || autoOpenedKeyRef.current === autoOpenKey) return
        autoOpenedKeyRef.current = autoOpenKey
        // Keep the draft locally until this popup closes. The owner clears the
        // queued share as soon as it is consumed, which can happen in the same
        // React batch as opening the (lazily mounted) popover content.
        autoOpenInitialTaskNameRef.current = initialTaskName || ''
        handleOpen()
        if (onAutoOpen) onAutoOpen()
    }, [autoOpenKey, initialTaskName, onAutoOpen, handleOpen])

    useEffect(() => {
        if (!plusShortcutEnabled) return

        const openFromShortcut = event => {
            if (
                event.key !== '+' ||
                isEditableElementFocused() ||
                document.querySelector('[aria-label="dismissible-edit-item"]')
            ) {
                return
            }

            event.preventDefault()
            event.stopPropagation()
            handleOpen()
        }

        // Capture the key before the legacy inline task sections see it in
        // their document-level bubble handlers. When the floating action is
        // visible, keyboard and pointer activation must open this same popup.
        document.addEventListener('keydown', openFromShortcut, true)
        return () => document.removeEventListener('keydown', openFromShortcut, true)
    }, [handleOpen, plusShortcutEnabled])

    const handleClose = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            closePopover()
            popupLock.release()
            taskEditorLock.release()
            autoOpenInitialTaskNameRef.current = ''
        }
    }

    // The large variant keeps its label at every width: it is the only call to
    // action on the screen it lives on, so shrinking it to a bare icon would
    // leave nothing to read.
    const showLabel = large || (!smallScreenNavigation && !forceShrink)

    const trigger = (
        <TouchableOpacity
            style={[
                localStyles.tag,
                primary && localStyles.tagPrimary,
                !large && (smallScreenNavigation || forceShrink) && localStyles.tagMobile,
                large && localStyles.tagLarge,
                // Must stay after `tagPrimary` so it wins the background and
                // border it overrides, and before `style` so a caller-supplied
                // override still has the last word (unchanged precedence).
                primary && large && localStyles.tagLargePrimary,
                headerAction && !large && taskHierarchyStyles.headerAddButton,
                headerAction &&
                    !large &&
                    (smallScreenNavigation || forceShrink) &&
                    taskHierarchyStyles.headerAddButtonMobile,
                style,
            ]}
            ref={holdToDictate ? setTriggerNode : undefined}
            onPress={() => {
                // With hold-to-dictate on, mouse and touch are owned by the gesture above;
                // react-native-web still fires `onPress` from a pointer press's trailing click,
                // which must not open (and so remount) the popup a second time. What remains is
                // keyboard activation (Enter/Space).
                if (holdToDictateEnabled && Date.now() - gestureEndedAtRef.current < POINTER_CLICK_SUPPRESSION_MS) {
                    return
                }
                handleOpen()
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={translate('Add task')}
            accessibilityState={{ disabled: !!disabled, expanded: isOpen }}
        >
            <View style={localStyles.icon}>
                <Icon
                    name={headerAction && !large ? 'plus' : 'check-square'}
                    size={iconSize || (large ? 20 : 16)}
                    color={(headerAction && !large) || primary ? '#ffffff' : colors.Text03}
                />
            </View>
            {showLabel && (
                <Text
                    style={[
                        large ? styles.subtitle1 : styles.subtitle2,
                        localStyles.text,
                        primary && localStyles.textPrimary,
                        large && localStyles.textLarge,
                        windowTagStyle(),
                        headerAction && !large && taskHierarchyStyles.headerAddText,
                    ]}
                >
                    {translate('Add task')}
                </Text>
            )}
        </TouchableOpacity>
    )

    return (
        <AppPopover
            isOpen={isOpen}
            // The floating action sits at the viewport's bottom-right edge, so
            // its desktop popup must open above it and align their right edges.
            // Mobile remains a modal-system BottomSheet via AppPopover.
            position={floating ? ['top'] : undefined}
            // AT-2364: the large call to action is itself centered on the
            // screen, so an edge-aligned popup reads as off-center. Centering
            // stays library-managed (no contentLocation), which keeps the
            // vendored viewport nudge and the position-flip search working.
            align={floating ? 'end' : large ? 'center' : 'start'}
            // overflow visible: the vendored popover hard-codes overflow:hidden
            // on its container, which would clip the card when
            // useLiftAboveKeyboard translates it above the keyboard.
            containerStyle={{ zIndex: 9999, overflow: 'visible' }}
            padding={floating ? FLOATING_ACTION_POPOVER_GAP : 8}
            windowBorderPadding={floating ? MODAL_EDGE_GAP : undefined}
            offsetY={5}
            onClickOutside={handleClose}
            content={
                <div
                    ref={popupCardRef}
                    style={{
                        position: 'relative',
                        backgroundColor: 'var(--background-primary)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                        // RichCreateTaskModal owns the responsive card width.
                        // Keeping a second floor here would fight that sizing
                        // on narrow windows.
                        ...(isSheet
                            ? {}
                            : {
                                  // Keyboard-aware cap: taller content scrolls
                                  // inside the modal's own CustomScrollView.
                                  maxHeight: resolvedPopupMaxHeight,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  overflow: 'hidden',
                                  transform: keyboardLift ? `translateY(-${keyboardLift}px)` : undefined,
                                  transition: 'transform 150ms ease-out',
                              }),
                    }}
                >
                    <RichCreateTaskModal
                        key={opening.sequence}
                        initialProjectId={opening.sequence ? opening.projectId : projectId}
                        sourceType={sourceType}
                        sourceId={objectId}
                        closeModal={handleClose}
                        sourceIsPublicFor={sourceIsPublicFor}
                        lockKey={lockKey}
                        fromTaskList={true}
                        useLoggedUser={useLoggedUser}
                        setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                        tryExpandTasksListInGoalWhenAddTask={tryExpandTasksListInGoalWhenAddTask}
                        showProjectSelector={showProjectSelector}
                        expandTaskListIfNeeded={expandTaskListIfNeeded}
                        initialTaskName={autoOpenInitialTaskNameRef.current || initialTaskName}
                        pushToTalkHandoff={opening.pushToTalkHandoff}
                    />
                </div>
            }
        >
            {trigger}
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Text03,
        paddingHorizontal: 4,
    },
    tagPrimary: {
        backgroundColor: colors.UtilityBlue200,
        borderColor: colors.UtilityBlue150,
    },
    // Icon-only, so the pill is the whole tap target: it is widened past the
    // icon's own 24px box to stay comfortably pressable with a thumb. Height is
    // unchanged because the header row caps it - see the tokens' comment in
    // styles/global for why width is the only axis available here.
    tagMobile: {
        width: PROJECT_LINE_TAG_MOBILE_WIDTH,
        height: PROJECT_LINE_TAG_HEIGHT,
    },
    tagLarge: {
        height: 44,
        paddingHorizontal: 20,
        alignSelf: 'center',
    },
    // AT-2389: the big call to action is the primary action of the screen it
    // lives on, so it takes the app's primary blue instead of the lighter tint
    // the small pills share with the assistant Search button
    // (AssistantTaskSearchButtonWrapper) — that pairing is deliberate and stays
    // as it is, which is why this is a `large`-only variant rather than an edit
    // to `tagPrimary`. Border matches the fill so the pill reads as one solid
    // primary button; keeping the 1px border (rather than dropping it) leaves
    // the button's measured height and padding byte-identical.
    tagLargePrimary: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    textPrimary: {
        color: '#ffffff',
    },
    textLarge: {
        marginLeft: 10,
        marginRight: 2,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
})

export default withSafePopover(AddTaskTag)
