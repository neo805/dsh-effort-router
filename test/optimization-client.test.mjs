import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// These are behavior tests of the real TS/TSX modules, bundled by the same
// compiler as production. The small React hook runtime below executes actual
// effects, cleanups and state updates; it is not a source-text assertion.
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SESSION_A = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SESSION_B = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SESSION_C = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
const ANCHOR_ID = 'assistant\0' + '1' + '\0' + '1'

let outDir
let Badge
let startTrajectoryDecorator
let applyClient
let CSS

const reactRuntimePlugin = {
  name: 'minimal-react-runtime',
  setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-react' }))
    builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'test-react' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-react' }, (args) => ({
      loader: 'js',
      contents: args.path === 'react'
        ? `const runtime = () => globalThis.__effortRouterTestReact
           export function useState(...args) { return runtime().useState(...args) }
           export function useEffect(...args) { return runtime().useEffect(...args) }`
        : `export const Fragment = Symbol('Fragment')
           export function jsx(type, props) { return { type, props } }
           export const jsxs = jsx`,
    }))
  },
}

// Isolate apply()'s config-request lifecycle from surfaces under other tests.
// apply itself and its ctx.effect cleanup semantics remain the code under test.
const indexSurfacePlugin = {
  name: 'index-surface-doubles',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/(Badge|trajectory|annotations)$/ }, (args) => {
      if (args.importer !== join(ROOT, 'src/client/index.tsx')) return null
      return { path: args.path, namespace: 'index-surface' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'index-surface' }, (args) => {
      const sources = {
        './Badge': 'export function Badge() { return null }',
        './trajectory': `export function startTrajectoryDecorator() {
          return () => { globalThis.__effortRouterTrajectoryStops = (globalThis.__effortRouterTrajectoryStops || 0) + 1 }
        }`,
        './annotations': `export const ROUTE_KIND = 'effort-router-route'
          export function RouteRow() { return null }
          export const routeRowDefinition = { kind: ROUTE_KIND }`,
      }
      return { loader: 'js', contents: sources[args.path] }
    })
  },
}

before(async () => {
  outDir = mkdtempSync(join(ROOT, 'test/.tmp-client-behavior-'))
  const entry = (name) => join(ROOT, 'src/client', name)
  await Promise.all([
    build({
      entryPoints: [entry('Badge.tsx')], outfile: join(outDir, 'badge.mjs'),
      bundle: true, format: 'esm', platform: 'neutral', target: 'node22',
      jsx: 'automatic', plugins: [reactRuntimePlugin], logLevel: 'silent',
    }),
    build({
      entryPoints: [entry('trajectory.ts')], outfile: join(outDir, 'trajectory.mjs'),
      bundle: true, format: 'esm', platform: 'neutral', target: 'node22', logLevel: 'silent',
    }),
    build({
      entryPoints: [entry('index.tsx')], outfile: join(outDir, 'index.mjs'),
      bundle: true, format: 'esm', platform: 'neutral', target: 'node22',
      jsx: 'automatic', plugins: [indexSurfacePlugin], logLevel: 'silent',
    }),
    build({
      entryPoints: [entry('styles.ts')], outfile: join(outDir, 'styles.mjs'),
      bundle: true, format: 'esm', platform: 'neutral', target: 'node22', logLevel: 'silent',
    }),
  ])
  const load = (name) => import(pathToFileURL(join(outDir, name)).href + '?behavior=1')
  ;({ Badge } = await load('badge.mjs'))
  ;({ startTrajectoryDecorator } = await load('trajectory.mjs'))
  ;({ apply: applyClient } = await load('index.mjs'))
  ;({ CSS } = await load('styles.mjs'))
})

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

function installGlobals(t, values) {
  const saved = Object.entries(values).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    return { key, descriptor }
  })
  t.after(() => {
    for (const { key, descriptor } of saved.reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
}

function deferredFetch() {
  const requests = []
  const fetch = (url, options = {}) => {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    requests.push({
      url: String(url), options, signal: options.signal, resolve, reject,
      respond(payload) {
        resolve({ ok: true, json: async () => payload })
      },
    })
    return promise
  }
  return { fetch, requests }
}

function fakeTimers() {
  let nextId = 1
  const timers = new Map()
  return {
    setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
  }
}

function fakeFrames() {
  let nextId = 1
  const frames = new Map()
  return {
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    },
  }
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.resolve()
}

function badgePayload(effort) {
  return { ok: true, enabled: true, showBadge: true, last: { mode: 'auto', effort } }
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props && node.props.children)
}

// Enough React semantics for Badge: state slots, dependency-aware effects,
// effect cleanup on prop change/unmount, and synchronous test-visible renders.
function createHookRuntime(Component) {
  const states = []
  const effects = []
  let props
  let output = null
  let stateCursor = 0
  let effectCursor = 0
  let pendingEffects = []
  let rendering = false
  let runningEffects = false
  let dirty = false
  let alive = true
  let staleWrites = 0

  function render(nextProps = props) {
    if (!alive) return
    props = nextProps
    stateCursor = 0
    effectCursor = 0
    pendingEffects = []
    rendering = true
    globalThis.__effortRouterTestReact = runtime
    try { output = Component(props) } finally {
      rendering = false
      delete globalThis.__effortRouterTestReact
    }
    runningEffects = true
    for (const pending of pendingEffects) {
      const previous = effects[pending.index]
      if (previous && typeof previous.cleanup === 'function') previous.cleanup()
      const cleanup = pending.create()
      effects[pending.index] = { deps: pending.deps, cleanup }
    }
    runningEffects = false
    if (dirty) { dirty = false; render() }
  }

  const runtime = {
    useState(initial) {
      const index = stateCursor++
      if (index >= states.length) states[index] = typeof initial === 'function' ? initial() : initial
      const setState = (value) => {
        if (!alive) { staleWrites += 1; return }
        const next = typeof value === 'function' ? value(states[index]) : value
        if (Object.is(next, states[index])) return
        states[index] = next
        if (rendering || runningEffects) dirty = true
        else render()
      }
      return [states[index], setState]
    },
    useEffect(create, deps) {
      const index = effectCursor++
      const previous = effects[index]
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
        || deps.some((value, i) => !Object.is(value, previous.deps[i]))
      if (changed) pendingEffects.push({ index, create, deps })
    },
  }

  return {
    render,
    rerender: render,
    text: () => textOf(output),
    staleWrites: () => staleWrites,
    unmount() {
      if (!alive) return
      for (const effect of effects) if (effect && typeof effect.cleanup === 'function') effect.cleanup()
      alive = false
      output = null
    },
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.nodeType = 1
    this.attributes = new Map()
    this.children = []
    this.parentElement = null
    this.listeners = new Map()
    this.textContent = ''
    this.clickCount = 0
    const styleValues = new Map()
    this.style = {
      getPropertyValue: (name) => styleValues.get(name) || '',
      setProperty: (name, value) => styleValues.set(name, String(value)),
    }
  }

  get isConnected() {
    return this.parentElement ? this.parentElement.isConnected : this.tagName === 'BODY' || this.tagName === 'HEAD'
  }

  get firstElementChild() { return this.children[0] || null }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }

  matches(selector) {
    if (selector === 'tr[data-trajectory-row-key]') {
      return this.tagName === 'TR' && this.attributes.has('data-trajectory-row-key')
    }
    if (selector === '[data-conversation-session]') return this.attributes.has('data-conversation-session')
    if (selector === 'button[data-request-run-index]') {
      return this.tagName === 'BUTTON' && this.attributes.has('data-request-run-index')
    }
    if (selector === '[data-er-trj]') return this.attributes.has('data-er-trj')
    return false
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }

  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]) }

  querySelector(selector) {
    if (selector === 'td:first-child') return this.children.find((child) => child.tagName === 'TD') || null
    if (selector === 'td:last-child') return [...this.children].reverse().find((child) => child.tagName === 'TD') || null
    return this.descendants().find((node) => node.matches(selector)) || null
  }

  querySelectorAll(selector) { return this.descendants().filter((node) => node.matches(selector)) }

  appendChild(child) {
    if (child.parentElement) child.remove()
    child.parentElement = this
    this.children.push(child)
    return child
  }

  insertAdjacentElement(position, child) {
    assert.equal(position, 'afterbegin')
    if (child.parentElement) child.remove()
    child.parentElement = this
    this.children.unshift(child)
    return child
  }

  remove() {
    if (!this.parentElement) return
    const siblings = this.parentElement.children
    const index = siblings.indexOf(this)
    if (index >= 0) siblings.splice(index, 1)
    this.parentElement = null
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    event.target = event.target || this
    event.stopPropagation = event.stopPropagation || (() => { event.propagationStopped = true })
    event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true })
    for (const listener of this.listeners.get(event.type) || []) listener(event)
    return !event.defaultPrevented
  }

  click() {
    this.clickCount += 1
    this.dispatchEvent({ type: 'click' })
  }
}

function addTrajectoryRoot(body, sessionId) {
  const root = new FakeElement('div')
  if (sessionId !== null) root.setAttribute('data-conversation-session', sessionId)
  const row = new FakeElement('tr')
  row.setAttribute('data-kind', 'message')
  row.setAttribute('data-trajectory-row-key', encodeURIComponent(ANCHOR_ID))
  const eventCell = new FakeElement('td')
  const contentCell = new FakeElement('td')
  const dot = new FakeElement('button')
  dot.setAttribute('data-request-run-index', '0')
  dot.setAttribute('data-label', 'Request #1')
  eventCell.appendChild(dot)
  contentCell.appendChild(new FakeElement('span'))
  row.appendChild(eventCell)
  row.appendChild(contentCell)
  root.appendChild(row)
  body.appendChild(root)
  return {
    root, row, dot, eventCell,
    caption: () => eventCell.children.find((child) => child.getAttribute('data-er-trj') !== null) || null,
  }
}

function trajectoryWorld(sessionId = SESSION_A) {
  const body = new FakeElement('body')
  const document = {
    body,
    visibilityState: 'visible',
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  return {
    document,
    body,
    ...addTrajectoryRoot(body, sessionId),
    addRoot: (id) => addTrajectoryRoot(body, id),
  }
}

function domText(node) {
  if (!node) return ''
  return String(node.textContent || '') + node.children.map(domText).join('')
}

function anchorsPayload(effort = 'high') {
  return {
    ok: true,
    trajectoryAnnotate: true,
    anchors: { [ANCHOR_ID]: { provider: 'provider', model: 'model', effort } },
  }
}

function setupTrajectory(t, sessionOrWorld = SESSION_A) {
  const world = typeof sessionOrWorld === 'string' ? trajectoryWorld(sessionOrWorld) : sessionOrWorld
  const { fetch, requests } = deferredFetch()
  const timers = fakeTimers()
  const frames = fakeFrames()
  const observers = []
  class TestMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options }
    disconnect() { this.disconnected = true }
  }
  const mutate = (records) => {
    for (const observer of observers) {
      const owned = records.filter((record) => {
        if (observer.target === record.target) return true
        if (!observer.options || !observer.options.subtree) return false
        for (let node = record.target; node; node = node.parentElement) {
          if (node === observer.target) return true
        }
        return false
      })
      if (owned.length > 0) observer.callback(owned)
    }
  }
  installGlobals(t, {
    document: world.document,
    location: { href: 'http://localhost/' + (typeof sessionOrWorld === 'string' ? sessionOrWorld : SESSION_A) },
    localStorage: { getItem: () => null },
    fetch,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    MutationObserver: TestMutationObserver,
  })
  return { ...world, requests, frames, observers, mutate }
}

test('Badge unmount aborts its in-flight request and ignores a late response', { concurrency: false }, async (t) => {
  const { fetch, requests } = deferredFetch()
  const timers = fakeTimers()
  installGlobals(t, { fetch, document: { visibilityState: 'visible' }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  const runtime = createHookRuntime(Badge)
  t.after(() => runtime.unmount())
  runtime.render({ sessionId: SESSION_A, t: (key) => key })
  assert.equal(requests.length, 1)
  runtime.unmount()
  requests[0].respond(badgePayload('high'))
  await flushPromises()
  assert.equal(runtime.staleWrites(), 0, 'late response must not write state after cleanup')
  assert.equal(requests[0].signal && requests[0].signal.aborted, true, 'cleanup must abort the fetch')
})

test('Badge session change aborts the old request and old data cannot repaint the new session', { concurrency: false }, async (t) => {
  const { fetch, requests } = deferredFetch()
  const timers = fakeTimers()
  installGlobals(t, { fetch, document: { visibilityState: 'visible' }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  const runtime = createHookRuntime(Badge)
  t.after(() => runtime.unmount())
  const props = { t: (key) => key }
  runtime.render({ ...props, sessionId: SESSION_A })
  runtime.rerender({ ...props, sessionId: SESSION_B })
  assert.equal(requests.length, 2)
  requests[0].respond(badgePayload('high'))
  await flushPromises()
  assert.doesNotMatch(runtime.text(), /high/, 'old session response must not repaint')
  requests[1].respond(badgePayload('low'))
  await flushPromises()
  assert.match(runtime.text(), /low/)
  assert.equal(requests[0].signal && requests[0].signal.aborted, true, 'session change must abort the old fetch')
})

test('client apply cleanup aborts config loading and stale config cannot register chat captions', { concurrency: false }, async (t) => {
  const { fetch, requests } = deferredFetch()
  installGlobals(t, { fetch })
  const cleanups = []
  let injections = 0
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    slots: { inject: (_name, register) => register(), register: () => () => {} },
    effect(create) { const cleanup = create(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject(_services, callback) { injections += 1; callback({}) },
  }
  applyClient(ctx)
  assert.equal(requests.length, 1)
  for (const cleanup of cleanups.reverse()) cleanup()
  requests[0].respond({ chatAnnotate: true })
  await flushPromises()
  assert.equal(injections, 0, 'late config must not register UI after disposal')
  assert.equal(requests[0].signal && requests[0].signal.aborted, true, 'config cleanup must abort the fetch')
})

function installStyleWorld(t) {
  const head = new FakeElement('head')
  const document = {
    head,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => head.descendants().find((node) => node.id === id) || null,
  }
  const { fetch, requests } = deferredFetch()
  installGlobals(t, { document, fetch })
  const style = () => head.descendants().find((node) => node.id === 'effort-router-styles') || null
  const applyNext = async () => {
    const cleanups = []
    const ctx = {
      locale: { bind: () => (key) => key, register: () => () => {} },
      slots: { inject: (_name, register) => register(), register: () => () => {} },
      effect(create) { const cleanup = create(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      inject() { throw new Error('chatAnnotate=false must not inject') },
    }
    applyClient(ctx)
    requests.at(-1).respond({ chatAnnotate: false })
    await flushPromises()
    return { cleanups }
  }
  const dispose = (generation) => {
    for (const cleanup of [...generation.cleanups].reverse()) cleanup()
  }
  return { head, style, applyNext, dispose }
}

test('client HMR keeps refreshed CSS when the old generation disposes first', { concurrency: false }, async (t) => {
  const world = installStyleWorld(t)
  const first = await world.applyNext()
  const style = world.style()
  assert.ok(style, 'first apply should install its style node')
  style.textContent = 'stale-hmr-css'
  const second = await world.applyNext()
  assert.equal(style.textContent, CSS, 're-apply must replace stale CSS')

  world.dispose(first)
  world.dispose(first)
  assert.ok(world.head.children.includes(style), 'old and repeated cleanup must not remove the live generation style')
  world.dispose(second)
  world.dispose(second)
  assert.equal(world.style(), null, 'the last live generation cleanup must release the style node')
})

test('client HMR style ownership survives three generations and repeated disposal', { concurrency: false }, async (t) => {
  const world = installStyleWorld(t)
  const first = await world.applyNext()
  const second = await world.applyNext()
  const style = world.style()
  style.textContent = 'stale-third-generation-css'
  const third = await world.applyNext()
  assert.equal(style.textContent, CSS)

  world.dispose(first)
  world.dispose(second)
  world.dispose(second)
  assert.ok(world.head.children.includes(style), 'middle/old cleanup must not remove the third generation style')
  world.dispose(third)
  world.dispose(third)
  assert.equal(world.style(), null, 'last generation cleanup must be idempotent and remove the style')
})

test('trajectory cleanup aborts polling and a late anchor table cannot paint', { concurrency: false }, async (t) => {
  const world = setupTrajectory(t)
  const stop = startTrajectoryDecorator()
  t.after(stop)
  assert.equal(world.requests.length, 1)
  stop()
  world.requests[0].respond(anchorsPayload())
  await flushPromises()
  world.frames.flush()
  assert.equal(world.caption(), null, 'late response must not paint after cleanup')
  assert.equal(world.requests[0].signal && world.requests[0].signal.aborted, true, 'cleanup must abort polling')
})

test('trajectory session change aborts old polling and stale anchors cannot paint', { concurrency: false }, async (t) => {
  const world = setupTrajectory(t)
  const stop = startTrajectoryDecorator()
  t.after(stop)
  assert.equal(world.requests.length, 1)
  world.root.setAttribute('data-conversation-session', SESSION_B)
  world.mutate([{
    type: 'attributes', target: world.root, attributeName: 'data-conversation-session',
    addedNodes: [], removedNodes: [],
  }])
  world.requests[0].respond(anchorsPayload())
  await flushPromises()
  world.frames.flush()
  assert.equal(world.caption(), null, 'old session anchors must not paint after the session switch')
  assert.equal(world.requests[0].signal && world.requests[0].signal.aborted, true, 'session change must abort old polling')
})

test('trajectory isolates side-by-side roots, session switches, removal, and unknown ownership', { concurrency: false }, async (t) => {
  const base = trajectoryWorld(SESSION_A)
  const second = base.addRoot(SESSION_B)
  const unknown = base.addRoot(null)
  const world = setupTrajectory(t, base)
  const stop = startTrajectoryDecorator()
  t.after(stop)

  const requestsFor = (sessionId) => world.requests.filter((request) =>
    new URL(request.url, 'http://localhost').searchParams.get('sessionId') === sessionId)
  assert.equal(requestsFor(SESSION_A).length, 1, 'first root must request its own anchors')
  assert.equal(requestsFor(SESSION_B).length, 1, 'second root must not be shed in favor of the first document row')
  assert.equal(world.requests.length, 2, 'an ownerless root must not invent a third session request')

  requestsFor(SESSION_A)[0].respond(anchorsPayload('high'))
  requestsFor(SESSION_B)[0].respond(anchorsPayload('low'))
  await flushPromises()
  world.frames.flush()
  assert.match(domText(world.caption()), /high/, 'A must render A effort')
  assert.match(domText(second.caption()), /low/, 'B must render B effort')
  assert.equal(unknown.caption(), null, 'unknown ownership must remain unlabelled when other roots are present')

  const bRequest = requestsFor(SESSION_B)[0]
  world.root.setAttribute('data-conversation-session', SESSION_C)
  world.mutate([{
    type: 'attributes', target: world.root, attributeName: 'data-conversation-session',
    addedNodes: [], removedNodes: [],
  }])
  assert.equal(requestsFor(SESSION_C).length, 1, 'A session change must start only A replacement polling')
  assert.equal(requestsFor(SESSION_B).length, 1, 'A session change must not restart B')
  assert.equal(bRequest.signal.aborted, false, 'A session change must not abort B')
  requestsFor(SESSION_C)[0].respond(anchorsPayload('medium'))
  await flushPromises()
  world.frames.flush()
  assert.match(domText(world.caption()), /medium/)
  assert.match(domText(second.caption()), /low/, 'A session change must not repaint B')
  assert.equal(unknown.caption(), null)

  world.root.remove()
  world.mutate([{ type: 'childList', target: world.body, addedNodes: [], removedNodes: [world.root] }])
  await flushPromises()
  world.frames.flush()
  assert.equal(bRequest.signal.aborted, false, 'removing A must not abort B')
  assert.match(domText(second.caption()), /low/, 'removing A must not remove or repaint B')
  assert.equal(unknown.caption(), null)
})

test('trajectory boundary chip click forwards to the native request dot', { concurrency: false }, async (t) => {
  const world = setupTrajectory(t)
  const stop = startTrajectoryDecorator()
  t.after(stop)
  world.requests[0].respond(anchorsPayload())
  await flushPromises()
  world.frames.flush()
  const caption = world.caption()
  assert.ok(caption, 'anchor response should paint a real chip')
  caption.dispatchEvent({ type: 'click' })
  assert.equal(world.dot.clickCount, 1)
})

test('trajectory boundary chip keyboard activation follows native button semantics', { concurrency: false }, async (t) => {
  const world = setupTrajectory(t)
  const stop = startTrajectoryDecorator()
  t.after(stop)
  world.requests[0].respond(anchorsPayload())
  await flushPromises()
  world.frames.flush()
  const caption = world.caption()
  assert.ok(caption, 'anchor response should paint a real chip')
  const nativeButton = caption.tagName === 'BUTTON'
  const role = caption.getAttribute('role')
  const hasTabStop = nativeButton || caption.tabIndex === 0 || caption.getAttribute('tabindex') === '0'
  const dispatchKey = (event) => {
    caption.dispatchEvent(event)
    if (!nativeButton) return
    if (event.type === 'keydown' && event.key === ' ') event.preventDefault()
    if (!event.repeat && ((event.type === 'keydown' && event.key === 'Enter')
      || (event.type === 'keyup' && event.key === ' '))) caption.click()
  }

  caption.dispatchEvent({ type: 'click' })
  const enter = { type: 'keydown', key: 'Enter', repeat: false }
  dispatchKey(enter)
  const afterEnter = world.dot.clickCount
  dispatchKey({ type: 'keydown', key: 'Enter', repeat: true })
  const afterRepeatedEnter = world.dot.clickCount
  const spaceDown = { type: 'keydown', key: ' ', repeat: false }
  dispatchKey(spaceDown)
  const afterSpaceDown = world.dot.clickCount
  dispatchKey({ type: 'keydown', key: ' ', repeat: true })
  const afterRepeatedSpaceDown = world.dot.clickCount
  const spaceUp = { type: 'keyup', key: ' ', repeat: false }
  dispatchKey(spaceUp)
  const afterSpaceUp = world.dot.clickCount

  assert.deepEqual(
    {
      nativeSemantics: nativeButton || role === 'button',
      hasTabStop,
      afterEnter,
      afterRepeatedEnter,
      afterSpaceDown,
      afterRepeatedSpaceDown,
      afterSpaceUp,
      enterPrevented: enter.defaultPrevented === true,
      spaceDownPrevented: spaceDown.defaultPrevented === true,
      focusVisible: CSS.includes('.er-trj-boundary:focus-visible'),
    },
    {
      nativeSemantics: true,
      hasTabStop: true,
      afterEnter: 2,
      afterRepeatedEnter: 2,
      afterSpaceDown: 2,
      afterRepeatedSpaceDown: 2,
      afterSpaceUp: 3,
      enterPrevented: true,
      spaceDownPrevented: true,
      focusVisible: true,
    },
    'Enter activates on keydown; Space prevents scrolling on keydown and activates once on keyup; repeats are inert',
  )
})
