import React, { useEffect, useState, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { View } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import PrivateItem from './PrivateItem'
import PublicItem from './PublicItem'
import UserItem from './UserItem'

export default function OptionsList({
    isPrivate,
    setPublic,
    setPrivate,
    activeOptionIndex,
    ownerText,
    selectUser,
    optionList,
    tmpIsPublicFor,
    setActiveOptionIndex,
    projectId,
    userWithPermanentAccessIds,
    ownerIds,
}) {
    const [offsets, setOffsets] = useState({ top: 0, bottom: 0 })
    const [scrollHeight, setScrollHeight] = useState(0)

    const scrollRef = useRef(null)
    const itemsRefs = useRef([])

    const PUBLIC_ITEM = 0
    const PRIVATE_ITEM = 1

    const userIds = optionList.slice(2 + ownerIds.length)

    const onLayoutScroll = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        setOffsets({ top: 0, bottom: data.nativeEvent.layout.height })
        setScrollHeight(data.nativeEvent.layout.height)
    }

    const onScroll = ({ nativeEvent }) => {
        const y = nativeEvent.contentOffset.y
        setOffsets({ top: y, bottom: y + scrollHeight })
    }

    const scrollToFocusItem = (key, up = false) => {
        if (up && key - 1 === -1) {
            scrollRef.current.scrollTo({ y: optionList.length * 48, animated: false })
        } else if (!up && key + 1 === optionList.length) {
            scrollRef.current.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 96 : 144
            itemsRefs.current[key]?.measure((fx, fy, width, height, px, py) => {
                if (up && fy - space < offsets.top) {
                    scrollRef.current.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.bottom) {
                    scrollRef.current.scrollTo({ y: fy + 48 - scrollHeight, animated: false })
                } else if (!up && fy + space > offsets.bottom) {
                    scrollRef.current.scrollTo({ y: fy + space - scrollHeight, animated: false })
                } else if (!up && fy + 48 < offsets.top) {
                    scrollRef.current.scrollTo({ y: fy + 48, animated: false })
                }
            })
        }
    }

    const selectDown = () => {
        scrollToFocusItem(activeOptionIndex)
        if (activeOptionIndex + 1 === optionList.length) {
            setActiveOptionIndex(0)
        } else {
            setActiveOptionIndex(activeOptionIndex + 1)
        }
    }

    const selectUp = () => {
        scrollToFocusItem(activeOptionIndex, true)
        if (activeOptionIndex - 1 === -1) {
            setActiveOptionIndex(optionList.length - 1)
        } else {
            setActiveOptionIndex(activeOptionIndex - 1)
        }
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'ArrowDown') {
            selectDown()
        } else if (key === 'ArrowUp') {
            selectUp()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <>
            <View style={localStyles.section}>
                <PublicItem selected={!isPrivate} onPress={setPublic} hovered={activeOptionIndex === PUBLIC_ITEM} />
            </View>

            <View style={localStyles.line} />

            <View style={[localStyles.section, localStyles.usersSection]}>
                <PrivateItem selected={isPrivate} onPress={setPrivate} hovered={activeOptionIndex === PRIVATE_ITEM} />

                <CustomScrollView
                    ref={scrollRef}
                    contentContainerStyle={{ maxHeight: 192 }}
                    scrollOnLayout={onLayoutScroll}
                    onScroll={onScroll}
                >
                    {ownerIds.map((ownerId, index) => {
                        const itemRefIndex = PRIVATE_ITEM + index + 1
                        return (
                            <UserItem
                                key={ownerId}
                                isOwner={true}
                                ownerText={translate(ownerText)}
                                onPress={(e, userId) => {
                                    selectUser(e, userId, itemRefIndex)
                                }}
                                hovered={activeOptionIndex === optionList.indexOf(ownerId)}
                                itemsRefs={itemsRefs.current}
                                itemRefIndex={itemRefIndex}
                                userId={ownerId}
                                projectId={projectId}
                            />
                        )
                    })}

                    {userIds.map((userId, index) => {
                        const itemRefIndex = index + 2 + ownerIds.length
                        return (
                            <UserItem
                                key={userId}
                                isOwner={userWithPermanentAccessIds.includes(userId)}
                                onPress={(e, userId) => selectUser(e, userId, itemRefIndex)}
                                selected={tmpIsPublicFor.includes(userId)}
                                hovered={activeOptionIndex === optionList.indexOf(userId)}
                                itemsRefs={itemsRefs.current}
                                itemRefIndex={itemRefIndex}
                                userId={userId}
                                projectId={projectId}
                            />
                        )
                    })}
                </CustomScrollView>
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    section: {
        paddingLeft: 16,
        paddingRight: 16,
    },
    usersSection: {
        paddingLeft: 8,
        paddingRight: 8,
        flexShrink: 1,
    },
    line: {
        height: 1,
        borderTopWidth: 1,
        borderTopColor: '#ffffff',
        opacity: 0.2,
        marginTop: 8,
        marginBottom: 8,
    },
})
