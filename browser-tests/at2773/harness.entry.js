import React, { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaChatScroll from '../../components/Anna/useAnnaChatScroll'
import AnnaMessageBody from '../../components/Anna/AnnaMessageBody'
import '../../components/Anna/anna.css'
import { colors } from '../../components/styles/global'
import font from '../../assets/fonts/Roboto-Regular.ttf'

const style = document.createElement('style')
style.textContent = `@font-face{font-family:Roboto-Regular;src:url('${font}')} html,body,#root{margin:0;height:100%;font-family:Roboto-Regular,Arial}.anna-shell{position:static!important;height:100dvh!important}.anna-conversation{max-width:760px;width:100%;margin:auto;height:100%;display:flex;flex-direction:column}.anna-messages{scrollbar-gutter:stable}.anna-composer{flex:none;padding:12px 20px}.anna-composer-field{min-height:60px}`
document.head.append(style)
const initial =
    '# A calmer day\n\nHere is a **clear plan** for the week.\n\n- Review your priorities\n- Keep time for family\n\n'
function App() {
    const scroll = useRef(null),
        content = useRef(null)
    const motion = useAnnaChatScroll(scroll, content, true)
    const [text, setText] = useState(initial)
    const [running, setRunning] = useState(true)
    const [extra, setExtra] = useState(false)
    useLayoutEffect(() => {
        window.motionHarness = {
            append: value => setText(text => text + value),
            replace: setText,
            finish: () => setRunning(false),
            resize: () => setExtra(value => !value),
            latest: motion.latest,
            source: () => text,
        }
        motion.update()
    }, [text, running, motion.update, motion.latest])
    return (
        <main
            className="anna-shell"
            style={{
                '--anna-ink': colors.Text01,
                '--anna-muted': colors.Text02,
                '--anna-placeholder': colors.Text03,
                '--anna-accent': colors.Primary200,
                '--anna-neutral': colors.Grey200,
                '--anna-tint': colors.UtilityBlue100,
                '--anna-border': colors.Grey300,
                '--anna-focus': colors.UtilityBlue150,
                '--anna-surface': colors.Grey100,
            }}
        >
            <div className="anna-conversation">
                <div
                    className="anna-messages"
                    role="log"
                    tabIndex={0}
                    ref={scroll}
                    onScroll={motion.onScroll}
                    onWheel={motion.onWheel}
                    onTouchStart={motion.onTouchStart}
                    onTouchMove={motion.onTouchMove}
                    onKeyDown={motion.onKeyDown}
                >
                    <div className="anna-message-timeline" ref={content}>
                        {Array.from({ length: 8 }, (_, i) => (
                            <article className="anna-message anna-message-user" key={i}>
                                <div className="anna-message-author">Karsten</div>Help me plan a focused week with time
                                for the team and family.
                            </article>
                        ))}
                        <article className="anna-message" data-answer>
                            <div className="anna-message-author">Anna</div>
                            <AnnaMessageBody
                                commentText={text}
                                creatorData={{ isAssistant: true }}
                                assistantRun={{ kind: 'chat', status: running ? 'running' : 'completed' }}
                                reducedMotion={motion.reducedMotion}
                                containerStyle={{ margin: 0, padding: 0 }}
                            />
                        </article>
                    </div>
                </div>
                <div className="anna-composer">
                    <div
                        className="anna-composer-field"
                        style={{ height: extra ? 170 : 60 }}
                        contentEditable
                        suppressContentEditableWarning
                        aria-label="Draft"
                    >
                        Keep this draft
                    </div>
                    <button className="anna-text-button" onClick={motion.latest}>
                        Latest messages ↓
                    </button>
                </div>
            </div>
        </main>
    )
}
createRoot(document.getElementById('root')).render(<App />)
