import React, { useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RichCreateTaskModal from '../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import withSafePopover from '../UIComponents/HOC/withSafePopover'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import useModalSizing from '../../hooks/useModalSizing'
import useLiftAboveKeyboard from '../../hooks/useLiftAboveKeyboard'

function AddTaskTag({
    projectId,
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
    // The empty-inbox call to action (AT-2306) is the same control at a bigger
    // size — sharing the component keeps one popup wiring (popover, float-popup
    // bookkeeping, mention-modal-aware close) instead of a second copy of it.
    large,
    openPopover,
    closePopover,
    isOpen,
}) {
    const dispatch = useDispatch()
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
    const { maxHeight: popupMaxHeight, isSheet } = useModalSizing({ size: 'L' })
    const keyboardLift = useLiftAboveKeyboard(popupCardRef)

    const handleOpen = () => {
        openPopover()
        dispatch(showFloatPopup())
    }

    const handleClose = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            closePopover()
            dispatch(hideFloatPopup())
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
                style,
            ]}
            onPress={handleOpen}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={translate('Add task')}
            accessibilityState={{ disabled: !!disabled, expanded: isOpen }}
        >
            <View style={localStyles.icon}>
                <Icon name={'check-square'} size={large ? 20 : 16} color={primary ? '#ffffff' : colors.Text03} />
            </View>
            {showLabel && (
                <Text
                    style={[
                        large ? styles.subtitle1 : styles.subtitle2,
                        localStyles.text,
                        primary && localStyles.textPrimary,
                        large && localStyles.textLarge,
                        windowTagStyle(),
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
            positions={['bottom', 'top', 'left', 'right']}
            // AT-2364: the large call to action is itself centered on the
            // screen, so an edge-aligned popup reads as off-center. Centering
            // stays library-managed (no contentLocation), which keeps the
            // vendored viewport nudge and the position-flip search working.
            align={large ? 'center' : 'start'}
            // overflow visible: the vendored popover hard-codes overflow:hidden
            // on its container, which would clip the card when
            // useLiftAboveKeyboard translates it above the keyboard.
            containerStyle={{ zIndex: 9999, overflow: 'visible' }}
            padding={8}
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
                        // The wide variant sizes itself from the modal system
                        // (see createTaskPopupWidth); a hard 300px floor here
                        // would only fight it on narrow windows.
                        ...(large ? {} : { minWidth: '300px' }),
                        ...(isSheet
                            ? {}
                            : {
                                  // Keyboard-aware cap: taller content scrolls
                                  // inside the modal's own CustomScrollView.
                                  maxHeight: popupMaxHeight,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  overflow: 'hidden',
                                  transform: keyboardLift ? `translateY(-${keyboardLift}px)` : undefined,
                                  transition: 'transform 150ms ease-out',
                              }),
                    }}
                >
                    <RichCreateTaskModal
                        initialProjectId={projectId}
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
                        wide={large}
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
    tagMobile: {
        width: 24,
        height: 24,
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
