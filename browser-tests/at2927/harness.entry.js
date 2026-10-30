import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import AnnaMessageAuthor from '../../components/Anna/AnnaMessageAuthor'
import '../../components/Anna/anna.css'
import { colors } from '../../components/styles/global'
import font from '../../assets/fonts/Roboto-Regular.ttf'
import medium from '../../assets/fonts/Roboto-Medium.ttf'
import icons from '../../assets/fonts/alldone.ttf'

const style = document.createElement('style')
style.textContent = `@font-face{font-family:Roboto-Regular;src:url('${font}')} @font-face{font-family:Roboto-Medium;src:url('${medium}')} @font-face{font-family:alldone;src:url('${icons}')} html,body,#root{margin:0;height:100%;font-family:Roboto-Regular,Arial} .anna-shell{position:static!important;height:100dvh!important} .anna-conversation{width:var(--chat-width);height:100%;display:flex;flex-direction:column;border-right:6px solid ${colors.Primary200}}`
document.head.append(style)

const created = new Date(2026, 9, 30, 15, 50).getTime()
const messages = [
    {
        id: 'queued',
        own: true,
        message: {
            created,
            creatorId: 'me',
            submission: { status: 'queued', key: 'q' },
        },
        text: 'Neuer Task: Den Rand auf der rechten Seite im assistant mode von alldone nur dann blau machen, wenn wirklich ein Tool call passiert',
    },
    {
        id: 'sending',
        own: true,
        message: { created, creatorId: 'me', submission: { status: 'sending', key: 's' } },
        text: 'Und noch eine kurze Nachricht',
    },
    {
        id: 'answer',
        own: false,
        message: { created, creatorId: 'anna' },
        creator: { isAssistant: true, displayName: 'Anna Alldone mit einem sehr langen Namen zum Testen' },
        text: 'Klar, ich kümmere mich darum.',
    },
]

function App() {
    return (
        <main
            className="anna-shell"
            style={{
                height: '100%',
                '--anna-ink': colors.Text01,
                '--anna-muted': colors.Text02,
                '--anna-accent': colors.Primary200,
                '--anna-neutral': colors.Grey200,
                '--anna-border': '#e4e9ee',
            }}
        >
            <section className="anna-conversation">
                <div className="anna-messages">
                    <div className="anna-message-timeline">
                        {messages.map(({ id, own, message, creator, text }) => (
                            <article
                                key={id}
                                data-id={id}
                                className={`anna-message ${own ? 'anna-message-user' : ''}${
                                    message.submission?.status === 'queued' ? ' anna-message-queued' : ''
                                }`}
                            >
                                <AnnaMessageAuthor
                                    message={message}
                                    creator={creator}
                                    own={own}
                                    onSendNow={() => (window.sentNow = true)}
                                    onRemove={() => {}}
                                />
                                <div className="anna-message-text">{text}</div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
        </main>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider store={createStore(() => ({ dateFormat: 'DD.MM.YYYY' }))}>
        <App />
    </Provider>
)
window.harnessReady = true
