import React, { useEffect, useRef, useState } from 'react'
import ContactItem from '../../AssigneeAndObserversModal/List/ContactItem'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { useDispatch } from 'react-redux'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../../../redux/actions'

export default function ContactList({ projectIndex, userList = [], onSelectUser, selectedUsers }) {
    const [currentItem, setCurrentItem] = useState(0)
    const itemsComponentsRefs = useRef({})
    const offsets = useRef({ top: 0, bottom: 0 })
    const scrollHeight = useRef(0)
    const scrollRef = useRef()
    const dispatch = useDispatch()

    const checkIsActive = contactUid => {
        return selectedUsers.has(contactUid)
    }

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    const onKeyDown = e => {
        const { key } = e

        if (key === 'Enter') {
            onSelectUser(userList[currentItem])
        } else if (key === 'ArrowDown') {
            scrollToFocusItem(currentItem)
            if (currentItem === userList.length - 1) {
                setCurrentItem(0)
            } else {
                setCurrentItem(currentItem + 1)
            }
        } else if (key === 'ArrowUp') {
            scrollToFocusItem(currentItem, true)
            if (currentItem === 0) {
                setCurrentItem(userList.length - 1)
            } else {
                setCurrentItem(currentItem - 1)
            }
        }
    }

    const scrollToFocusItem = (key, up = false) => {
        const id = userList[key].uid

        if (up && key - 1 === -1) {
            scrollRef?.current?.scrollTo({ y: userList.length * 60, animated: false })
        } else if (!up && key + 1 === userList.length) {
            scrollRef?.current?.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 120 : 180
            itemsComponentsRefs?.current[id]?.measure((fx, fy, width, height, px, py) => {
                if (up && fy - space < offsets.current.top) {
                    scrollRef?.current?.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.current.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + 60 - scrollHeight.current, animated: false })
                } else if (!up && fy + space > offsets.current.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + space - scrollHeight.current, animated: false })
                } else if (!up && fy + 60 < offsets.current.top) {
                    scrollRef?.current?.scrollTo({ y: fy + 60, animated: false })
                }
            })
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        dispatch(blockBackgroundTabShortcut())
        return () => dispatch(unblockBackgroundTabShortcut())
    }, [])

    return (
        <CustomScrollView
            ref={scrollRef}
            indicatorStyle={{ right: -10 }}
            scrollOnLayout={onLayout}
            onScroll={({ nativeEvent }) => {
                const y = nativeEvent.contentOffset.y
                offsets.current = { top: y, bottom: y + scrollHeight.current }
            }}
        >
            {userList.map((contact, index) => {
                return (
                    <ContactItem
                        key={index}
                        projectIndex={projectIndex}
                        contact={contact}
                        onSelectContact={onSelectUser}
                        isActive={checkIsActive(contact.uid)}
                        isHovered={index === currentItem}
                        itemsComponentsRefs={itemsComponentsRefs}
                    />
                )
            })}
        </CustomScrollView>
    )
}
