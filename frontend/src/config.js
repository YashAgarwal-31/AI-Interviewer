// Configuration for API endpoints
const removeTrailingSlash = (url = '') => url.endsWith('/') ? url.slice(0, -1) : url

const aiBackendUrl = removeTrailingSlash(
  import.meta.env.VITE_AI_BACKEND_URL || 'http://localhost:3000'
)

const codeEditorUrl = import.meta.env.VITE_CODE_EDITOR_URL || 'https://ai-code-editor-psi-two.vercel.app/'

const config = Object.freeze({
  AI_BACKEND_URL: aiBackendUrl,
  CODE_EDITOR_URL: codeEditorUrl
})

export default config
