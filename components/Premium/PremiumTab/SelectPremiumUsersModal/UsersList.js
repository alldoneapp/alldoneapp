import React, { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { PLAN_STATUS_PREMIUM } from '../../PremiumHelper'
import UserItem from './UserItem'

export default function UsersList({ tmpSelectedUsersIds, setTmpSelectedUsersIds, filteredUsers }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const offsets = useRef({ top: 0, bottom: 0 })
    const scrollHeight = useRef(0)
    const scrollRef = useRef()

    const toggleSelection = (isSelected, userId) => {
        setTmpSelectedUsersIds(selectedIds =>
            isSelected ? selectedIds.filter(id => id !== userId) : [...selectedIds, userId]
        )
    }

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    return (
        <CustomScrollView
            ref={scrollRef}
            indicatorStyle={{ right: -2 }}
            scrollOnLayout={onLayout}
            onScroll={({ nativeEvent }) => {
                const y = nativeEvent.contentOffset.y
                offsets.current = { top: y, bottom: y + scrollHeight.current }
            }}
        >
            {filteredUsers.map(user => {
                const isSelected = tmpSelectedUsersIds.includes(user.uid)
                const paidByOtherUser =
                    user.premium.status === PLAN_STATUS_PREMIUM && user.premium.userPayingId !== loggedUserId
                return (
                    <View key={user.uid}>
                        {isSelected && <View style={localStyles.selectedItemBackground} />}
                        <UserItem
                            key={user.uid}
                            user={user}
                            toggleSelection={toggleSelection}
                            isSelected={isSelected}
                            paidByOtherUser={paidByOtherUser}
                        />
                    </View>
                )
            })}
        </CustomScrollView>
    )
}

const localStyles = StyleSheet.create({
    selectedItemBackground: {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.Text03,
        opacity: 0.16,
        borderRadius: 4,
    },
})
