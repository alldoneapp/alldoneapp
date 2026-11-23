import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import CustomTextInput3 from '../../components/Feeds/CommentsTextInput/CustomTextInput3'
import CustomImageFormat from '../../components/Feeds/CommentsTextInput/autoformat/formats/customImageFormat'
import VideoFormat from '../../components/Feeds/CommentsTextInput/autoformat/formats/videoFormat'
import { TASK_THEME } from '../../components/Feeds/CommentsTextInput/textInputHelper'
import store from './store'

// The REAL media blots (the app registers them globally from EditorToolbar.js), so the embed
// renders exactly the DOM a dropped image gets in production: the inline span with Quill's
// cursor guards around a full-width react-native-web block.
Quill.register(
    {
        'formats/customImageFormat': CustomImageFormat,
        'formats/videoFormat': VideoFormat,
    },
    true
)
Quill.register('modules/autoformat', class extends Quill.import('core/module') {}, true)

// Props as ChatInput passes them (the chat composer of AT-3140).
const App = () => (
    <Provider store={store}>
        <div style={{ width: 560 }}>
            <CustomTextInput3
                projectId="conversation-project"
                styleTheme={TASK_THEME}
                placeholder="Type to add new comment"
                otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                keepBreakLines
                disabledMentions
                hideDictation
                onChangeText={text => {
                    window.__message = text
                }}
                setEditor={editor => {
                    window.__editor = editor
                }}
            />
        </div>
    </Provider>
)
createRoot(document.getElementById('root')).render(<App />)
