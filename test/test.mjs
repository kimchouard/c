// Zero-dependency test suite: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { until, planLabel, sortByRecent, discover, table, loadDb, fetchUsage, defaultFlags } from '../c.mjs'

const CLI = fileURLToPath(new URL('../c.mjs', import.meta.url))
const NOW = Date.parse('2026-08-19T12:00:00Z')

// Run the CLI and capture stdout/stderr/status without throwing.
function cli (args, env = {}, entry = CLI) {
  try {
    return { status: 0, out: execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) }
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// A throwaway HOME with fake config dirs, so discovery is tested against
// a known layout rather than whatever accounts the developer happens to have.
function fakeHome (accounts) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'c-test-'))
  for (const [dirName, oauth] of Object.entries(accounts)) {
    const dir = path.join(home, dirName)
    fs.mkdirSync(dir, { recursive: true })
    if (oauth !== null) fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }))
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: oauth ?? {} }))
  }
  return home
}

test('until formats the gap in the largest two units', () => {
  assert.equal(until('2026-08-19T12:41:00Z', NOW), '41m')
  assert.equal(until('2026-08-19T14:27:00Z', NOW), '2h 27m')
  assert.equal(until('2026-08-26T15:00:00Z', NOW), '7d 3h')
  assert.equal(until('2026-08-19T13:00:00Z', NOW), '1h 0m')
})

test('until degrades instead of printing NaN', () => {
  assert.equal(until(null, NOW), '-')
  assert.equal(until('not a date', NOW), '-')
  assert.equal(until('2026-08-19T11:00:00Z', NOW), 'now', 'a window already past reads as now, never negative')
})

test('planLabel strips the internal tier prefix', () => {
  assert.equal(planLabel('default_claude_max_20x'), 'max 20x')
  assert.equal(planLabel('default_claude_pro'), 'pro')
  assert.equal(planLabel(undefined), '')
})

test('sortByRecent puts the last-used account first, unknowns alphabetically last', () => {
  const accounts = [{ id: 'work' }, { id: 'main' }, { id: 'team' }]
  assert.deepEqual(sortByRecent(accounts, ['team', 'main']).map(a => a.id), ['team', 'main', 'work'])
  assert.deepEqual(sortByRecent(accounts, []).map(a => a.id), ['main', 'team', 'work'])
})

test('sortByRecent does not mutate its input', () => {
  const accounts = [{ id: 'b' }, { id: 'a' }]
  sortByRecent(accounts, ['a'])
  assert.deepEqual(accounts.map(a => a.id), ['b', 'a'])
})

test('discover finds credentialed dirs only, and never the default-dir sibling caches', () => {
  const home = fakeHome({
    '.claude': { displayName: 'personal' },
    '.claude-work': { displayName: 'Work', organizationRateLimitTier: 'default_claude_max_5x' },
    '.claude-mem': null // a plugin cache dir: no credentials, not an account
  })
  const found = discover(home, [])
  assert.deepEqual(found.map(a => a.id), ['main', 'work'])
  assert.equal(found[1].plan, 'max 5x')
})

test('discover falls back to the legacy ~/.claude.json for the default dir', () => {
  const home = fakeHome({ '.claude': { displayName: 'personal' } })
  // The tier lives only in the legacy file for the default config dir.
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { organizationRateLimitTier: 'default_claude_max_20x' } }))
  const [acc] = discover(home, [])
  assert.equal(acc.name, 'personal', 'the per-dir file still wins for fields it has')
  assert.equal(acc.plan, 'max 20x', 'and the legacy file fills in the ones it does not')
})

test('discover labels an account with no profile yet', () => {
  const home = fakeHome({ '.claude-fresh': {} })
  assert.deepEqual(discover(home, []).map(a => a.name), ['.claude-fresh'])
})

test('table aligns every column, including a row whose usage failed', () => {
  const accounts = [{ id: 'a', name: 'personal', plan: 'max 20x' }, { id: 'b', name: 'work', plan: 'max 5x' }]
  const usage = {
    a: { five: { pct: 9, resets: '2026-08-19T14:00:00Z' }, week: { pct: 91 } },
    b: { error: 'logged out' }
  }
  const lines = table(accounts, usage).split('\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0].indexOf('5h') + 1, lines[1].indexOf('9%') + 1, 'the 5h header sits over the 5h number')
  assert.equal(lines[0].indexOf('week') + 3, lines[1].indexOf('91%') + 2, 'the week header sits over the week number')
  assert.match(lines[2], /logged out/)
})

test('table points the arrow at the cursor row, not always the first', () => {
  const accounts = [{ id: 'a', name: 'personal' }, { id: 'b', name: 'work' }, { id: 'c', name: 'team' }]
  const rowFor = cursor => table(accounts, {}, { cursor }).split('\n').findIndex(l => l.includes('\u2192'))
  assert.equal(rowFor(0), 1, 'row 1 is the first account, row 0 is the header')
  assert.equal(rowFor(2), 3)
  assert.equal(table(accounts, {}).split('\n').findIndex(l => l.includes('\u2192')), 1, 'no cursor given still marks the most-recent account')
})

test('table survives an account it has no cached usage for', () => {
  const out = table([{ id: 'a', name: 'personal', plan: 'pro' }], {})
  assert.match(out, /personal/)
  assert.doesNotMatch(out, /undefined|NaN/)
})

test('loadDb defaults to yolo on, worktree off, and an empty history', () => {
  const db = loadDb(path.join(os.tmpdir(), 'c-does-not-exist.json'))
  assert.equal(db.yolo, true)
  assert.equal(db.worktree, false)
  assert.deepEqual(db.order, [])
  assert.deepEqual(db.usage, {})
})

test('defaultFlags turns db toggles into claude flags', () => {
  assert.deepEqual(defaultFlags({ yolo: false, worktree: false }), [])
  assert.deepEqual(defaultFlags({ yolo: true, worktree: false }), ['--dangerously-skip-permissions'])
  assert.deepEqual(defaultFlags({ yolo: true, worktree: true }), ['--dangerously-skip-permissions', '--worktree'])
})

test('defaultFlags never doubles a flag the caller already typed', () => {
  const db = { yolo: true, worktree: true }
  assert.deepEqual(defaultFlags(db, ['--worktree']), ['--dangerously-skip-permissions'])
  assert.deepEqual(defaultFlags(db, ['--worktree', '--dangerously-skip-permissions']), [])
})

test('fetchUsage reports a missing token rather than throwing', async () => {
  const res = await fetchUsage(fs.mkdtempSync(path.join(os.tmpdir(), 'c-empty-')), NOW)
  assert.equal(res.error, 'no token')
})

test('help and version exit clean', () => {
  const help = cli(['help'])
  assert.equal(help.status, 0)
  assert.match(help.out, /Claude Code accounts/)
  assert.match(help.out, /c add <id>/)

  const version = cli(['version'])
  assert.equal(version.status, 0)
  assert.match(version.out.trim(), /^\d+\.\d+\.\d+/)
})

test('runs through a symlink, the way an installed c is invoked', () => {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c-bin-')), 'c')
  fs.symlinkSync(CLI, bin)
  const r = cli(['help'], {}, bin)
  assert.equal(r.status, 0)
  assert.match(r.out, /Claude Code accounts/, 'a symlinked entry point must still reach main()')
})

test('add refuses a name that is not a safe directory segment', () => {
  for (const bad of ['', 'x y', '../escape', 'a/b']) {
    const r = cli(['add', bad])
    assert.equal(r.status, 1, `"${bad}" must be rejected`)
    assert.match(r.out, /usage: c add/)
  }
})

test('add refuses an account that is already logged in', () => {
  const home = fakeHome({ '.claude-work': { displayName: 'Work' } })
  const r = cli(['add', 'work'], { HOME: home })
  assert.equal(r.status, 1)
  assert.match(r.out, /already logged in/)
})

test('-a rejects an unknown account and lists the real ones', () => {
  const home = fakeHome({ '.claude-work': { displayName: 'Work' } })
  const r = cli(['-a', 'nope'], { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') })
  assert.equal(r.status, 1)
  assert.match(r.out, /no account "nope"/)
  assert.match(r.out, /have: work/)
})

test('a home with no logged-in dirs points at the fix instead of crashing', () => {
  const home = fakeHome({ '.claude-mem': null })
  const r = cli(['status'], { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') })
  assert.equal(r.status, 1)
  assert.match(r.out, /c add <id>/)
})
