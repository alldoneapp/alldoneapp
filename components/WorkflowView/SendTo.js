import React, { useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import SelectUserModal from './SelectUserModal'
import { colors } from '../styles/global'
import { hideFloatPopup, setWorkflowStep, showFloatPopup } from '../../redux/actions'
import Popover from 'react-tiny-popover'
import Icon from '../Icon'
import { useDispatch, useSelector } from 'react-redux'
import Button from '../UIControls/Button'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'

const SendTo = ({ currentUser, defaultReviewer, projectIndex, onChangeValue }) => {
    const [visiblePopover, setVisiblePopover] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const sendTo = useSelector(state => state.workflowStep)
    const dispatch = useDispatch()
    const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }
    const assigneeBtnRef = useRef()

    useEffect(() => {
        return () => dispatch(setWorkflowStep({}))
    }, [])

    const getText = () => {
        const { reviewerUid } = sendTo

        if (reviewerUid) {
            const reviewerData = getUserPresentationData(reviewerUid)
            return `${translate('Send to')} ${reviewerData.shortName}`
        } else if (defaultReviewer) {
            const reviewerData = getUserPresentationData(defaultReviewer.reviewerUid)
            return `${translate('Send to')} ${reviewerData.shortName}`
        }
        return translate('Select step reviewer')
    }

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
        assigneeBtnRef?.current?.blur()
    }

    const closeModalByClickOutside = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const hidePopover = selectedUser => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditStep
        setTimeout(() => {
            setVisiblePopover(false)
            if (selectedUser) {
                dispatch([
                    hideFloatPopup(),
                    setWorkflowStep({
                        reviewerUid: selectedUser.uid,
                    }),
                ])
            }
            if (onChangeValue !== undefined) {
                onChangeValue(selectedUser)
            }
        })
    }

    return (
        <View style={buttonItemStyle}>
            <Popover
                content={
                    <SelectUserModal currentUser={currentUser} projectIndex={projectIndex} closePopover={hidePopover} />
                }
                onClickOutside={closeModalByClickOutside}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                {
                    <Hotkeys
                        keyName={'alt+A'}
                        onKeyDown={(sht, event) => execShortcutFn(assigneeBtnRef.current, showPopover, event)}
                        filter={e => true}
                    >
                        <Button
                            ref={assigneeBtnRef}
                            type={'ghost'}
                            icon={
                                sendTo.reviewerUid || defaultReviewer !== undefined ? (
                                    <Image
                                        style={localStyles.userImage}
                                        source={{
                                            uri: getUserPresentationData(
                                                sendTo.reviewerUid || defaultReviewer.reviewerUid
                                            ).photoURL,
                                        }}
                                    />
                                ) : (
                                    <View style={{ marginRight: 10 }}>
                                        <Icon name="user" size={24} color={colors.Text03} />
                                    </View>
                                )
                            }
                            title={getText()}
                            onPress={showPopover}
                            shortcutText={'A'}
                        />
                    </Hotkeys>
                }
            </Popover>
        </View>
    )
}
export default SendTo

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        borderRadius: 4,
        borderWidth: 1,
        paddingHorizontal: 16,
        borderColor: colors.Gray400,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
