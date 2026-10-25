import { client_id } from '../apisConfig'
import scriptLoader from '../../scriptLoader'
import ProfileInit from '../profileInit'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

const config = {
    client_id,
    scope: 'https://www.googleapis.com/auth/drive.file',
}

class ApiDrive {
    tokenClient = null

    constructor(config) {
        this.config = config
        this.initializationPromise = null
    }

    async handleClientLoad() {
        await Promise.all([ProfileInit.ensureInitialized(), scriptLoader.loadScript(scriptSrcGoogle)])
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: this.config.client_id,
            scope: this.config.scope,
        })
    }

    ensureInitialized() {
        if (!this.initializationPromise) {
            this.initializationPromise = this.handleClientLoad().catch(error => {
                this.initializationPromise = null
                throw error
            })
        }
        return this.initializationPromise
    }

    async requestConsent(callback) {
        await this.ensureInitialized()
        //if (ProfileInit.checkAccessGranted()) {
        //    callback()
        // } else {
        this.tokenClient.callback = callback
        this.tokenClient.requestAccessToken({ prompt: 'consent' })
        // }
    }

    checkAccessGranted() {
        return ProfileInit.checkAccessGranted()
    }
}

let apiDrive
try {
    apiDrive = new ApiDrive(config)
} catch (e) {
    console.log(e)
}
export default apiDrive
