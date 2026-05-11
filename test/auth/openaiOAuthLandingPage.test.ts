import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOAuthLandingPage } from '../../src/auth/openaiOAuth/landingPage.js'

test('renderOAuthLandingPage emits the wallet shell with no pills or footer', () => {
  const html = renderOAuthLandingPage({
    tone: 'success',
    pageTitle: 'OpenAI Sign-in Complete',
    headline: 'OpenAI sign-in complete',
    message: 'You can return to your terminal.',
  })

  assert.ok(html.includes('<canvas id="grainient"'), 'expected grainient canvas')
  assert.ok(html.includes('<span class="chrome-title">ethagent</span>'), 'expected ethagent chrome label')
  assert.ok(html.includes('<pre class="splash">'), 'expected splash pre')
  assert.ok(html.includes('class="flow-title"'), 'expected flow-title heading')
  assert.ok(html.includes('OpenAI sign-in complete'), 'expected headline text')
  assert.ok(html.includes('You can return to your terminal.'), 'expected message text')
  assert.ok(html.includes('You may close this tab now.'), 'expected static close hint')
  assert.ok(html.includes('startGrainient('), 'expected grainient bootstrap script')

  const body = html.slice(html.indexOf('<body>'))
  assert.equal(body.includes('class="net-pill"'), false, 'should not render net-pill element')
  assert.equal(body.includes('class="head"'), false, 'should not render head pill row')
  assert.equal(body.includes('class="footer"'), false, 'should not render footer')
  assert.equal(body.includes('class="oauth-stack"'), false, 'should not wrap title+status in oauth-stack')
  assert.equal(body.includes('signature request'), false, 'should not show signature pill copy')
  assert.ok(body.includes('class="splash-wrap"'), 'splash should be centred in splash-wrap')
})

test('renderOAuthLandingPage wraps the message in the wallet status panel with a check marker', () => {
  const html = renderOAuthLandingPage({
    tone: 'success',
    pageTitle: 'OpenAI Sign-in Complete',
    headline: 'OpenAI sign-in complete',
    message: 'You can return to your terminal.',
  })
  const body = html.slice(html.indexOf('<body>'))
  assert.ok(body.includes('<div class="status">'), 'expected the wallet status panel')
  assert.ok(body.includes('class="status-line"'), 'expected status-line inside the panel')
  assert.ok(body.includes('class="status-hint"'), 'expected status-hint inside the panel')
  assert.ok(body.includes('<span class="marker">'), 'expected marker chip in the status-line')
  assert.ok(body.includes('<polyline points="20 6 9 17 4 12">'), 'success marker should be the wallet check SVG')
})

test('renderOAuthLandingPage no longer attempts to auto-close the tab', () => {
  const html = renderOAuthLandingPage({
    tone: 'success',
    pageTitle: 'OpenAI Sign-in Complete',
    headline: 'OpenAI sign-in complete',
    message: 'You can return to your terminal.',
  })
  assert.equal(html.includes('setInterval('), false, 'no countdown ticker')
  assert.equal(html.includes('window.close()'), false, 'no programmatic close')
  assert.equal(html.includes('Closing in '), false, 'no countdown copy')
})

test('renderOAuthLandingPage escapes HTML in headline, message, and title', () => {
  const html = renderOAuthLandingPage({
    tone: 'error',
    pageTitle: '<X>',
    headline: '<bad>',
    message: '<script>alert(1)</script>',
  })

  assert.ok(html.includes('<title>&lt;X&gt;</title>'))
  assert.ok(html.includes('&lt;bad&gt;'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.equal(html.includes('<script>alert(1)</script>'), false, 'raw script payload must not appear')
})

test('renderOAuthLandingPage uses a different marker glyph per tone', () => {
  const errorHtml = renderOAuthLandingPage({
    tone: 'error',
    pageTitle: 'OpenAI Sign-in Failed',
    headline: 'OpenAI sign-in failed',
    message: 'something went wrong',
  })
  assert.ok(errorHtml.includes('data-tone="error"'))
  assert.ok(errorHtml.includes('<span aria-hidden="true">!</span>'), 'error marker should be !')

  const cancelledHtml = renderOAuthLandingPage({
    tone: 'cancelled',
    pageTitle: 'OpenAI Sign-in Cancelled',
    headline: 'OpenAI sign-in cancelled',
    message: 'You closed the tab.',
  })
  assert.ok(cancelledHtml.includes('data-tone="cancelled"'))
  assert.ok(cancelledHtml.includes('<span aria-hidden="true">–</span>'), 'cancelled marker should be –')
})
