import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import PrivacyModal from '../UIComponents/FloatModals/PrivacyModal/PrivacyModal'
import ButtonUsersGroup from '../UIComponents/FloatModals/PrivacyModal/ButtonUsersGroup'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_PUBLIC_FOR_ALL, FEED_USER_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import ContactsHelper from '../ContactsView/Utils/ContactsHelper'
import { translate } from '../../i18n/TranslationService'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'

export default function PrivacyTag({ projectId, object, objectType, isMobile, style, disabled, callback, outline }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [visiblePopover, setVisiblePopover] = useState(false)
    const isUnmountedRef = useRef(false)
    const hideTimeoutRef = useRef(null)
    const popupLock = useFloatPopupLock()

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current)
                hideTimeoutRef.current = null
            }
        }
    }, [])

    const hidePopover = () => {
        if (isUnmountedRef.current) return
        setVisiblePopover(false)
        popupLock.release()
    }

    const delayHidePopover = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }

        hideTimeoutRef.current = setTimeout(async () => {
            hideTimeoutRef.current = null
            hidePopover()
        })
    }

    const showPopover = () => {
        if (isUnmountedRef.current) return
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
        }
        setVisiblePopover(true)
        popupLock.acquire()
    }

    if (objectType === FEED_USER_OBJECT_TYPE) {
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        ContactsHelper.getAndAssignUserPrivacy(projectIndex, object)
    }

    return visiblePopover ? (
        <AppPopover
            content={
                <PrivacyModal
                    object={object}
                    objectType={objectType}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                    callback={callback}
                />
            }
            onClickOutside={delayHidePopover}
            isOpen={true}
            position={['left', 'right', 'top', 'bottom']}
            padding={4}
            align={'end'}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity onPress={showPopover} disabled={disabled} accessible={false}>
                {outline ? (
                    <View style={[localStyles.outlineContainer, style]}>
                        <Icon
                            name={object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? 'unlock' : 'lock'}
                            size={14}
                            color={colors.UtilityBlue200}
                            style={localStyles.outlineIcon}
                        />
                    </View>
                ) : (
                    <View style={[localStyles.container, style]}>
                        {object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? (
                            <Icon name={'unlock'} size={16} color={colors.Text03} style={localStyles.icon} />
                        ) : (
                            <View style={{ marginHorizontal: 2 }}>
                                <ButtonUsersGroup projectId={projectId} users={object.isPublicFor} inTag={true} />
                            </View>
                        )}
                        <Text
                            style={[
                                styles.subtitle2,
                                !smallScreenNavigation && !isMobile && localStyles.text,
                                windowTagStyle(),
                            ]}
                        >
                            {smallScreenNavigation || isMobile
                                ? ''
                                : object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                                  ? translate('Project-wide')
                                  : translate('Private')}
                        </Text>
                        {smallScreenNavigation && !object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (
                            <Icon name={'lock'} size={16} color={colors.Text03} style={localStyles.icon} />
                        )}
                    </View>
                )}
            </TouchableOpacity>
        </AppPopover>
    ) : (
        <TouchableOpacity onPress={showPopover} disabled={disabled} accessible={false}>
            {outline ? (
                <View style={[localStyles.outlineContainer, style]}>
                    <Icon
                        name={object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? 'unlock' : 'lock'}
                        size={14}
                        color={colors.UtilityBlue200}
                        style={localStyles.outlineIcon}
                    />
                </View>
            ) : (
                <View style={[localStyles.container, style]}>
                    {object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? (
                        <Icon name={'unlock'} size={16} color={colors.Text03} style={localStyles.icon} />
                    ) : (
                        <View style={{ marginHorizontal: 2 }}>
                            <ButtonUsersGroup projectId={projectId} users={object.isPublicFor} inTag={true} />
                        </View>
                    )}
                    <Text
                        style={[
                            styles.subtitle2,
                            !smallScreenNavigation && !isMobile && localStyles.text,
                            windowTagStyle(),
                        ]}
                    >
                        {smallScreenNavigation || isMobile
                            ? ''
                            : object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                              ? translate('Project-wide')
                              : translate('Private')}
                    </Text>
                    {smallScreenNavigation && !object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (
                        <Icon name={'lock'} size={16} color={colors.Text03} style={localStyles.icon} />
                    )}
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 50,
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
    outlineContainer: {
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
    outlineIcon: {
        marginHorizontal: 2,
    },
})
