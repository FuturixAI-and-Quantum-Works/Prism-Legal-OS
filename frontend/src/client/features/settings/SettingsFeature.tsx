import ProviderSettings from '../aiSettings/ProviderSettings'

const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", Roboto, sans-serif'

export default function SettingsFeature() {
  return (
    <div
      style={{
        flex: 1,
        fontFamily,
        color: '#454545',
        padding: '32px clamp(18px, 4vw, 48px) 64px',
        maxWidth: 1120,
        margin: '0 auto',
        width: '100%',
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 600, color: '#272727' }}>AI settings</h1>
      <p style={{ color: '#737373', marginTop: 8, marginBottom: 28 }}>
        Manage provider connections, available models, and task preferences.
      </p>
      <ProviderSettings />
    </div>
  )
}
