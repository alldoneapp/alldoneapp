import React from 'react'
import { View } from 'react-native'

import Comment from '../../../Feeds/FeedsModals/ListCommentsComponents/Comment'

export default function CommentsList({ projectId, comments }) {
    return (
        <View>
            {comments.map((item, index) => {
                return (
                    <Comment
                        key={item.id}
                        comment={item}
                        projectId={projectId}
                        containerStyle={{
                            marginBottom:
                                index === 0 && comments.length > 1 ? 16 : index > 0 && comments.length > 2 ? 8 : 0,
                        }}
                    />
                )
            })}
        </View>
    )
}
