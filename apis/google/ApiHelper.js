import store from '../../redux/store'
import Backend from '../../utils/BackendBridge'

export const disableOtherProjects = projectId => {
    const { uid, apisConnected } = store.getState().loggedUser
    let obj = { ...apisConnected }
    delete obj[projectId]
    const promises = []
    Object.keys(obj).forEach(key => {
        promises.push(
            Backend.getDb()
                .doc(`users/${uid}`)
                .set({ apisConnected: { [key]: { calendar: false, gmail: false } } }, { merge: true })
        )
    })
    Promise.all(promises)
}

export const isSomethingConnected = () => {
    const { apisConnected } = store.getState().loggedUser
    let obj = { ...apisConnected }
    return Object.values(obj).some(i => Object.values(i).includes(true))
}
