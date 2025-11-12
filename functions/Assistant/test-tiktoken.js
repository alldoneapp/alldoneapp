// Test script to check tiktoken performance
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

console.log('Starting tiktoken performance test...')

// Test 1: Initialization time
const initStart = Date.now()
const encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
console.log(`Initialization time: ${Date.now() - initStart}ms`)

// Test 2: Encoding time
const testMessage = 'This is a test message to see how long encoding takes.'
const encodeStart = Date.now()
const encoded = encoder.encode(testMessage)
console.log(`Encoding time: ${Date.now() - encodeStart}ms`)
console.log(`Token count: ${encoded.length}`)

// Test 3: Multiple messages
const messages = [
    'Hello, how can I help you today?',
    'I need assistance with my task.',
    "Sure, I'd be happy to help. What specifically do you need?",
    'I want to create a new feature.',
    'Great! Can you provide more details about the feature?',
    'It should allow users to upload images.',
    "Understood. I'll help you implement an image upload feature.",
    'Thank you!',
    "You're welcome!",
]

const multiStart = Date.now()
let totalTokens = 0
for (const msg of messages) {
    const tokens = encoder.encode(msg)
    totalTokens += tokens.length
}
console.log(`Encoding 9 messages: ${Date.now() - multiStart}ms`)
console.log(`Total tokens: ${totalTokens}`)

// Test 4: Check if cl100k_base.json is large
console.log(`cl100k_base.bpe_ranks size: ${Object.keys(cl100k_base.bpe_ranks).length} entries`)

encoder.free()
console.log('Test complete.')
