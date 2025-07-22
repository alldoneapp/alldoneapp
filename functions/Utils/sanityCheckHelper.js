const admin = require('firebase-admin')
const { getUserData } = require('../Users/usersFirestore')

const sanityCheck = async res => {
    const broken_auth_user_pair = []
    // Check for BROKEN_AUTH_USER_PAIR
    const listAllUsers = async nextPageToken => {
        const listUsersResult = await admin.auth().listUsers(1000, nextPageToken)

        for (let userRecord of listUsersResult.users) {
            let user = userRecord.toJSON()
            const refUser = await getUserData(user.uid)
            if (!refUser) {
                broken_auth_user_pair.push(user)
            }
        }
        if (listUsersResult.pageToken) {
            // List next batch of users.
            await listAllUsers(listUsersResult.pageToken)
        }
    }
    // Start listing users from the beginning, 1000 at a time.
    await listAllUsers()
    res.status(200).send(broken_auth_user_pair)
}

module.exports = { sanityCheck }
