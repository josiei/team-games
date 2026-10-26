import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_ROOM_CONFIG } from '../packages/server/src/rooms/store'

const ms = (phase: string) => DEFAULT_ROOM_CONFIG.phaseMs[phase]!

// Waits come from the server's own config, so a pacing change cannot silently
// break this test. SLACK covers network, render and the phase hand-off.
const SLACK = 4_000
const BLUE_NAME = 'Zephyrine'
const RED_NAME = 'Quillon'

/** Join an existing room through the UI, exactly as a real guest does. */
async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Room code').fill(code)
  await page.getByRole('button', { name: /join game/i }).click()
}

/** The choice buttons currently on screen, with their state. */
async function choices(page: Page) {
  return page.locator('.choice').evaluateAll(nodes =>
    nodes.map(n => ({
      text: n.querySelector('.choice-text')?.textContent ?? '',
      cut: n.className.includes('is-cut'),
      wrong: n.className.includes('is-wrong'),
      disabled: (n as HTMLButtonElement).disabled ?? false,
    })))
}

test('two teams play a full fright night board', async ({ browser, request }) => {
  test.setTimeout(180_000)

  // The dev module is hidden from the picker on purpose, so the room is made
  // by id. That is exactly what "reachable by id, never offered" means.
  const created = await request.post('/api/rooms', {
    data: { gameId: 'fright-night-dev' },
  })
  expect(created.ok()).toBeTruthy()
  const { code } = (await created.json()) as { code: string }
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  const blueContext = await browser.newContext()
  const redContext = await browser.newContext()
  const blue = await blueContext.newPage()
  const red = await redContext.newPage()
  const pageErrors: string[] = []
  for (const page of [blue, red]) page.on('pageerror', e => pageErrors.push(e.message))

  await join(blue, code, BLUE_NAME)
  await join(red, code, RED_NAME)

  // Teams and avatars, in the lobby, before the game exists.
  await blue.getByRole('button', { name: /join blue/i }).click()
  await red.getByRole('button', { name: /join red/i }).click()
  await blue.getByRole('button', { name: /choose the vampire avatar/i }).click()
  await red.getByRole('button', { name: /choose the ghost avatar/i }).click()

  await expect(blue.locator('.team-column').first()).toContainText(BLUE_NAME)
  await expect(blue.locator('.team-column').nth(1)).toContainText(RED_NAME)

  // Blue joined first, so blue is host.
  await blue.getByRole('button', { name: /start game/i }).click()

  // Both reach the board, and both see the same scores on the rail.
  await expect(blue.locator('.board')).toBeVisible({ timeout: SLACK })
  await expect(red.locator('.board')).toBeVisible()
  await expect(blue.locator('.score-rail')).toHaveCount(2)

  // Exactly one side can pick. Find which, without assuming the seed.
  const blueCanPick = await blue.locator('.board-tile:not(.is-spent)').first().isEnabled()
  const picker = blueCanPick ? blue : red
  const other = blueCanPick ? red : blue
  await expect(other.locator('.board-tile:not(.is-spent)').first()).toBeDisabled()

  const tileCount = await picker.locator('.board-tile').count()
  expect(tileCount).toBe(8)                       // 2 categories x 4 rows

  await picker.locator('.board-tile:not(.is-spent)').first().click()

  // Reading: the buzzer is dead on BOTH screens, and pressing it does nothing.
  const deadBuzzer = picker.getByRole('button', { name: /reading/i })
  await expect(deadBuzzer).toBeVisible({ timeout: SLACK })
  await expect(deadBuzzer).toBeDisabled()
  await deadBuzzer.click({ force: true }).catch(() => {})
  await expect(picker.getByRole('button', { name: /reading/i })).toBeVisible()

  // The choices are on screen from the start, for everyone, inert.
  const earlyChoices = await other.locator('.choice').count()
  expect(earlyChoices).toBeGreaterThanOrEqual(4)
  expect((await choices(other)).every(c => c.disabled)).toBe(true)

  // Armed.
  const armed = picker.getByRole('button', { name: /buzz in/i })
  await expect(armed).toBeEnabled({ timeout: ms('reading') + SLACK })
  await armed.click()

  // The room sees who is answering; only that player gets live buttons.
  await expect(other.getByRole('status')).toContainText(/is answering for/i,
    { timeout: SLACK })
  expect((await choices(other)).every(c => c.disabled)).toBe(true)

  // Spend a flashlight: two options dim HERE and nowhere else.
  await picker.getByRole('button', { name: /flashlight/i }).click()
  await expect.poll(async () => (await choices(picker)).filter(c => c.cut).length)
    .toBeGreaterThan(0)
  expect((await choices(other)).some(c => c.cut)).toBe(false)

  // Answer wrong on purpose, from the two options the flashlight left.
  const live = await picker.locator('.choice:not(.is-cut):not([disabled])').count()
  expect(live).toBeGreaterThanOrEqual(1)
  await picker.locator('.choice:not(.is-cut):not([disabled])').first().click()

  // Either the steal opens, or that first pick happened to be right.
  const stealOpened = await other.getByRole('button', { name: /buzz in/i })
    .isVisible({ timeout: ms('answer') + SLACK })
    .catch(() => false)

  if (stealOpened) {
    // The wrong pick is public; the flashlight cut is not.
    const stealChoices = await choices(other)
    expect(stealChoices.some(c => c.wrong)).toBe(true)
    expect(stealChoices.some(c => c.cut)).toBe(false)

    await other.getByRole('button', { name: /buzz in/i }).click()
    await expect(other.locator('.choice:not([disabled])').first())
      .toBeEnabled({ timeout: SLACK })
    await other.locator('.choice:not([disabled])').first().click()
  }

  // Whatever happened, the clue resolves and says so in words.
  await expect(picker.locator('.reveal-outcome'))
    .toBeVisible({ timeout: ms('answer') + ms('steal') + SLACK })

  // Back to the board with that tile now spent.
  await expect(picker.locator('.board')).toBeVisible({ timeout: ms('reveal') + SLACK })
  await expect(picker.locator('.board-tile.is-spent')).toHaveCount(1)

  // The host ends it rather than clearing seven more tiles.
  await blue.getByRole('button', { name: /end game/i }).click()
  for (const page of [blue, red]) {
    await expect(page.locator('.results-title'))
      .toBeVisible({ timeout: ms('board') + ms('reveal') + SLACK })
  }

  expect(pageErrors).toEqual([])
  await blueContext.close()
  await redContext.close()
})

test('the dev game is never offered in the picker', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Your name').fill('Scout')
  await page.getByRole('button', { name: /start a new room/i }).click()
  await expect(page.getByRole('button', { name: /Jack-o-Lantern/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /dev pack/i })).toHaveCount(0)
})
