import { expect, test, type Page } from '@playwright/test'

interface CaptureHarness {
  requests: (DisplayMediaStreamOptions | undefined)[]
  streams: MediaStream[]
  mode: 'allow' | 'deny' | 'defer' | 'monitor'
  completeSelection?: () => void
}

declare global {
  interface Window { captureHarness: CaptureHarness }
}

async function installCapture(page: Page) {
  await page.addInitScript(() => {
    window.captureHarness = { requests: [], streams: [], mode: 'allow' }
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async (options?: DisplayMediaStreamOptions) => {
        const harness = window.captureHarness
        harness.requests.push(options)
        if (harness.mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError')
        if (harness.mode === 'defer') await new Promise<void>((resolve) => { harness.completeSelection = resolve })
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Missing canvas context')
        let frame = 0
        const draw = () => {
          context.fillStyle = frame % 2 ? '#56518c' : '#4e548f'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = '#ffffff'
          context.font = '32px sans-serif'
          context.fillText('TEAMS TEST SOURCE', 35, 150)
          context.fillText(`LIVE FRAME ${frame++}`, 35, 210)
        }
        draw()
        const stream = canvas.captureStream(20)
        const track = stream.getVideoTracks()[0]
        const timer = window.setInterval(() => {
          if (track.readyState === 'ended') { window.clearInterval(timer); return }
          draw()
        }, 50)
        const settings = track.getSettings.bind(track)
        track.getSettings = () => ({ ...settings(), displaySurface: harness.mode === 'monitor' ? 'monitor' : 'window' })
        harness.streams.push(stream)
        return stream
      },
    })
  })
}

async function openTeams(page: Page) {
  await page.getByRole('button', { name: 'Teams 창 공유', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Teams 발표를 극장으로' })).toBeVisible()
}

async function confirmTeams(page: Page) {
  await openTeams(page)
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await expect(page.getByTestId('teams-preview')).toBeVisible()
  await page.getByRole('button', { name: '이 화면을 극장에 공유' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function expectLiveFrames(page: Page) {
  const video = page.getByTestId('shared-video')
  await expect(video).toBeVisible()
  const play = page.getByRole('button', { name: '클릭해서 발표 화면 재생' })
  if (await play.isVisible()) await play.click()
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  const frames = await video.evaluate((element) =>
    (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(frames + 2)
}

test('Teams preview stays private, then streams changing video to viewers and late arrivals without audio', async ({ page, browser }, testInfo) => {
  test.setTimeout(75_000)
  await installCapture(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Host로 방 열기' }).click()
  await expect(page.getByTestId('connection-status')).toHaveText('실시간 연결')
  const guest = await browser.newPage()
  const late = await browser.newPage()
  try {
    await guest.goto(page.url())
    await guest.getByRole('button', { name: 'Attendee로 입장' }).click()
    await expect(guest.getByTestId('connection-status')).toHaveText('실시간 연결')
    await expect(guest.getByRole('button', { name: 'Teams 창 공유', exact: true })).toHaveCount(0)
    await openTeams(page)
    await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
    await expect(page.getByTestId('teams-preview')).toBeVisible()
    await expect(guest.getByTestId('presentation-slide')).toBeVisible()
    await expect(guest.getByTestId('shared-video')).toHaveCount(0)
    expect(await page.evaluate(() => window.captureHarness.requests[0]?.audio)).toBe(false)
    expect(await page.evaluate(() => window.captureHarness.requests[0]?.video)).toMatchObject({ displaySurface: 'window' })
    await page.screenshot({ path: testInfo.outputPath('teams-preview.png') })
    await page.getByRole('button', { name: '이 화면을 극장에 공유' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectLiveFrames(guest)
    await expect(guest.getByTestId('presentation-source')).toHaveText('Teams 창 스트리밍 중')
    await expect(guest.getByRole('button', { name: '발표 소리 켜기' })).toHaveCount(0)
    expect(await guest.getByTestId('shared-video').evaluate((element) =>
      ((element as HTMLVideoElement).srcObject as MediaStream).getAudioTracks().length)).toBe(0)
    await late.goto(page.url())
    await late.getByRole('button', { name: 'Attendee로 입장' }).click()
    await expectLiveFrames(late)
    await page.getByRole('button', { name: '공유 중지', exact: true }).click()
    await expect(guest.getByTestId('presentation-slide')).toBeVisible()
    await expect(late.getByTestId('presentation-slide')).toBeVisible()
    expect(await page.evaluate(() => window.captureHarness.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
    await confirmTeams(page)
    await expectLiveFrames(guest)
    await page.evaluate(() => {
      const track = window.captureHarness.streams.at(-1)?.getVideoTracks()[0]
      track?.stop()
      track?.dispatchEvent(new Event('ended'))
    })
    await expect(guest.getByTestId('presentation-slide')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Teams 창 공유', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await guest.close()
    await late.close()
  }
})

test('Teams cancellation releases preview tracks and a picker returning after close cannot publish', async ({ page }) => {
  await installCapture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Host로 방 열기' }).click()
  await expect(page.getByTestId('connection-status')).toHaveText('실시간 연결')
  await openTeams(page)
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await expect(page.getByTestId('teams-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => window.captureHarness.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
  await expect(page.getByTestId('presentation-source')).toHaveText('샘플 발표 자료')
  await page.evaluate(() => { window.captureHarness.mode = 'defer' })
  await openTeams(page)
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.evaluate(() => { window.captureHarness.completeSelection?.() })
  await expect.poll(() => page.evaluate(() => window.captureHarness.streams.length)).toBe(2)
  await expect.poll(() => page.evaluate(() => window.captureHarness.streams[1].getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
  await expect(page.getByTestId('presentation-source')).toHaveText('샘플 발표 자료')
})

test('Teams capture denial, full-screen selection and unavailable capture show explicit errors', async ({ page }, testInfo) => {
  await installCapture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Host로 방 열기' }).click()
  await expect(page.getByTestId('connection-status')).toHaveText('실시간 연결')
  await page.evaluate(() => { window.captureHarness.mode = 'deny' })
  await openTeams(page)
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('공유 권한')
  await expect(page.getByTestId('teams-preview')).toHaveCount(0)
  await page.evaluate(() => { window.captureHarness.mode = 'monitor' })
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('전체 화면 대신')
  expect(await page.evaluate(() => window.captureHarness.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
  await page.evaluate(() => { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }) })
  await page.getByRole('button', { name: 'Teams 창 선택', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('HTTPS 또는 localhost')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const dialog = page.getByRole('dialog')
  const rect = await dialog.boundingBox()
  expect(rect?.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('teams-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('presentation-source')).toHaveText('샘플 발표 자료')
})
