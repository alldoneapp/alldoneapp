import React, { memo, useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import Backend from '../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import ShowAttachmentsModal from '../FeedView/ShowAttachmentsModal'
import Spinner from '../UIComponents/Spinner'

const AttachmentsTag = memo(props => {
    const [attachments, setAttachments] = useState([])
    const [visible, setVisible] = useState(false)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { isMobile, style } = props
    const count = attachments.length

    useEffect(() => {
        Backend.getAttachments(props.commentId).then(attachments => setAttachments(attachments))
    }, [])

    const hidePopover = () => setVisible(false)

    const showPopover = () => setVisible(true)

    return (
        <Popover
            content={<ShowAttachmentsModal attachments={attachments} hidePopover={hidePopover}></ShowAttachmentsModal>}
            onClickOutside={hidePopover}
            isOpen={visible}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
        >
            <TouchableOpacity onPress={showPopover}>
                <View style={[localStyles.container, style]}>
                    {count > 0 ? (
                        <Icon name={`paperclip`} size={16} color={colors.Text03} style={localStyles.icon} />
                    ) : (
                        <View style={{ marginLeft: 4 }}>
                            <Spinner containerSize={16} spinnerSize={12} />
                        </View>
                    )}
                    <Text
                        style={[
                            styles.subtitle2,
                            !smallScreenNavigation && !isMobile && localStyles.text,
                            windowTagStyle(),
                        ]}
                    >
                        {count > 0 ? count : ''}{' '}
                        {smallScreenNavigation || isMobile
                            ? ''
                            : count > 1
                            ? 'Attachments'
                            : count === 0
                            ? 'Loading...'
                            : 'Attachment'}
                    </Text>
                </View>
            </TouchableOpacity>
        </Popover>
    )
})

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

export default AttachmentsTag
