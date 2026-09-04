import React from 'react'
import ReactDOM from 'react-dom/client'
import Prototype from './App'
import { initStore } from './app/store'
import { setupNative } from './app/native'
import { initTheme } from './app/theme'
import { notifyWebReady } from './app/widgets'
import './index.css'

const params = new URLSearchParams(window.location.search)
const proto = params.has('proto')
const onboardStep = params.get('onboardStep')

async function boot() {
  initTheme()
  await setupNative()
  await initStore()
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  if (onboardStep != null) {
    if (params.has('still')) {
      const s = document.createElement('style')
      s.textContent = '*{animation:none!important;transition:none!important}'
      document.head.appendChild(s)
    }
    const { default: Onboarding } = await import('./app/Onboarding')
    root.render(<Onboarding initialStep={Number(onboardStep)} onDone={() => {}} />)
    return
  }
  const { default: RealApp } = await import('./app/RealApp')
  root.render(<React.StrictMode>{proto ? <Prototype /> : <RealApp />}</React.StrictMode>)
  requestAnimationFrame(() => requestAnimationFrame(notifyWebReady))
}

void boot()
