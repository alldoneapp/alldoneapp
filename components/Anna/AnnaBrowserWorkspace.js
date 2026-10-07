import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { subscribePageVisible } from '../../utils/appResume'
import { translate } from '../../i18n/TranslationService'

const AnnaBrowserWorkspace = forwardRef(function AnnaBrowserWorkspace(
    { browser, active, onControlChange, onResume, assistantName = translate('Assistant') },
    ref
) {
    const [frame, setFrame] = useState(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [text, setText] = useState('')
    const inFlight = useRef(false)
    const userControl = useRef(false)
    const generation = useRef(0)
    const stopped = useRef(false)
    const callback = useRef(onControlChange)
    callback.current = onControlChange
    const resume = useRef(onResume)
    resume.current = onResume
    const interact = useCallback(
        (action = 'frame', input = {}, { resumeWork = true } = {}) => {
            if (!browser?.runId || inFlight.current) return
            const requestGeneration = generation.current
            setBusy(true)
            const operation = (async () => {
                try {
                    const result = await runHttpsCallableFunction(
                        'annaBrowserWorkspaceSecondGen',
                        { runId: browser.runId, action, input },
                        { timeout: 60000 }
                    )
                    if (generation.current !== requestGeneration) return
                    stopped.current = false
                    setError('')
                    setFrame(previous => ({ ...previous, ...result }))
                    userControl.current = result.control === 'user'
                    callback.current?.(userControl.current)
                    if (action === 'release' && result.resume && resumeWork) resume.current?.(result.resume, 'browser')
                    if (action === 'type') setText('')
                    return result
                } catch (failure) {
                    if (generation.current === requestGeneration) {
                        setError(failure.message || translate('The browser is unavailable.'))
                        stopped.current = true
                        if (
                            failure.details?.reason === 'browser_session_ended' ||
                            failure.code?.endsWith('permission-denied')
                        ) {
                            setFrame(null)
                            userControl.current = false
                            callback.current?.(false)
                        }
                    }
                } finally {
                    if (generation.current === requestGeneration) {
                        inFlight.current = false
                        setBusy(false)
                    }
                }
            })()
            inFlight.current = operation
            return operation
        },
        [browser?.runId]
    )
    useImperativeHandle(
        ref,
        () => ({
            async releaseControl() {
                const currentGeneration = generation.current
                // A frame poll or the last human gesture may still be in flight.
                // Serialize the release so sending a chat cannot silently skip it.
                if (inFlight.current) await inFlight.current
                if (currentGeneration !== generation.current) throw new Error(translate('The browser is unavailable.'))
                if (!userControl.current) return
                const result = await interact('release', {}, { resumeWork: false })
                if (result?.control !== 'assistant') throw new Error(translate('The browser is unavailable.'))
            },
        }),
        [interact]
    )
    useEffect(() => {
        generation.current++
        inFlight.current = false
        stopped.current = false
        setFrame(null)
        setText('')
        setError('')
        setBusy(false)
        userControl.current = false
        callback.current?.(false)
        return () => {
            generation.current++
            inFlight.current = false
        }
    }, [browser?.runId])
    useEffect(() => {
        if (!active || !browser?.runId) return
        const tick = () => {
            if (!document.hidden && !stopped.current) interact()
        }
        tick()
        const timer = setInterval(tick, 5000)
        const stop = subscribePageVisible(tick)
        return () => {
            clearInterval(timer)
            stop()
        }
    }, [active, browser?.runId, interact])
    const human = frame?.control === 'user'
    const canInteract = human && frame?.ready && !busy && !error
    const click = event => {
        if (!canInteract) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        interact('click', {
            x: ((event.clientX - bounds.left) / bounds.width) * (frame.viewport?.width || 1280),
            y: ((event.clientY - bounds.top) / bounds.height) * (frame.viewport?.height || 900),
        })
    }
    if (!browser?.runId)
        return (
            <div className="anna-empty">
                {translate('The browser used by %{assistantName} will appear here when browsing.', { assistantName })}
            </div>
        )
    return (
        <div className="anna-browser-workspace">
            <div className="anna-browser-heading">
                <div>
                    <strong>{frame?.title || browser.title || translate('Browser')}</strong>
                    <div className="anna-muted">{frame?.url || browser.url}</div>
                </div>
                <button
                    disabled={busy || (human && !frame?.ready)}
                    onClick={() => interact(human ? 'release' : 'take')}
                >
                    {translate(human ? 'Let %{assistantName} continue' : 'Take control', { assistantName })}
                </button>
            </div>
            <div className="anna-muted" role="status">
                {translate(
                    human
                        ? frame?.ready
                            ? 'You are in control'
                            : 'Waiting for the current action to finish…'
                        : 'Following %{assistantName}',
                    { assistantName }
                )}
            </div>
            {error && (
                <div className="anna-error" role="alert">
                    {error}
                    <button
                        onClick={() => {
                            stopped.current = false
                            interact()
                        }}
                    >
                        {translate('Retry')}
                    </button>
                </div>
            )}
            <div className="anna-browser-frame">
                {frame?.screenshotDataUrl ? (
                    <img
                        src={frame.screenshotDataUrl}
                        alt={translate('Browser viewport for %{assistantName}', { assistantName })}
                        draggable={false}
                        onClick={click}
                    />
                ) : (
                    !error && <p role="status">{translate('Loading browser…')}</p>
                )}
            </div>
            {human && (
                <div className="anna-browser-controls">
                    <form
                        onSubmit={event => {
                            event.preventDefault()
                            if (canInteract && text) interact('type', { text })
                        }}
                    >
                        <input
                            aria-label={translate('Type into browser')}
                            autoComplete="off"
                            type={frame?.focused?.inputType === 'password' ? 'password' : 'text'}
                            value={text}
                            maxLength={4096}
                            disabled={!canInteract}
                            onChange={event => setText(event.target.value)}
                        />
                        <button type="submit" disabled={!canInteract || !text}>
                            {translate('Type')}
                        </button>
                    </form>
                    <div>
                        {['Tab', 'Enter', 'Backspace', 'Escape'].map(key => (
                            <button key={key} disabled={!canInteract} onClick={() => interact('key', { key })}>
                                {key}
                            </button>
                        ))}
                        <button disabled={!canInteract} onClick={() => interact('scroll', { deltaY: -600 })}>
                            {translate('Scroll up')}
                        </button>
                        <button disabled={!canInteract} onClick={() => interact('scroll', { deltaY: 600 })}>
                            {translate('Scroll down')}
                        </button>
                    </div>
                </div>
            )}
            {frame?.capturedAt && (
                <div className="anna-small">
                    {translate('Last updated')} {new Date(frame.capturedAt).toLocaleTimeString()}
                </div>
            )}
        </div>
    )
})

export default AnnaBrowserWorkspace
