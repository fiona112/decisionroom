import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { clientBuild } from 'deepspace'
import { readFileSync } from 'node:fs'
import type { BrowserContext, Page } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

// Real auth, real Worker/SQLite, real WebSockets. The config gives this suite
// ephemeral storage, so test data never touches the user's development rooms.
test.skip(loadAllTestAccounts().length < 3, 'Needs three usable DeepSpace test accounts.')

async function client(context: BrowserContext) {
  const tokenResponse = await context.request.post('/api/auth/token')
  expect(tokenResponse.ok()).toBeTruthy()
  const { token } = await tokenResponse.json()
  const headers = { Authorization: `Bearer ${token}` }
  // Discover the exposed tool schemas before invoking them.
  const catalog = await context.request.get('/_deepspace/agent/browser/tools', { headers })
  expect(catalog.ok()).toBeTruthy()
  const { tools } = await catalog.json()
  expect(tools.find((t: { name: string }) => t.name === 'records_query')).toBeTruthy()
  return {
    async command(input: Record<string, unknown>) {
      const response = await context.request.post('/api/actions/decision', { headers, data: input })
      expect(response.ok()).toBeTruthy()
      return response.json()
    },
    async tool(name: string, input: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
      expect(tools.find((t: { name: string }) => t.name === name)).toBeTruthy()
      const response = await context.request.post(`/_deepspace/agent/browser/tools/${name}`, { headers: { ...headers, ...extraHeaders }, data: { input } })
      const json = await response.json()
      return json.result ?? { success: false, error: json.error }
    },
  }
}

test('DecisionRoom: unconfigured integrations cannot spend owner credits', async ({ users }) => {
  const [user] = await users(1)
  await openHome(user.page)
  const { token } = await (await user.context.request.post('/api/auth/token')).json()
  const response = await user.context.request.post('/api/integrations/openai/chat-completion', {
    headers: { Authorization: `Bearer ${token}` }, data: {},
  })
  expect(response.status()).toBe(404)
  expect(await response.json()).toEqual({ error: 'Unknown integration' })
})
async function openHome(page: Page) {
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your decision rooms' })).toBeVisible()
  await expect(page.getByTestId('nav-user-name')).toHaveText(/\S/)
}

test('DecisionRoom: invitation, live voting, vote change, discussion, close, reload and mobile', async ({ users }, testInfo) => {
  test.setTimeout(120_000)
  const [host, guest, outsider] = await users(3)
  const errors = captureConsoleErrors(host.page)
  await Promise.all([openHome(host.page), openHome(guest.page), openHome(outsider.page)])
  const h = await client(host.context)
  const g = await client(guest.context)
  const o = await client(outsider.context)
  const title = `__test-${Date.now()}__ Team offsite`
  await host.page.getByRole('button', { name: 'New room', exact: true }).click()
  await host.page.getByLabel('Room title').fill(title)
  await host.page.getByLabel('Context').fill('Let’s choose a place to spend an afternoon together.')
  await host.page.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(host.page.getByRole('heading', { name: title })).toBeVisible()
  const roomId = new URL(host.page.url()).searchParams.get('room')!
  const invitation = await h.tool('records_query', { collection: 'invitations', where: { teamId: roomId } })
  const token = invitation.data.records[0].data.token
  await host.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await host.page.getByRole('button', { name: 'Invite people' }).click()
  await expect(host.page.getByRole('button', { name: 'Link copied' })).toBeVisible()
  expect(await host.page.evaluate(() => navigator.clipboard.readText())).toContain(`invite=${token}`)
  await outsider.page.goto(`/home?room=${roomId}`)
  await expect(outsider.page.getByRole('heading', { name: 'This room isn’t available.' })).toBeVisible()
  for (const collection of ['rooms', 'team_members', 'invitations', 'suggestions', 'votes', 'comments']) {
    const hidden = await o.tool('records_query', { collection, where: { teamId: roomId } })
    expect(hidden.success).toBe(true)
    expect(hidden.data.records).toHaveLength(0)
  }
  expect((await o.command({ kind: 'comment', roomId, body: 'Intrusion' })).success).toBe(false)
  await guest.page.goto(`/home?invite=${token}`)
  await guest.page.getByRole('button', { name: 'Join room', exact: true }).click()
  await expect(guest.page.getByRole('heading', { name: title })).toBeVisible()
  await expect(host.page.getByText('2 members', { exact: true })).toBeVisible()
  // Joining twice is harmless; the unique membership tuple stays single.
  expect((await g.command({ kind: 'join', token })).success).toBe(true)
  expect((await h.tool('records_query', { collection: 'team_members', where: { teamId: roomId } })).data.records).toHaveLength(2)
  for (const [page, name] of [[host.page, 'An afternoon outdoors'], [guest.page, 'A creative workshop']] as const) {
    await page.getByRole('button', { name: 'Add option', exact: true }).click()
    await page.getByLabel('Option title').fill(name)
    await page.getByLabel('Why this option?').fill('A chance to spend time together away from our desks.')
    await page.getByRole('button', { name: 'Add option', exact: true }).last().click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  const optionA = host.page.getByTestId('option-card').filter({ hasText: 'An afternoon outdoors' })
  const guestA = guest.page.getByTestId('option-card').filter({ hasText: 'An afternoon outdoors' })
  const guestB = guest.page.getByTestId('option-card').filter({ hasText: 'A creative workshop' })
  await expect(host.page.getByRole('heading', { name: 'A creative workshop' })).toBeVisible()
  await optionA.getByRole('button', { name: 'Vote for this option' }).click()
  await expect(guestA.getByText('1 vote', { exact: true })).toBeVisible()
  await guestA.getByRole('button', { name: 'Vote for this option' }).click()
  await expect(optionA.getByText('2 votes', { exact: true })).toBeVisible()
  await guestB.getByRole('button', { name: 'Vote for this option' }).click()
  await expect(optionA.getByText('1 vote', { exact: true })).toBeVisible()
  expect((await h.tool('records_query', { collection: 'votes', where: { teamId: roomId } })).data.records).toHaveLength(2)
  await guest.page.getByLabel('Your comment').fill('The workshop gives us a good rainy-day option.')
  await guest.page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(host.page.getByText('The workshop gives us a good rainy-day option.')).toBeVisible()
  await guest.page.getByLabel('Your comment').fill('A draft worth keeping')
  await guest.context.setOffline(true)
  await expect(guest.page.getByText('Connection lost.', { exact: false })).toBeVisible()
  await h.command({ kind: 'comment', roomId, body: 'A message sent while you were away.' })
  await guest.context.setOffline(false)
  await expect(guest.page.getByText('A message sent while you were away.')).toBeVisible({ timeout: 20_000 })
  await expect(guest.page.getByLabel('Your comment')).toHaveValue('A draft worth keeping')
  await guest.page.getByLabel('Your comment').fill('')
  expect((await g.command({ kind: 'close', roomId })).success).toBe(false)
  await expect(guest.page.getByRole('button', { name: 'Close voting', exact: true })).toHaveCount(0)
  await host.page.evaluate(() => window.scrollTo(0, 0))
  await host.page.screenshot({ path: testInfo.outputPath('room-desktop.png'), fullPage: true, animations: 'disabled' })
  await guest.page.setViewportSize({ width: 390, height: 844 })
  await expect(guest.page.getByRole('heading', { name: title })).toBeVisible()
  expect(await guest.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await guest.page.evaluate(() => window.scrollTo(0, 0))
  await guest.page.screenshot({ path: testInfo.outputPath('room-mobile.png'), fullPage: true, animations: 'disabled' })
  await host.page.getByRole('button', { name: 'Close voting', exact: true }).click()
  await host.page.getByRole('button', { name: 'Confirm close' }).click()
  await expect(guest.page.getByRole('heading', { name: 'It’s a tie between 2 options' })).toBeVisible()
  const options = (await h.tool('records_query', { collection: 'suggestions', where: { teamId: roomId } })).data.records
  expect((await g.command({ kind: 'vote', roomId, suggestionId: options[0].recordId })).success).toBe(false)
  expect((await h.command({ kind: 'suggest', roomId, title: 'Too late' })).success).toBe(false)
  expect((await g.command({ kind: 'comment', roomId, body: 'Thanks, everyone!' })).success).toBe(true)
  await guest.page.reload()
  await expect(guest.page.getByRole('heading', { name: 'It’s a tie between 2 options' })).toBeVisible()
  await expect(guest.page.getByText('Thanks, everyone!')).toBeVisible()
  // A member still cannot expose these now-populated collections to outsiders.
  for (const collection of ['rooms', 'team_members', 'invitations', 'suggestions', 'votes', 'comments']) {
    expect((await o.tool('records_query', { collection, where: { teamId: roomId } })).data.records).toHaveLength(0)
  }
  expect(errors).toEqual([])
})

test('DecisionRoom: forged writes, identity spoofing, concurrent votes and close race', async ({ users }) => {
  test.setTimeout(120_000)
  const [host, guest, other] = await users(3)
  await Promise.all([openHome(host.page), openHome(guest.page), openHome(other.page)])
  const h = await client(host.context), g = await client(guest.context), o = await client(other.context)
  const created = await h.command({ kind: 'createRoom', title: `__test-${Date.now()}__ Rules` })
  expect(created.success).toBe(true)
  const roomId = created.data.roomId
  const invitation = (await h.tool('records_query', { collection: 'invitations', where: { teamId: roomId } })).data.records[0]
  expect((await g.command({ kind: 'join', token: invitation.data.token })).success).toBe(true)
  expect((await h.command({ kind: 'suggest', roomId, title: 'Option one' })).success).toBe(true)
  expect((await h.command({ kind: 'suggest', roomId, title: 'Option two' })).success).toBe(true)
  const options = (await h.tool('records_query', { collection: 'suggestions', where: { teamId: roomId } })).data.records
  // Bypass React and the HTTP tools: verify the actual WebSocket boundary.
  const appId = readFileSync('wrangler.toml', 'utf8').match(/DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/)![1]
  const { token: guestToken } = await (await guest.context.request.post('/api/auth/token')).json()
  const collections = ['rooms', 'team_members', 'invitations', 'suggestions', 'votes', 'comments']
  const messages = collections.flatMap(collection => [
    clientBuild.subscribe(collection, { collection, where: { teamId: roomId } }),
    clientBuild.put(collection, collection === 'rooms' ? roomId : crypto.randomUUID(),
      { teamId: roomId, userId: host.userId, hostId: guest.userId, status: 'closed', body: 'forged' }, `forged-${collection}`),
  ])
  for (const token of ['', guestToken]) {
    const result = await guest.page.evaluate(async ({ appId, token, hostId, messages }) => {
      const url = new URL(`/ws/${encodeURIComponent(`app:${appId}`)}`, location.origin)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      if (token) url.searchParams.set('token', token)
      url.searchParams.set('userId', hostId)
      url.searchParams.set('role', 'admin')
      return new Promise<{ snapshots: Record<string, unknown[]>; acks: boolean[] }>((resolve, reject) => {
        const ws = new WebSocket(url)
        const snapshots: Record<string, unknown[]> = {}, acks: boolean[] = []
        const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket permission probe timed out')) }, 10_000)
        ws.onopen = () => messages.forEach(message => ws.send(JSON.stringify(message)))
        ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')) }
        ws.onmessage = event => {
          const message = JSON.parse(String(event.data))
          if (message.type === 'core.query_result') snapshots[message.payload.subscriptionId] = message.payload.records
          if (message.type === 'records.ack') acks.push(message.payload.success)
          if (Object.keys(snapshots).length === 6 && acks.length === 6) {
            clearTimeout(timer); ws.close(); resolve({ snapshots, acks })
          }
        }
      })
    }, { appId, token, hostId: host.userId!, messages })
    expect(result.acks).toEqual(Array(6).fill(false))
    if (!token) for (const rows of Object.values(result.snapshots)) expect(rows).toHaveLength(0)
    else expect(result.snapshots.rooms).toHaveLength(1)
  }
  const otherRoom = (await o.command({ kind: 'createRoom', title: `__test-${Date.now()}__ Other room` })).data.roomId
  await o.command({ kind: 'suggest', roomId: otherRoom, title: 'Foreign option' })
  const foreign = (await o.tool('records_query', { collection: 'suggestions', where: { teamId: otherRoom } })).data.records[0]
  expect((await g.command({ kind: 'vote', roomId, suggestionId: foreign.recordId })).success).toBe(false)
  expect((await g.command({ kind: 'join', token: 'not-an-invitation' })).success).toBe(false)
  expect((await h.command({ kind: 'suggest', roomId, title: '  ' })).success).toBe(false)
  expect((await h.command({ kind: 'comment', roomId, body: 'x'.repeat(2001) })).success).toBe(false)
  for (const collection of ['rooms', 'team_members', 'invitations', 'suggestions', 'votes', 'comments']) {
    const forged = await g.tool('records_create', { collection, data: { teamId: roomId, title: 'Forged', userId: host.userId, status: 'active', suggestionId: options[0].recordId } }, { 'X-App-Action': 'true', 'X-User-Id': host.userId! })
    expect(forged.success).toBe(false)
  }
  expect((await g.tool('records_update', { collection: 'rooms', recordId: roomId, data: { hostId: guest.userId, status: 'closed' } })).success).toBe(false)
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => g.command({ kind: 'vote', roomId, suggestionId: options[i % 2].recordId, userId: host.userId })))
  expect(concurrent.every(r => r.success)).toBe(true)
  let votes = (await h.tool('records_query', { collection: 'votes', where: { teamId: roomId } })).data.records
  expect(votes).toHaveLength(1)
  expect(votes[0].data.userId).toBe(guest.userId)
  expect((await h.tool('records_update', { collection: 'votes', recordId: votes[0].recordId, data: { suggestionId: options[0].recordId } })).success).toBe(false)
  // Whichever reaches the DO first wins; close must freeze the final value.
  const racing = await Promise.all([
    h.command({ kind: 'close', roomId }),
    ...Array.from({ length: 5 }, (_, i) => g.command({ kind: 'vote', roomId, suggestionId: options[i % 2].recordId })),
  ])
  expect(racing[0].success).toBe(true)
  votes = (await h.tool('records_query', { collection: 'votes', where: { teamId: roomId } })).data.records
  const frozen = votes[0].data.suggestionId
  expect((await g.command({ kind: 'vote', roomId, suggestionId: options.find((r: { recordId: string }) => r.recordId !== frozen).recordId })).success).toBe(false)
  expect((await h.tool('records_query', { collection: 'votes', where: { teamId: roomId } })).data.records[0].data.suggestionId).toBe(frozen)
  expect((await g.tool('records_delete', { collection: 'rooms', recordId: roomId })).success).toBe(false)
})
