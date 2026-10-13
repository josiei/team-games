import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_ROOM_CONFIG } from '../packages/server/src/rooms/store'

// Phase lengths come from the server's own config, so a timing change cannot
// silently break this test. SLACK covers network, render and the phase hand-off.
const VOTE_PHASES = ['vote-scariest', 'vote-funniest', 'vote-craft', 'vote-cursed'] as const
const AWARD_HEADINGS = [/scariest/i, /funniest/i, /craftsmanship/i, /cursed/i]
const SLACK_MS = 10_000
const phaseMs = (phase: string) => DEFAULT_ROOM_CONFIG.phaseMs[phase]!
const ROUND_TIMEOUT_MS =
  VOTE_PHASES.reduce((sum, p) => sum + phaseMs(p) + SLACK_MS, 0) + 3 * SLACK_MS

// Distinctive names so a leak cannot be confused with ordinary page text.
const HOST_NAME = 'Zephyrine'
const GUEST_NAME = 'Quillon'

/** Everything a player could perceive or a screen reader could announce. */
async function visibleSurface(page: Page): Promise<string> {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label],[title],[alt]')]
      .map(el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt')].join(' '))
    return `${document.body.innerText}\n${document.body.textContent}\n${labels.join('\n')}`
  })
}

async function expectNoCarverNames(page: Page) {
  const surface = await visibleSurface(page)
  expect(surface).not.toContain(HOST_NAME)
  expect(surface).not.toContain(GUEST_NAME)
}

/** Hash of the canvas pixels, to prove the 2D context really rasterized something. */
const canvasPixels = (canvas: Locator) =>
  canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const data = ctx.getImageData(0, 0, el.width, el.height).data
    let hash = 2166136261
    for (let i = 0; i < data.length; i += 4) {
      hash = Math.imul(hash ^ (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)), 16777619)
    }
    return hash >>> 0
  })

/** A long, wavy drag across the pumpkin: enough points to leave visible cuts. */
async function carve(page: Page) {
  const canvas = page.getByLabel('Pumpkin carving canvas')
  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const before = await canvasPixels(canvas)

  for (const [y0, y1] of [[0.35, 0.45], [0.55, 0.65]] as const) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * y0)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * y1, { steps: 40 })
    await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * (y1 + 0.05), { steps: 40 })
    await page.mouse.up()
  }

  await expect(page.getByRole('meter', { name: /structural integrity/i })).toBeVisible()
  // Painting happens on the next animation frame; poll until pixels change.
  await expect.poll(() => canvasPixels(canvas), { message: 'canvas pixels changed after carving' })
    .not.toBe(before)
  await expect(page.getByRole('button', { name: /submit pumpkin \([1-9]\d* strokes\)/i })).toBeVisible()
}

test('two players carve, vote, and see results', async ({ browser }) => {
  test.setTimeout(ROUND_TIMEOUT_MS + 60_000)

  // Separate contexts: the client persists its session in localStorage.
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  const pageErrors: string[] = []
  for (const page of [host, guest]) page.on('pageerror', e => pageErrors.push(e.message))

  // Host creates a room
  await host.goto('/')
  await host.getByLabel('Your name').fill(HOST_NAME)
  await host.getByRole('button', { name: /start a new room/i }).click()
  const code = (await host.locator('.room-code').textContent())?.trim()
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  // Guest joins with the code; both lobbies show both players
  await guest.goto('/')
  await guest.getByLabel('Your name').fill(GUEST_NAME)
  await guest.getByLabel('Room code').fill(code!)
  await guest.getByRole('button', { name: /join game/i }).click()
  await expect(host.getByText(GUEST_NAME)).toBeVisible()
  await expect(host.getByText(HOST_NAME)).toBeVisible()
  await expect(guest.getByText(HOST_NAME)).toBeVisible()
  await expect(guest.getByText(GUEST_NAME)).toBeVisible()

  // Host starts; both reach the carve canvas
  await host.getByRole('button', { name: /start carving/i }).click()
  await expect(host.locator('canvas')).toBeVisible()
  await expect(guest.locator('canvas')).toBeVisible()

  // Both really carve (rasterization check), then submit explicitly. The screen
  // also auto-submits shortly before the deadline; clicking is just faster.
  for (const page of [host, guest]) {
    await carve(page)
    await page.getByRole('button', { name: /submit pumpkin/i }).click()
  }

  // Early exit: everyone submitted, so voting begins long before carving's deadline.
  await expect(host.getByRole('heading', { name: AWARD_HEADINGS[0]! }))
    .toBeVisible({ timeout: SLACK_MS * 2 })
  await expect(guest.getByRole('heading', { name: AWARD_HEADINGS[0]! })).toBeVisible()

  // Walk all four award phases
  for (const [i, heading] of AWARD_HEADINGS.entries()) {
    for (const page of [host, guest]) {
      await expect(page.getByRole('heading', { name: heading }))
        .toBeVisible({ timeout: phaseMs(VOTE_PHASES[Math.max(0, i - 1)]!) + SLACK_MS })
    }

    // The voter's own card is captioned and disabled; the other is votable.
    const own = host.getByRole('button', { name: /^Pumpkin \d+, Yours/ })
    await expect(own).toHaveCount(1)
    await expect(own).toBeDisabled()
    const others = host.locator('button[aria-pressed]:not([disabled])')
    await expect(others).toHaveCount(1)

    // Anonymity, asserted through the real UI, in every voting phase.
    await expectNoCarverNames(host)
    await expectNoCarverNames(guest)

    await others.first().click()
    await expect(others.first()).toHaveAttribute('aria-pressed', 'true')
  }

  // Results: the carvers are revealed
  const results = (page: Page) => page.getByRole('heading', { name: /^results$/i })
  await expect(results(host)).toBeVisible({ timeout: phaseMs('vote-cursed') + SLACK_MS })
  await expect(results(guest)).toBeVisible()
  const thumbs = host.getByRole('img', { name: /^Pumpkin \d+/ })
  await expect(thumbs.filter({ hasText: HOST_NAME }).first()).toBeVisible()
  await expect(thumbs.filter({ hasText: GUEST_NAME }).first()).toBeVisible()
  const surface = await visibleSurface(host)
  expect(surface).toContain(HOST_NAME)
  expect(surface).toContain(GUEST_NAME)

  expect(pageErrors).toEqual([])
  await hostContext.close()
  await guestContext.close()
})

test('a bad room code shows a helpful error', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Your name').fill('Nobody')
  await page.getByLabel('Room code').fill('ZZZZZZ')
  await page.getByRole('button', { name: /join game/i }).click()
  await expect(page.getByRole('alert')).toContainText(/no room with that code/i)
})
