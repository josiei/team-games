import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_ROOM_CONFIG } from '../packages/server/src/rooms/store'

function phaseMs0(phase: string) { return DEFAULT_ROOM_CONFIG.phaseMs[phase]! }
const phaseMs = phaseMs0

// Phase lengths come from the server's own config, so a timing change cannot
// silently break this test. SLACK covers network, render and the phase hand-off.
const VOTE_PHASES = ['vote-scariest', 'vote-funniest', 'vote-craft', 'vote-cursed'] as const
const AWARD_HEADINGS = [/scariest/i, /funniest/i, /craftsmanship/i, /cursed/i]
// Slack and the early-exit bound scale with the configured durations.
const SLACK_MS = Math.round(phaseMs0('vote-scariest') * (2 / 3))
const EARLY_EXIT_MS = Math.round(phaseMs0('carving') / 4)
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

type Rgba = [number, number, number, number]

/** Hash of every canvas pixel: a coarse "something repainted" check only. */
const canvasHash = (canvas: Locator) =>
  canvas.evaluate((el: HTMLCanvasElement) => {
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
    let hash = 2166136261
    for (let i = 0; i < data.length; i += 4) {
      hash = Math.imul(hash ^ (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)), 16777619)
    }
    return hash >>> 0
  })

/** RGBA at normalized (0..1) canvas coordinates, read from the real bitmap. */
const pixelsAt = (canvas: Locator, points: [number, number][]) =>
  canvas.evaluate((el: HTMLCanvasElement, pts: [number, number][]) => {
    const ctx = el.getContext('2d')!
    return pts.map(([x, y]) =>
      [...ctx.getImageData(Math.round(x * el.width), Math.round(y * el.height), 1, 1).data] as Rgba)
  }, points)

const distance = (a: Rgba, b: Rgba) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])

/** Fraction of the line from `from` to `to`; mirrors Playwright's linear mouse steps. */
const along = (from: [number, number], to: [number, number], t: number): [number, number] =>
  [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]

/**
 * A long, wavy drag across the pumpkin, with the cuts verified in the bitmap:
 * 1. the canvas is first proven to hold a painted, opaque pumpkin body;
 * 2. pixels sampled ALONG the dragged line must change substantially (the cut
 *    punches through the body to the glow layer);
 * 3. a control pixel well away from every drag must be untouched.
 */
async function carve(page: Page) {
  const canvas = page.getByLabel('Pumpkin carving canvas')
  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!

  const A: [number, number] = [0.25, 0.35], B: [number, number] = [0.75, 0.45]
  const onPath = [0.2, 0.4, 0.6, 0.8].map(t => along(A, B, t))
  const control: [number, number] = [0.5, 0.85]

  /**
   * Baseline must be a painted pumpkin body: opaque, and pumpkin-coloured at
   * every sample.
   *
   * Checked by CHANNEL ORDER, not brightness. This used to require red > 200,
   * which was true of the flat fill the body used to be and is not true of the
   * shaded one: it carries a radial gradient, a rim vignette and seams, and the
   * player's variety is drawn from the room code, so a sample can land on a
   * dark seam or deep in the vignette. Measured over all six varieties at these
   * five points: alpha is always 255, red runs 123..255, and red > green > blue
   * holds everywhere with at least 66 and 44 to spare. Flesh is flesh at any
   * brightness; a blank or black canvas fails the ordering immediately.
   */
  let baseline: Rgba[] = []
  await expect.poll(async () => {
    baseline = await pixelsAt(canvas, [...onPath, control])
    return baseline.every(px => px[3] === 255 && px[0] > px[1] && px[1] > px[2] && px[0] > 90)
  }, { message: 'canvas painted an opaque pumpkin body before carving' }).toBe(true)
  const hashBefore = await canvasHash(canvas)

  const at = (n: [number, number]) => [box.x + box.width * n[0], box.y + box.height * n[1]] as const
  await page.mouse.move(...at(A))
  await page.mouse.down()
  await page.mouse.move(...at(B), { steps: 40 })
  await page.mouse.up()
  // Second, separate stroke elsewhere, so the stroke counter reads more than one.
  await page.mouse.move(...at([0.3, 0.6]))
  await page.mouse.down()
  await page.mouse.move(...at([0.7, 0.65]), { steps: 40 })
  await page.mouse.up()

  await expect(page.getByRole('meter', { name: /structural integrity/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /submit pumpkin \(([2-9]|\d{2,}) strokes\)/i })).toBeVisible()

  // Painting is on the next animation frame: poll until every path sample has changed.
  await expect.poll(async () => {
    const now = await pixelsAt(canvas, onPath)
    return Math.min(...now.map((px, i) => distance(px, baseline[i]!)))
  }, { message: 'pixels along the drag path changed substantially' })
    .toBeGreaterThan(100)
  const now = await pixelsAt(canvas, [...onPath, control])
  now.slice(0, onPath.length).forEach((px, i) =>
    expect(distance(px, baseline[i]!), `path sample ${i} changed`).toBeGreaterThan(100))
  expect(now[onPath.length], 'control pixel untouched').toEqual(baseline[onPath.length])
  expect(await canvasHash(canvas)).not.toBe(hashBefore)
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
    .toBeVisible({ timeout: EARLY_EXIT_MS })
  await expect(guest.getByRole('heading', { name: AWARD_HEADINGS[0]! })).toBeVisible()

  // Walk all four award phases
  for (const [i, heading] of AWARD_HEADINGS.entries()) {
    for (const page of [host, guest]) {
      await expect(page.getByRole('heading', { name: heading }))
        .toBeVisible({ timeout: phaseMs(VOTE_PHASES[Math.max(0, i - 1)]!) + SLACK_MS })
    }

    // Both players vote. Locators resolve at action time, so nothing decided
    // earlier can go stale across a phase boundary.
    for (const page of [host, guest]) {
      // The voter's own card is captioned and disabled.
      await expect(page.getByRole('button', { name: /^Pumpkin \d+, Yours/ })).toBeDisabled()
      // Anonymity, asserted through the real UI, in every voting phase.
      await expectNoCarverNames(page)
      const votable = page.locator('button[aria-pressed]:not([disabled])').first()
      await votable.click()
      await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1)
    }
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
