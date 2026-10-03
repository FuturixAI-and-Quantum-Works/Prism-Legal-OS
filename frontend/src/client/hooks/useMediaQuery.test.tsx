import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useResponsive } from './useMediaQuery'

function stubViewport(initialWidth: number) {
  let width = initialWidth
  const listeners = new Set<() => void>()
  const matches = (query: string) => {
    const min = /min-width: (\d+)px/.exec(query)
    const max = /max-width: (\d+)px/.exec(query)
    return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return matches(query)
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })),
  )
  return {
    resize(next: number) {
      width = next
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

describe('useResponsive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports mobile on the first render', () => {
    stubViewport(400)
    const renders: Array<ReturnType<typeof useResponsive>> = []
    renderHook(() => {
      const value = useResponsive()
      renders.push(value)
      return value
    })
    expect(renders[0]).toEqual({ isMobile: true, isTablet: false, isDesktop: false })
  })

  it('reports desktop on the first render', () => {
    stubViewport(1400)
    const { result } = renderHook(() => useResponsive())
    expect(result.current).toEqual({ isMobile: false, isTablet: false, isDesktop: true })
  })

  it('updates on viewport change without re-subscribing', () => {
    const viewport = stubViewport(1400)
    const { result } = renderHook(() => useResponsive())
    const subscribed = viewport.listenerCount()
    act(() => viewport.resize(400))
    expect(result.current).toEqual({ isMobile: true, isTablet: false, isDesktop: false })
    expect(viewport.listenerCount()).toBe(subscribed)
  })
})
