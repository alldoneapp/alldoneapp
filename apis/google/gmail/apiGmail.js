import { client_id } from '../apisConfig'
import scriptLoader from '../../scriptLoader'
import ProfileInit from '../profileInit'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

const config = {
    client_id,
    scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels',
}

class ApiGmail {
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
        if (ProfileInit.checkAccessGranted()) {
            callback()
        } else {
            this.tokenClient.callback = callback
            this.tokenClient.requestAccessToken({ prompt: 'consent' })
        }
    }

    checkAccessGranted() {
        return ProfileInit.checkAccessGranted()
    }

    async listGmail() {
        await this.ensureInitialized()
        if (window.gapi) {
            try {
                const res = await window.gapi.client.gmail.users.labels.get({
                    userId: 'me',
                    id: 'INBOX',
                })
                return res.result
            } catch (e) {
                console.error('[Gmail API] Error fetching Gmail labels:', e)
            }
        } else {
            console.error('[Gmail API] GAPI not loaded')
        }
    }
}

let apiGmail
try {
    apiGmail = new ApiGmail(config)
} catch (e) {
    console.error('[Gmail API] Error initializing:', e)
}
export default apiGmail
