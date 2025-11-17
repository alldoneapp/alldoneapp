'use strict'

const { getEnvFunctions } = require('../envFunctionsHelper')

/**
 * Get a random GIF from Giphy based on a search tag
 * @param {Object} data - Function parameters
 * @param {string} data.tag - Search tag for the GIF
 * @param {string} data.rating - Content rating (g, pg, pg-13, r). Default: 'g'
 * @returns {Promise<Object>} GIF data
 */
const giphyRandomGif = async data => {
    const { GIPHY_API_KEY } = getEnvFunctions()

    if (!GIPHY_API_KEY) {
        throw new Error('GIPHY_API_KEY is not configured')
    }

    const { tag, rating = 'g' } = data

    if (!tag) {
        throw new Error('Tag is required')
    }

    try {
        console.log('Fetching random GIF from Giphy:', { tag, rating })

        const url = `https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=${encodeURIComponent(
            tag
        )}&rating=${rating}`

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('Giphy API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                tag,
            })
            throw new Error(`Giphy API error: ${response.status} - ${errorText}`)
        }

        const result = await response.json()

        if (!result.data || !result.data.images) {
            console.warn('No GIF found for tag:', tag)
            return {
                success: false,
                error: 'No GIF found',
            }
        }

        console.log('Successfully fetched GIF from Giphy:', {
            tag,
            id: result.data.id,
        })

        return {
            success: true,
            gif: {
                id: result.data.id,
                url: result.data.url,
                images: {
                    original: result.data.images.original,
                    downsized: result.data.images.downsized,
                    downsizedMedium: result.data.images.downsized_medium,
                    fixedHeight: result.data.images.fixed_height,
                    fixedWidth: result.data.images.fixed_width,
                },
                title: result.data.title,
            },
        }
    } catch (error) {
        console.error('Failed to fetch GIF from Giphy:', {
            error: error.message,
            stack: error.stack,
            tag,
        })
        throw error
    }
}

module.exports = { giphyRandomGif }
