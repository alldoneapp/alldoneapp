import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import Popover from 'react-tiny-popover'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import DescriptionModal from '../UIComponents/FloatModals/DescriptionModal/DescriptionModal'
import { cleanTextMetaData, shrinkTagText } from '../../functions/Utils/parseTextUtils'

export default function DescriptionTag({
    projectId,
    object,
    style,
    disabled,
    onDismissPopup,
    objectType,
    outline,
    updateDescription,
    compact,
}) {
    const mobile = useSelector(state => state.mobile)
    const tablet = useSelector(state => state.isMiddleScreen)
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const textLimit = mobile ? 15 : tablet ? 20 : 25

    const hidePopover = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    const showPopover = () => {
        if (!isOpen) {
            setIsOpen(true)
            dispatch(showFloatPopup())
        }
    }

    return (
        <Popover
            content={
                <DescriptionModal
                    projectId={projectId}
                    object={object}
                    closeModal={hidePopover}
                    objectType={objectType}
                    updateDescription={updateDescription}
                />
            }
            onClickOutside={hidePopover}
            isOpen={isOpen}
            position={['left', 'right', 'top', 'bottom']}
            padding={4}
            align={'end'}
            contentLocation={mobile ? null : undefined}
        >
            <TouchableOpacity onPress={showPopover} disabled={disabled} accessible={false}>
                <View
                    style={[
                        (outline ? otl : localStyles).container,
                        compact && !outline && compactStyles.container,
                        style,
                    ]}
                >
                    <Icon
                        name={'info'}
                        size={outline ? 14 : compact ? 9.6 : 16}
                        color={outline ? colors.UtilityBlue200 : colors.Text03}
                        style={compact && !outline ? compactStyles.icon : localStyles.icon}
                    />
                    {!outline && !mobile && (
                        <Text
                            style={[
                                styles.subtitle2,
                                !mobile && localStyles.text,
                                compact && compactStyles.text,
                                windowTagStyle(),
                            ]}
                        >
                            {shrinkTagText(cleanTextMetaData(object.description, true), textLimit)}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
})

const compactStyles = StyleSheet.create({
    container: {
        borderRadius: 7.2,
        height: 14.4,
    },
    icon: {
        marginHorizontal: 2.4,
    },
    text: {
        fontSize: 8.4,
        lineHeight: 13.2,
        marginVertical: 0.6,
        marginRight: 6,
        marginLeft: 1.2,
    },
})
