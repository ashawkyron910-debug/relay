/// <reference types="vite/client" />

interface RelayDesktopInfo {
  platform: string
}

interface Window {
  relayDesktop?: RelayDesktopInfo
}
