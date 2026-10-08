import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import AnnaChatComposer from '../../components/Anna/AnnaChatComposer'
import Autoformat from '../../components/Feeds/CommentsTextInput/autoformat/modules/autoformat'
import '../../components/Anna/anna.css'
import store from '../at2699/store'
import { colors } from '../../components/styles/global'

// The right-hand app has its own published viewport. The real mention portal
// must stay in the assistant conversation even while that viewport is active.
window.__alldoneWorkspaceViewport = {
    active: true,
    top: 0,
    left: 600,
    right: 1280,
    bottom: 720,
    width: 680,
    height: 720,
}

const Embed = Quill.import('blots/embed')
for (const name of ['url', 'mention']) {
    class FixtureEmbed extends Embed {
        static create(value) {
            const node = super.create()
            node.dataset.value = JSON.stringify(value)
            node.textContent = value.text || value.url
            return node
        }
        static value(node) {
            return JSON.parse(node.dataset.value)
        }
    }
    FixtureEmbed.blotName = name
    FixtureEmbed.tagName = 'span'
    FixtureEmbed.className = `fixture-${name}`
    Quill.register(FixtureEmbed, true)
}
Quill.register('modules/autoformat', Autoformat, true)

function App() {
    const composer = useRef(null)
    const [draft, setDraft] = useState('')
    const [disabled, setDisabled] = useState(false)
    window.__composer = composer
    window.__disable = setDisabled
    window.__draft = draft
    window.__sent ||= []
    const send = () => {
        if (!window.__draft.trim()) return
        window.__sent.push(window.__draft.trim())
        setDraft('')
        composer.current.clear()
        composer.current.focus()
    }
    return (
        <Provider store={store}>
            <div
                className="anna-shell anna-conversation"
                style={{
                    width: '100%',
                    height: '100vh',
                    '--anna-ink': colors.Text01,
                    '--anna-placeholder': colors.Text03,
                    '--anna-accent': colors.Primary200,
                    '--anna-border': colors.Grey300,
                    '--anna-focus': colors.UtilityBlue150,
                    '--anna-surface': colors.Grey100,
                }}
            >
                <div style={{ flex: 1 }} />
                <form
                    className="anna-composer"
                    onSubmit={event => {
                        event.preventDefault()
                        send()
                    }}
                >
                    <div className="anna-composer-field">
                        <AnnaChatComposer
                            ref={composer}
                            projectId="conversation-project"
                            placeholder="Talk or type to Anna…"
                            label="Message Anna"
                            disabled={disabled}
                            onChangeText={setDraft}
                            onSubmit={send}
                        />
                        <button type="button" onClick={() => composer.current.insertDictation('Dictated text', true)}>
                            Dictate
                        </button>
                        <button type="submit" className="anna-send" aria-label="Send message">
                            ↑
                        </button>
                    </div>
                </form>
            </div>
        </Provider>
    )
}
createRoot(document.getElementById('root')).render(<App />)
