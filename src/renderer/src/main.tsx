import { createRoot } from 'react-dom/client'
import '@ui/index'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
