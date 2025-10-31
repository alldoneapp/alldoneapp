/**
 * Funny loading messages for app initialization
 * Each time the app loads, a random message is selected
 */

const FUNNY_MESSAGES = [
    'Teaching hamsters to run the server...',
    'Asking the cloud for permission...',
    'Convincing electrons to flow properly...',
    'Brewing fresh packets of data...',
    'Untangling the internet tubes...',
    'Summoning the data spirits...',
    'Warming up the flux capacitor...',
    'Feeding the server hamsters...',
    'Downloading more RAM...',
    'Reticulating splines...',
    'Generating witty loading message...',
    'Reversing the polarity...',
    'Spinning up the quantum processors...',
    'Consulting the magic 8-ball...',
    'Bribing the firewall...',
    'Waking up the database...',
    'Herding digital cats...',
    'Aligning the chakras of your tasks...',
    'Negotiating with the backend...',
    'Charging the productivity crystals...',
    'Polishing the pixels...',
    'Calibrating the confusion matrix...',
    'Training AI to make coffee...',
    'Calculating the meaning of life...',
    'Organizing your digital sock drawer...',
    'Convincing servers to cooperate...',
    'Performing quantum task alignment...',
    'Recruiting more bits and bytes...',
    'Teaching robots to procrastinate...',
    'Optimizing the chaos algorithm...',
    'Debugging the space-time continuum...',
    'Inflating the database balloons...',
    'Tuning the productivity harmonica...',
    'Synchronizing the unsynchronizable...',
    'Uploading good vibes...',
    'Defragmenting your motivation...',
    'Compiling your to-do list dreams...',
    'Encrypting the secret sauce...',
    'Massaging the server clusters...',
    'Painting the bits green...',
    'Counting backwards from infinity...',
    'Sorting tasks by how much they sparkle...',
    'Consulting the productivity oracle...',
    'Folding the task dimensions...',
    'Loading the loading screen...',
    'Activating the procrastination shield...',
    'Initializing the initialize sequence...',
    'Gathering scattered thoughts...',
    'Wrangling wild pointers...',
    'Sharpening the digital pencils...',
    'Caffeinating the CPU...',
    'Teaching the algorithm to dance...',
    'Locating missing semicolons...',
    'Convincing cache to cooperate...',
    'Dusting off the server racks...',
    'Encouraging lazy loading to wake up...',
    'Performing digital yoga stretches...',
    'Negotiating with the network...',
    'Applying task management feng shui...',
    'Brewing a fresh batch of code...',
    'Tickling the database...',
    'Asking nicely for data...',
    'Summoning productivity demons...',
    'Adjusting the reality parameters...',
    'Convincing time to slow down...',
    'Preparing motivational speeches for tasks...',
    'Translating binary to morse code...',
    'Sweeping digital dust bunnies...',
    'Calibrating the awesome meter...',
    'Turning it off and on again...',
]

/**
 * Gets a random funny loading message
 * Uses a deterministic approach based on session to avoid too much repetition
 */
let lastMessageIndex = -1

export const getRandomLoadingMessage = () => {
    // Get random index, avoiding the last one if possible
    let randomIndex
    do {
        randomIndex = Math.floor(Math.random() * FUNNY_MESSAGES.length)
    } while (randomIndex === lastMessageIndex && FUNNY_MESSAGES.length > 1)

    lastMessageIndex = randomIndex
    return FUNNY_MESSAGES[randomIndex]
}

/**
 * Gets a funny message for the initial connection screen
 */
export const getConnectingMessage = () => {
    return getRandomLoadingMessage()
}

/**
 * Gets a funny message for progressive loading steps
 */
export const getProgressLoadingMessage = () => {
    return getRandomLoadingMessage()
}

export default {
    getRandomLoadingMessage,
    getConnectingMessage,
    getProgressLoadingMessage,
}
