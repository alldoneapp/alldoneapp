import React from 'react'
import { Image } from 'react-native'

import useGetUserPresentationData from '../ContactsView/Utils/useGetUserPresentationData'

export default function ChatHeaderMemeber({ memberId, photoStyle }) {
    const { photoURL } = useGetUserPresentationData(memberId)
    return <Image style={photoStyle} source={{ uri: photoURL }} />
}
