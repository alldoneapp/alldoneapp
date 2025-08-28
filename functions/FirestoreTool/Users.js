'use strict'
const helperFn = require('./Utils/HelperFunctions')
const admin = require('firebase-admin')
const moment = require('moment')
const firebase_tools = require('firebase-tools')

const EXPORT_OPTION_LIST = 'LIST'
const EXPORT_OPTION_SAVE = 'SAVE'
const IMPORT_OPTION_FILE = 'FILE'

/**
 * Export users from the Auth section of Firebase
 * Can export users to a file or print in the screen.
 *
 * @param appAdmin
 * @param option
 * @param file
 * @returns {Promise<R>}
 */
const exportUsers = (appAdmin, option, file) => {
    return new Promise((resolve, reject) => {
        let users = []

        if (appAdmin) {
            const getUsers = (appAdmin, nextPageToken) => {
                appAdmin
                    .auth()
                    .listUsers(1000, nextPageToken)
                    .then(async listUsersResult => {
                        users = users.concat(listUsersResult.users)

                        if (listUsersResult.pageToken) {
                            // List next batch of users.
                            getUsers(appAdmin, listUsersResult.pageToken)
                        } else {
                            const serializedUsers = JSON.stringify(users, null, 2)
                            if (option === EXPORT_OPTION_LIST) {
                                console.log(serializedUsers)
                            }
                            if (option === EXPORT_OPTION_SAVE) {
                                helperFn.writeFile(file, serializedUsers)
                            }

                            resolve(users)
                        }
                    })
                    .catch(error => {
                        console.log('ERROR: Error listing users:', error)
                        reject(error)
                    })
            }

            getUsers(appAdmin)
        } else {
            console.log('ERROR: You must pass an App Admin instance!')
        }
    })
}

/**
 * Export users from the user collection of the DB
 * Can export users to a file or print in the screen.
 *
 * @param appAdmin
 * @param option
 * @param file
 * @returns {Promise<R>}
 */
const exportDBUsers = (appAdmin, option, file) => {
    return new Promise((resolve, reject) => {
        if (appAdmin) {
            const getUsers = appAdmin => {
                appAdmin
                    .firestore()
                    .collection('/users')
                    .get()
                    .then(async listUsersResult => {
                        const users = []
                        for (let user of listUsersResult.docs) {
                            users.push({ uid: user.id, ...user.data() })
                        }

                        const serializedUsers = JSON.stringify(users, null, 2)
                        if (option === EXPORT_OPTION_LIST) {
                            console.log(serializedUsers)
                        }
                        if (option === EXPORT_OPTION_SAVE) {
                            helperFn.writeFile(file, serializedUsers)
                        }

                        resolve(users)
                    })
                    .catch(error => {
                        console.log('ERROR: Error listing users:', error)
                        reject(error)
                    })
            }

            getUsers(appAdmin)
        } else {
            console.log('ERROR: You must pass an App Admin instance!')
        }
    })
}

/**
 * Import users from a list or an external file to the Auth section of Firebase.
 *
 * @param appAdmin
 * @param users
 * @param option
 * @returns {Promise<R>}
 */
const importUsers = (appAdmin, users, option) => {
    return new Promise((resolve, reject) => {
        const importListUsers = usersList => {
            if (appAdmin) {
                appAdmin
                    .auth()
                    .importUsers(usersList)
                    .then(results => {
                        if (results.errors.length > 0) {
                            results.errors.forEach(indexedError => {
                                console.log('ERROR: Error importing user ' + JSON.stringify(indexedError, null, 2))
                            })
                        } else {
                            console.log('Users imported successfully!')
                        }
                        resolve(usersList)
                    })
                    .catch(error => {
                        console.log('ERROR: Error importing users:', error)
                        reject(error)
                    })
            } else {
                console.log('ERROR: You must pass an App Admin instance!')
                reject()
            }
        }

        if (option === IMPORT_OPTION_FILE) {
            helperFn.readFile(users, content => {
                const userList = JSON.parse(content)
                importListUsers(userList)
            })
        } else {
            importListUsers(users)
        }
    })
}

/**
 * Remove users from the Auth section of Firebase using a list of ids.
 * @param appAdmin
 * @param users
 * @returns {Promise<R>}
 */
const removeUsers = (appAdmin, users) => {
    return new Promise((resolve, reject) => {
        appAdmin
            .auth()
            .deleteUsers(users)
            .then(deleteUsersResult => {
                if (deleteUsersResult.successCount > 0) {
                    console.log('Successfully deleted ' + deleteUsersResult.successCount + ' users')
                }
                if (deleteUsersResult.failureCount > 0) {
                    console.log('Failed to delete ' + deleteUsersResult.failureCount + ' users')
                }
                deleteUsersResult.errors.forEach(function (err) {
                    console.log(err.error.toJSON())
                })
                resolve(users)
            })
            .catch(function (error) {
                console.log('Error deleting users:', error)
                reject()
            })
    })
}

/**
 * Check integrity by comparing users that exists in
 * the Firebase Auth section against the Users DB Collection
 * Can export conflicting users to a file or print in the screen.
 *
 * @param appAdmin
 * @param option
 * @param file
 * @param remove
 * @returns {Promise<R>}
 */
const checkUsersIntegrity = (appAdmin, option, file, remove = false) => {
    return new Promise(async (resolve, reject) => {
        if (appAdmin) {
            try {
                const usersAuth = (await exportUsers(appAdmin)).filter(user => user.email != null && user.emailVerified)
                const usersDB = await exportDBUsers(appAdmin)

                const users = []
                for (let user of usersAuth) {
                    if (usersDB.findIndex(item => item.uid === user.uid) === -1) {
                        users.push(user)
                    }
                }

                if (remove) {
                    const userIds = users.map(user => user.uid)
                    await removeUsers(appAdmin, userIds)
                }

                const serializedUsers = JSON.stringify(users, null, 2)

                if (option === EXPORT_OPTION_LIST) {
                    console.log(serializedUsers)
                }
                if (option === EXPORT_OPTION_SAVE) {
                    helperFn.writeFile(file, serializedUsers)
                }
                resolve(users)
            } catch (error) {
                console.log('ERROR: Error checking users:', error)
                reject(error)
            }
        } else {
            console.log('ERROR: You must pass an App Admin instance!')
        }
    })
}

const removeUsersFromBackup = (appAdmin, usersFile) => {
    return new Promise((resolve, reject) => {
        helperFn.readFile(usersFile, content => {
            const userList = JSON.parse(content)
            const userIds = userList.map(user => user.uid)
            removeUsers(appAdmin, userIds)
                .then(users => {
                    resolve(users)
                })
                .catch(error => {
                    reject(error)
                })
        })
    })
}

module.exports = {
    EXPORT_OPTION_LIST,
    EXPORT_OPTION_SAVE,
    IMPORT_OPTION_FILE,
    exportUsers,
    exportDBUsers,
    importUsers,
    removeUsers,
    removeUsersFromBackup,
    checkUsersIntegrity,
}
