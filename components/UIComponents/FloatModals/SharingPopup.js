import React from 'react'
import { Clipboard, StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'
import Icon from '../../Icon'
import Hotkeys from 'react-hot-keys'
import { TouchableOpacity } from 'react-native-gesture-handler'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import { findIndex } from 'lodash'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'

export const SHARE_ALL_SEE_MEMBER_EDIT = 0
export const SHARE_ALL_SEE_ALL_EDIT = 1
export const SHARE_MEMBER_SEE_MEMBER_EDIT = 2

export const SHARING_OPTIONS = [
    { value: SHARE_ALL_SEE_ALL_EDIT, text: 'Everybody with link can see and edit', shortcut: '1' },
    { value: SHARE_ALL_SEE_MEMBER_EDIT, text: 'Everybody can see, only project members can edit', shortcut: '2' },
    { value: SHARE_MEMBER_SEE_MEMBER_EDIT, text: 'Only Project Members can see and edit', shortcut: '3' },
]

export const getSharingOptionText = option => {
    let index = findIndex(SHARING_OPTIONS, ['value', option])
    return SHARING_OPTIONS[index].text
}

export default function SharingPopup({ currentOption = SHARE_ALL_SEE_MEMBER_EDIT, closeModal, onSuccess, link }) {
    const [width, height] = useWindowSize()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const copyLink = () => {
        Clipboard.setString(link)
        closeModal()
    }

    const renderOption = (option, i) => {
        const isSelected = option.value === currentOption

        return (
            <View key={i} style={localStyles.optionContainer}>
                <Hotkeys
                    key={i}
                    keyName={option.shortcut}
                    onKeyDown={(sht, event) => onSuccess(option.value)}
                    filter={e => true}
                >
                    <TouchableOpacity onPress={() => onSuccess(option.value)}>
                        <View
                            style={[localStyles.sharingSectionItem, !smallScreenNavigation && localStyles.optionItem]}
                        >
                            <View style={localStyles.sectionItemText}>
                                <Text
                                    style={[
                                        styles.subtitle1,
                                        { color: isSelected ? colors.Primary100 : '#ffffff', maxWidth: 240 },
                                    ]}
                                >
                                    {option.text}
                                </Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {!smallScreenNavigation ? (
                                    <Shortcut
                                        text={option.shortcut}
                                        theme={SHORTCUT_LIGHT}
                                        containerStyle={{ top: 1 }}
                                    />
                                ) : (
                                    isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />
                                )}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={localStyles.title}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>Configure sharing settings</Text>
                    <Text style={[styles.body2, { color: colors.Text03, flexWrap: 'wrap' }]}>
                        <Icon name={'info'} size={18} color={colors.Text03} style={{ top: 2, marginRight: 8 }} />
                        <Text>If the privacy is set to Private, only the owner can see it</Text>
                    </Text>
                </View>
                <View style={localStyles.sharingSection}>{SHARING_OPTIONS.map(renderOption)}</View>

                <View style={localStyles.sectionSeparator} />

                <View style={localStyles.sharingSection}>
                    <Hotkeys keyName={'4'} onKeyDown={(sht, event) => copyLink()} filter={e => true}>
                        <TouchableOpacity style={localStyles.sharingSectionItem} onPress={() => copyLink()}>
                            <View style={localStyles.sharingSectionItem}>
                                <View style={localStyles.sectionItemText}>
                                    <Icon name={'share-2'} size={24} color={'#ffffff'} style={{ marginRight: 8 }} />
                                    <Text style={[styles.subtitle1, { color: '#ffffff' }]}>Copy link to share</Text>
                                </View>
                                <View style={localStyles.sectionItemCheck}>
                                    {!smallScreenNavigation && <Shortcut text={'4'} theme={SHORTCUT_LIGHT} />}
                                </View>
                            </View>
                        </TouchableOpacity>
                    </Hotkeys>
                </View>

                <CloseButton
                    close={e => {
                        if (e) {
                            e.preventDefault()
                            e.stopPropagation()
                        }
                        closeModal()
                    }}
                />
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingBottom: 8,
    },
    optionContainer: {
        flex: 1,
        minHeight: 64,
        paddingVertical: 8,
        justifyContent: 'center',
    },
    title: {
        marginBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 8,
    },
    sharingSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
    },
    sharingSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    optionItem: {
        alignItems: 'flex-start',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        justifyContent: 'flex-end',
    },
    actionButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 8,
    },
})
