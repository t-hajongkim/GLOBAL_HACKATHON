import { expect, test } from '@playwright/test'

test('Host uploads before opening and Attendee reads the same room material', async ({ page, browser }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '함께할 준비를 해요' })).toBeVisible()
  await page.getByLabel('참여 이름', { exact: true }).fill('자료 Host')
  await page.getByLabel('미팅룸 이름', { exact: true }).fill('에이전트 연결 미팅')
  await page.getByLabel('발표 자료 업로드').setInputFiles({
    name: 'meeting-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Agent input: hello team!'),
  })
  await expect(page.locator('.join-file-list')).toContainText('meeting-notes.txt')
  await page.getByRole('button', { name: 'Host로 방 열기' }).click()
  await expect(page.getByRole('heading', { name: '에이전트 연결 미팅' })).toBeVisible()
  await expect(page.getByTestId('connection-status')).toHaveText('실시간 연결')
  await expect(page.locator('.participant-role-badge')).toHaveText('Host')
  await page.getByRole('button', { name: '자료 1', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('meeting-notes.txt')
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  const attendee = await browser.newPage()
  try {
    await attendee.goto(page.url())
    await expect(attendee.getByRole('radio', { name: /Attendee/ })).toBeChecked()
    await attendee.getByLabel('참여 이름', { exact: true }).fill('팀원')
    await attendee.getByRole('button', { name: 'Attendee로 입장' }).click()
    await expect(attendee.locator('.participant-role-badge')).toHaveText('Attendee')
    await attendee.getByRole('button', { name: '자료 1', exact: true }).click()
    const download = attendee.waitForEvent('download')
    await attendee.getByRole('button', { name: 'meeting-notes.txt 다운로드' }).click()
    expect((await download).suggestedFilename()).toBe('meeting-notes.txt')
    await attendee.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(attendee.getByRole('button', { name: '화면 공유', exact: true })).toHaveCount(0)
  } finally { await attendee.close() }
})

test('Attendee cannot create a missing room; landing fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?room=missing-onboarding-room')
  await page.getByRole('button', { name: 'Attendee로 입장' }).click()
  await expect(page.getByRole('alert')).toContainText('열리지 않았거나 종료된 방')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
