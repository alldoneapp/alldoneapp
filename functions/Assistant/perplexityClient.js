class PerplexityClient {
    constructor(apiKey, model) {
        if (!apiKey) throw new Error('API key is required')
        if (!model) throw new Error('Model name is required')

        this.apiKey = apiKey
        this.model = model
        this.baseUrl = 'https://api.perplexity.ai/chat/completions'
        this.citations = []
    }

    async *stream(messages) {
        if (!Array.isArray(messages)) {
            throw new Error('Messages must be an array')
        }

        console.log('Starting stream with messages:', {
            messageCount: messages.length,
            roles: messages.map(m => m[0]),
        })

        // Immediately yield a loading message...
        yield {
            content: 'Doing Deep Research...',
            type: 'AIMessageChunk',
            isLoading: true,
        }

        const formattedMessages = messages.map(([role, content]) => ({
            role: role === 'system' ? 'system' : role === 'assistant' ? 'assistant' : 'user',
            content: content,
        }))

        console.log('Sending request to Perplexity API with:', {
            model: this.model,
            messageCount: formattedMessages.length,
        })

        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: formattedMessages,
                stream: true,
                temperature: 0.2,
                top_p: 0.9,
            }),
        })

        if (!response.ok) {
            console.error('Perplexity API error:', {
                status: response.status,
                statusText: response.statusText,
            })
            throw new Error(`Perplexity API error: ${response.statusText}`)
        }

        console.log('Got successful response from Perplexity API')

        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let answerContent = ''
        let inThinkingMode = false
        let chunkCount = 0

        // Helper function to ensure URLs have proper spacing
        const ensureUrlSpacing = (text, url) => {
            if (!url || !text) return text
            const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const urlRegex = new RegExp(escapedUrl, 'g')

            return text.replace(urlRegex, (match, offset) => {
                const hasSpaceBefore =
                    offset > 0 && (text[offset - 1] === ' ' || text[offset - 1] === '\n' || text[offset - 1] === '\t')
                const hasSpaceAfter =
                    offset + match.length < text.length &&
                    (text[offset + match.length] === ' ' ||
                        text[offset + match.length] === '\n' ||
                        text[offset + match.length] === '\t' ||
                        text[offset + match.length] === '.')

                return `${hasSpaceBefore ? '' : ' '}${match}${hasSpaceAfter ? '' : ' '}`
            })
        }

        // Process content and handle thinking mode
        const processContent = text => {
            if (text.includes('<think>')) {
                inThinkingMode = true
                const thinkTagIndex = text.indexOf('<think>')
                if (thinkTagIndex > 0) {
                    answerContent += text.substring(0, thinkTagIndex)
                    text = text.substring(thinkTagIndex)
                }
                return { text, inThinkingMode: true, clearThinking: false }
            }

            if (text.includes('</think>')) {
                inThinkingMode = false
                const endThinkTagIndex = text.indexOf('</think>') + '</think>'.length
                if (endThinkTagIndex < text.length) {
                    answerContent += text.substring(endThinkTagIndex)
                }
                return {
                    text,
                    clearThinking: true,
                    replacementContent: answerContent,
                }
            }

            if (!inThinkingMode) {
                answerContent += text
            }

            // Handle citation references
            let processedText = text
            for (let i = 0; this.citations && i < this.citations.length; i++) {
                const marker = `[${i + 1}]`
                const url = this.citations[i]
                processedText = processedText.replace(new RegExp('\\' + marker, 'g'), url)
                processedText = ensureUrlSpacing(processedText, url)
            }

            return { text: processedText, inThinkingMode, clearThinking: false }
        }

        try {
            while (true) {
                const { done, value } = await reader.read()

                if (done) {
                    console.log('Stream completed:', {
                        totalChunks: chunkCount,
                        finalAnswerLength: answerContent.length,
                    })
                    break
                }

                chunkCount++
                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop()

                for (const line of lines) {
                    if (line.trim() === '') continue
                    if (!line.startsWith('data: ')) continue

                    const data = line.slice(6)
                    if (data === '[DONE]') {
                        console.log('Received [DONE] signal')
                        continue
                    }

                    try {
                        const parsed = JSON.parse(data)
                        console.log(`Processing chunk #${chunkCount}:`, {
                            hasContent: !!parsed.content,
                            contentLength: parsed.content?.length,
                            type: parsed.type,
                        })

                        if (parsed.citations) {
                            this.citations = parsed.citations
                        }
                        if (parsed.choices?.[0]?.delta?.content) {
                            const rawContent = parsed.choices[0].delta.content
                            const processed = processContent(rawContent)

                            if (processed.clearThinking) {
                                yield {
                                    content: '',
                                    type: 'AIMessageChunk',
                                    clearThinkingMode: true,
                                    replacementContent: processed.replacementContent,
                                }
                                continue
                            }

                            yield {
                                content: processed.text,
                                type: 'AIMessageChunk',
                                isThinking: processed.inThinkingMode,
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing chunk:', {
                            error: e.message,
                            data,
                        })
                    }
                }
            }
        } catch (e) {
            console.error('Error reading stream:', e)
            throw e
        }
    }
}

module.exports = { PerplexityClient }
