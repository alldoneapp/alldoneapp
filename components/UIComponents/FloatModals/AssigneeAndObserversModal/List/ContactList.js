import React, { useEffect, useRef, useState } from 'react'
import { ASSIGNEE_TAB, OBSERVERS_TAB } from '../Header/Header'
import ContactItem from './ContactItem'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { useDispatch } from 'react-redux'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../../../redux/actions'
import { isInputsFocused } from '../../../../../utils/HelperFunctions'

export default function ContactList({
    projectIndex,
    tab = ASSIGNEE_TAB,
    setTab,
    contactList = [],
    onSelectContact,
    selectedAssignee,
    selectedObservers,
    hideAssigneeTab,
}) {
    const [currentItem, setCurrentItem] = useState(0)
    const itemsComponentsRefs = useRef({})
    const offsets = useRef({ top: 0, bottom: 0 })
    const scrollHeight = useRef(0)
    const scrollRef = useRef()
    const dispatch = useDispatch()

    const checkIsActive = contactUid => {
        return tab === ASSIGNEE_TAB ? selectedAssignee?.uid === contactUid : selectedObservers.has(contactUid)
    }

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    const onKeyDown = e => {
        const { key, code } = e
        if (code === 'Space' && !isInputsFocused()) {
            onSelectContact(contactList[currentItem], tab)
        } else if (key === 'ArrowDown') {
            scrollToFocusItem(currentItem)
            if (currentItem === contactList.length - 1) {
                setCurrentItem(0)
            } else {
                setCurrentItem(currentItem + 1)
            }
        } else if (key === 'ArrowUp') {
            scrollToFocusItem(currentItem, true)
            if (currentItem === 0) {
                setCurrentItem(contactList.length - 1)
            } else {
                setCurrentItem(currentItem - 1)
            }
        } else if (key === 'Tab' && !hideAssigneeTab) {
            setTab(tab === ASSIGNEE_TAB ? OBSERVERS_TAB : ASSIGNEE_TAB)
        }
    }

    const scrollToFocusItem = (key, up = false) => {
        const id = contactList[key].uid

        if (up && key - 1 === -1) {
            scrollRef?.current?.scrollTo({ y: contactList.length * 60, animated: false })
        } else if (!up && key + 1 === contactList.length) {
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

    useEffect(() => {
        setCurrentItem(0)
        itemsComponentsRefs.current = {}
    }, [tab])

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
            {contactList.map((contact, index) => {
                return (
                    <ContactItem
                        key={index}
                        tab={tab}
                        projectIndex={projectIndex}
                        contact={contact}
                        onSelectContact={onSelectContact}
                        isActive={checkIsActive(contact.uid)}
                        isHovered={index === currentItem}
                        itemsComponentsRefs={itemsComponentsRefs}
                    />
                )
            })}
        </CustomScrollView>
    )
}
