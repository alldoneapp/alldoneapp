const removeObjectFollowData = async (projectId, objectType, objectId, admin) => {
    const followersData = (await admin.firestore().doc(`followers/${projectId}/${objectType}/${objectId}`).get()).data()
    const followerIds = followersData ? followersData.usersFollowing : []

    const promises = []
    promises.push(admin.firestore().doc(`followers/${projectId}/${objectType}/${objectId}`).delete())
    followerIds.forEach(userId => {
        promises.push(
            admin
                .firestore()
                .doc(`usersFollowing/${projectId}/entries/${userId}`)
                .update({
                    [`${objectType}.${objectId}`]: admin.firestore.FieldValue.delete(),
                })
        )
    })
    await Promise.all(promises)
}

module.exports = { removeObjectFollowData }
