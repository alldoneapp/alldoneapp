// The add-task action is hidden during a voice call. The real provider needs
// the assistant call transport; this harness only needs an idle call.
export const useVoiceCall = () => ({ status: 'idle' })
export function AssistantVoiceCallProvider({ children }) {
    return children
}
export default AssistantVoiceCallProvider
