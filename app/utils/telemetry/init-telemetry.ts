import config from '../../config'
// import telemetry from './custom-telemetry'
export function initTelemetry() {
  const telemetryConfig = config.telemetry
  if (!telemetryConfig?.enabled || !telemetryConfig.endpoint) return

  try {
    void import('./micro-sentry-telemetry').then(({ default: telemetry }) => {
      telemetry.init(telemetryConfig)
      if (typeof window === 'undefined') return

      const w = window as Window & { __ntwTelemetryHandlersInstalled?: boolean }
      if (w.__ntwTelemetryHandlersInstalled) return

      window.addEventListener('error', (event) => {
        try {
          telemetry.captureError(
            (event as ErrorEvent).error ?? (event as ErrorEvent).message,
            { source: 'window.error' },
          )
        } catch {}
      })
      window.addEventListener('unhandledrejection', (event) => {
        try {
          telemetry.captureError((event as PromiseRejectionEvent).reason, {
            source: 'window.unhandledrejection',
          })
        } catch {}
      })
      w.__ntwTelemetryHandlersInstalled = true
    })
  } catch {}
}
