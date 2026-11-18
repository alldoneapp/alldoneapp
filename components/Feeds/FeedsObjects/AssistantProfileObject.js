import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import { hideFloatPopup, navigateToSettings, showFloatPopup } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'
import { getTimeFormatForDateFormat } from '../../../utils/dateTimeFormats'
import NavigationService from '../../../utils/NavigationService'
import NewFeedDot from '../FollowSwitchableTag/NewFeedDot'
import AssistantProfileChangeModal from '../../AssistantProfile/AssistantProfileChangeModal'
import {
    FEED_ASSISTANT_PROFILE_PAUSED,
    getAssistantProfileFeedRevision,
} from '../../../functions/AssistantProfile/assistantProfileFeedModel'

function openProfileSettings(dispatch) {
    dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
    NavigationService.navigate('SettingsView')
}

function ProfileChangeLine({ feed, disabled }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const timeFormat = useSelector(state => getTimeFormatForDateFormat(state.dateFormat))
    const [open, setOpen] = useState(false)
    const revision = getAssistantProfileFeedRevision(feed)
    const paused = feed.type === FEED_ASSISTANT_PROFILE_PAUSED
    if (!revision && !paused) return null

    const close = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }
    const time = feed.lastChangeDate ? moment(feed.lastChangeDate).format(timeFormat) : ''

    if (paused) {
        return (
            <View testID="assistant-profile-feed-paused" style={localStyles.line}>
                {!!time && <Text style={localStyles.time}>{time}</Text>}
                <Text style={localStyles.text}>{translate('Assistant profile paused at the monthly Gold limit')}</Text>
                <Text
                    style={localStyles.link}
                    accessibilityRole="link"
                    onPress={disabled ? undefined : () => openProfileSettings(dispatch)}
                >
                    {translate('Profile settings')}
                </Text>
            </View>
        )
    }

    return (
        <View testID={`assistant-profile-feed-revision-${revision}`} style={localStyles.line}>
            {!!time && <Text style={localStyles.time}>{time}</Text>}
            <Text style={localStyles.text}>{translate('Your assistant profile was updated')}</Text>
            <AppPopover
                content={<AssistantProfileChangeModal revision={revision} closeModal={close} />}
                align={'start'}
                position={['bottom', 'top', 'left', 'right']}
                onClickOutside={close}
                isOpen={open}
                contentLocation={mobile ? null : undefined}
            >
                <Text
                    testID={`assistant-profile-feed-show-${revision}`}
                    style={localStyles.link}
                    accessibilityRole="link"
                    onPress={
                        disabled || open
                            ? undefined
                            : () => {
                                  setOpen(true)
                                  dispatch(showFloatPopup())
                              }
                    }
                >
                    {translate('Show changes')}
                </Text>
            </AppPopover>
        </View>
    )
}

// The private Updates card of the assistant profile (AT-3072): one line per version the nightly run
// wrote, each opening what changed. Only its owner ever receives these entries (isPublicFor: [uid]).
export default function AssistantProfileObject({ feedObjectData, feedActiveTab, style }) {
    const dispatch = useDispatch()
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const feeds = [...(feedObjectData?.feeds || [])].sort((a, b) => (b.lastChangeDate || 0) - (a.lastChangeDate || 0))
    if (feeds.length === 0) return null
    const hasUnread = feeds.some(feed => feed.showLikeNew)

    return (
        <View testID="assistant-profile-feed-object" style={style}>
            <TouchableOpacity
                style={localStyles.header}
                onPress={() => openProfileSettings(dispatch)}
                disabled={activeModalInFeed}
                accessibilityRole="button"
                accessibilityHint={translate('Profile settings')}
            >
                {hasUnread && <NewFeedDot feedActiveTab={feedActiveTab} isMiddleScreen={isMiddleScreen} />}
                <Icon name="user-check" color={colors.Text03} size={24} />
                <Text style={localStyles.title} numberOfLines={1}>
                    {translate('Assistant profile')}
                </Text>
            </TouchableOpacity>
            <View style={localStyles.lines}>
                {feeds.map(feed => (
                    <ProfileChangeLine key={feed.id} feed={feed} disabled={activeModalInFeed} />
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    title: {
        ...styles.body1,
        color: colors.Text01,
        paddingLeft: 12,
        flex: 1,
    },
    lines: {
        marginLeft: 36,
    },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        paddingVertical: 4,
    },
    time: {
        ...styles.body3,
        color: colors.Text03,
    },
    text: {
        ...styles.body2,
        color: colors.Text02,
    },
    link: {
        ...styles.body2,
        color: colors.Primary100,
    },
})
