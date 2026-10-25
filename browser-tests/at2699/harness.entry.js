import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import CustomTextInput3 from '../../components/Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../../components/Feeds/CommentsTextInput/textInputHelper'
import store from './store'

// Keep Quill's actual insertion and selection behaviour; visual embeds can be lightweight
// in this offline fixture. Production embed metadata is covered by attachmentEditorId.test.js.
const Embed = Quill.import('blots/embed')
for (const name of ['attachment', 'customImageFormat', 'videoFormat']) {
    class FixtureEmbed extends Embed {
        static create(value) {
            const node = super.create()
            node.dataset.value = JSON.stringify(value)
            node.textContent = value.text
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
Quill.register('modules/autoformat', class extends Quill.import('core/module') {}, true)

const App = () => (
    <Provider store={store}>
        <CustomTextInput3
            projectId="conversation-project"
            styleTheme={TASK_THEME}
            placeholder="Start a new chat"
            containerStyle={{ borderWidth: 1, borderColor: '#cdd5db', borderRadius: 8, padding: 3 }}
            fixedHeight={88}
            disabledMentions
            otherFormats={['attachment', 'customImageFormat', 'videoFormat']}
            alwaysShowDictation
            showAttachmentButton={!window.location.search.includes('ordinary')}
            disabledEdition={window.location.search.includes('readonly')}
            hideDictation={window.location.search.includes('no-mic')}
            onChangeText={text => {
                window.__message = text
            }}
            setEditor={editor => {
                window.__editor = editor
            }}
        />
    </Provider>
)
createRoot(document.getElementById('root')).render(<App />)
