import type {
  OrchestraBoard,
  OrchestraIssue,
  OrchestraJob,
  OrchestraReport,
  OrchestraShown,
  OrchestraTone,
  OrchestraWorker,
} from '../types'

// The preview's fixtures: each scenario is one state of orchestra's UI, drawn
// from made-up values instead of the repo's files. /orchestra-preview shows
// one at a time: the board pane and the band above the prompt draw it, and
// the gallery pane draws it whole, the rows orchestra's tools leave in the
// transcript included. Add a scenario here for each state a change to ui.tsx
// should be looked at in.

export type Scenario = {
  name: string
  /** What it shows, in one line. */
  about: string
  /** What the board pane draws; absent in a worker's session, which has none. */
  board?: OrchestraBoard | null
  /** A worker session's own band, drawn in place of the orchestrator's. */
  worker?: OrchestraWorker
  /** The rows orchestra's tools draw in the transcript. */
  shown?: OrchestraShown[]
}

// ── Building blocks ─────────────────────────────────────────────────────

function scratch(feature: string, slug: string, title: string, tone: OrchestraTone, reason: string): OrchestraIssue {
  const path = `.scratch/${feature}/issues/${slug}.md`

  return { path, feature, slug, title, tone, reason, url: `file:///Users/you/app/${path}` }
}

function job(issue: OrchestraIssue, id: string, given: Partial<OrchestraJob>): OrchestraJob {
  return {
    id,
    issue: issue.path,
    slug: issue.slug,
    title: issue.title,
    ...(issue.url === undefined ? {} : { url: issue.url }),
    tab: 'tab-7',
    minutes: 0,
    phase: 'finished',
    isMine: true,
    ...given,
  }
}

function report(given: Partial<OrchestraReport> & Pick<OrchestraReport, 'slug' | 'outcome'>): OrchestraShown {
  return {
    kind: 'report',
    report: { job: `${given.slug}-m1x9`, minutes: 12, summary: '', commits: [], issue: '', dirty: [], ...given },
  }
}

const HELD_FAILED = "its last worker ended failed and the issue hasn't changed since (job login-04-m1k2)"

const LOGIN = {
  schema: scratch('login', '01-session-schema', 'Session schema', 'done', 'done'),
  form: scratch('login', '02-login-form', 'Login form', 'ready', 'can start'),
  reset: scratch('login', '03-password-reset', 'Password reset by email', 'waiting', 'waits on 02'),
  remember: { ...scratch('login', '04-remember-me', 'Remember me', 'held', HELD_FAILED), heldBy: 'login-04-m1k2' },
}

const BILLING = {
  customer: scratch('billing', '01-stripe-customer', 'Stripe customer per account', 'waiting', 'status is needs-info'),
  invoices: scratch('billing', '02-invoice-list', 'Invoice list', 'waiting', 'waits on 01'),
}

const RECENT: OrchestraJob[] = [
  job(LOGIN.remember, 'login-04-m1k2', { minutes: 18, outcome: 'failed' }),
  job(LOGIN.schema, 'login-01-m1h7', { minutes: 9, outcome: 'done' }),
  job(BILLING.customer, 'billing-01-m1f3', { minutes: 6, outcome: 'blocked' }),
]

const RUNNING_FORM = job(LOGIN.form, 'login-02-m1x9', {
  phase: 'running',
  minutes: 6,
  activity: 'Edit routes/login.tsx',
  activityAgo: 8,
  tools: 41,
})

const BOARD: OrchestraBoard = {
  tracker: 'local',
  issues: [...Object.values(LOGIN), ...Object.values(BILLING)],
  recent: RECENT,
  next: LOGIN.form.path,
}

const ONBOARDING = {
  welcome: scratch('onboarding', '01-welcome-mail', 'Welcome mail', 'done', 'done'),
  tour: scratch('onboarding', '02-product-tour', 'Product tour', 'done', 'done'),
}

/** Every issue the way `change` turns it. */
function each(issues: readonly OrchestraIssue[], change: (one: OrchestraIssue) => Partial<OrchestraIssue>): OrchestraIssue[] {
  return issues.map(one => ({ ...one, ...change(one) }))
}

/** The board while a worker runs the login form: nothing else can start. */
function runningBoard(running: OrchestraJob): OrchestraBoard {
  const form = { ...LOGIN.form, tone: 'running' as const, reason: `a worker runs it (job ${running.id})` }

  return { ...BOARD, issues: BOARD.issues.map(one => (one.path === form.path ? form : one)), running, next: undefined }
}

// ── The scenarios ───────────────────────────────────────────────────────

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'board',
    about: 'Two .scratch features, nothing running: done, next, waiting and held issues, the last jobs',
    board: BOARD,
    shown: [{ kind: 'issues', issues: BOARD.issues }],
  },
  {
    name: 'running',
    about: 'A worker runs the login form: the running card, the band, the line under a running wait',
    board: runningBoard(RUNNING_FORM),
  },
  {
    name: 'starting',
    about: 'Just dispatched: no worker session has written its file yet',
    board: runningBoard({ ...RUNNING_FORM, phase: 'starting', minutes: 1, activity: undefined, tools: undefined }),
    shown: [{ kind: 'started', job: RUNNING_FORM.id, slug: LOGIN.form.slug, title: LOGIN.form.title, path: LOGIN.form.path }],
  },
  {
    name: 'finish',
    about: 'Two issues just finished, one the last of its lane: lines fill, stops sparkle, confetti, Clawd cheers (every 6s)',
    board: {
      ...BOARD,
      issues: [
        LOGIN.schema,
        { ...LOGIN.form, tone: 'done', reason: 'done', doneAt: 0 },
        { ...LOGIN.reset, tone: 'ready', reason: 'can start' },
        LOGIN.remember,
        ONBOARDING.welcome,
        { ...ONBOARDING.tour, doneAt: 0 },
        ...Object.values(BILLING),
      ],
      recent: [{ ...RUNNING_FORM, phase: 'finished', minutes: 14, outcome: 'done' }, ...RECENT.slice(0, 2)],
      next: LOGIN.reset.path,
    },
  },
  {
    name: 'stuck',
    about: 'Nothing can start and an issue is held: Clawd waves for help',
    board: {
      ...BOARD,
      issues: [
        LOGIN.schema,
        { ...LOGIN.form, tone: 'waiting', reason: 'status is needs-info' },
        LOGIN.reset,
        LOGIN.remember,
        ...Object.values(BILLING),
      ],
      next: undefined,
    },
  },
  {
    name: 'asleep',
    about: 'Every issue waits on another or on triage: Clawd sleeps',
    board: {
      ...BOARD,
      issues: each(Object.values(BILLING), () => ({})),
      recent: [],
      next: undefined,
    },
  },
  {
    name: 'party',
    about: 'Every issue is done: each lane folds to its track, Clawd dances',
    board: {
      ...BOARD,
      issues: each([...Object.values(LOGIN), ...Object.values(ONBOARDING), ...Object.values(BILLING)], one => ({
        tone: 'done',
        reason: 'done',
        heldBy: undefined,
        ...(one === BILLING.invoices ? { doneAt: 0 } : {}),
      })),
      next: undefined,
    },
  },
  {
    name: 'reports',
    about: "The report cards a wait draws: done, blocked, failed with a dirty tree, late, and a wait that timed out",
    board: {
      ...BOARD,
      issues: BOARD.issues.map(one =>
        one === LOGIN.form
          ? { ...one, tone: 'done', reason: 'done' }
          : one === LOGIN.reset
            ? { ...one, tone: 'ready', reason: 'can start' }
            : one,
      ),
      recent: [{ ...RUNNING_FORM, phase: 'finished', minutes: 14, outcome: 'done' }, ...RECENT.slice(0, 2)],
      next: LOGIN.reset.path,
    },
    shown: [
      report({
        slug: '02-login-form',
        outcome: 'done',
        minutes: 14,
        summary:
          'Built the login form.\n\n- Posts to `/login`\n- A wrong password shows an error under the field\n\n**Check:** the rate limit on wrong passwords.',
        commits: ['a1b2c3d Add the login form', 'e4f5a6b Show a wrong password under the field'],
        issue: 'status done, 2/2 boxes ticked, done',
        next: 'login/03-password-reset',
      }),
      report({
        slug: '01-stripe-customer',
        outcome: 'blocked',
        minutes: 6,
        summary: 'Which Stripe account do test customers go to? The question is under `## Comments` in the issue.',
        issue: 'status needs-info, 0/3 boxes ticked, not done',
      }),
      report({
        slug: '04-remember-me',
        outcome: 'failed',
        minutes: 18,
        summary: 'The cookie tests fail on a clock the test runner fakes; I could not repair it.',
        commits: ['c7d8e9f Add the remember-me cookie'],
        issue: 'status ready-for-human, 1/3 boxes ticked, not done',
        dirty: [' M src/auth/cookie.ts', '?? src/auth/cookie.test.ts'],
      }),
      report({
        slug: '03-password-reset',
        outcome: 'done',
        lateFrom: 'stalled',
        minutes: 31,
        summary: 'Sends the reset link by email.',
        commits: ['0a1b2c3 Send the password reset link'],
        issue: 'status done, 3/3 boxes ticked, done',
      }),
      { kind: 'running', slug: '03-password-reset', minutes: 10 },
    ],
  },
  {
    name: 'github',
    about: 'GitHub issues: a parent issue as the feature, tickets as #numbers, issues without a parent',
    board: {
      tracker: 'github',
      issues: [
        { path: '#41', url: 'https://github.com/acme/app/issues/41', feature: '#12', featureTitle: 'Spec: sign in with a passkey', slug: '#41', title: 'Register a passkey', tone: 'done', reason: 'done' },
        { path: '#42', url: 'https://github.com/acme/app/issues/42', feature: '#12', featureTitle: 'Spec: sign in with a passkey', slug: '#42', title: 'Sign in with the passkey', tone: 'ready', reason: 'can start' },
        { path: '#43', url: 'https://github.com/acme/app/issues/43', feature: '#12', featureTitle: 'Spec: sign in with a passkey', slug: '#43', title: 'Remove a passkey', tone: 'waiting', reason: 'waits on #42' },
        { path: '#57', url: 'https://github.com/acme/app/issues/57', feature: '', slug: '#57', title: 'Typo on the settings page', tone: 'waiting', reason: 'status is needs-info' },
      ],
      recent: [job({ path: '#41', url: 'https://github.com/acme/app/issues/41', feature: '#12', slug: '#41', title: 'Register a passkey', tone: 'done', reason: 'done' }, '12-41-m2a1', { minutes: 22, outcome: 'done' })],
      next: '#42',
    },
  },
  {
    name: 'jira',
    about: 'Jira stories under an epic, one of them running',
    board: {
      tracker: 'jira',
      issues: [
        { path: 'CORE-130', url: 'https://acme.atlassian.net/browse/CORE-130', feature: 'CORE-123', featureTitle: 'Payout reconciliation', slug: 'CORE-130', title: 'Import the payout file', tone: 'done', reason: 'done' },
        { path: 'CORE-131', url: 'https://acme.atlassian.net/browse/CORE-131', feature: 'CORE-123', featureTitle: 'Payout reconciliation', slug: 'CORE-131', title: 'Match payouts to bookings', tone: 'running', reason: 'a worker runs it (job CORE-123-131-m2c4)' },
        { path: 'CORE-132', url: 'https://acme.atlassian.net/browse/CORE-132', feature: 'CORE-123', featureTitle: 'Payout reconciliation', slug: 'CORE-132', title: 'Report the unmatched', tone: 'waiting', reason: 'waits on CORE-131' },
      ],
      running: {
        id: 'CORE-123-131-m2c4',
        issue: 'CORE-131',
        slug: 'CORE-131',
        url: 'https://acme.atlassian.net/browse/CORE-131',
        title: 'Match payouts to bookings',
        tab: 'tab-3',
        minutes: 24,
        phase: 'running',
        activity: 'agent: Bash Run the reconciliation tests',
        activityAgo: 95,
        tools: 212,
        isMine: true,
      },
      recent: [],
    },
  },
  {
    name: 'long',
    about: 'Long slugs, titles and activity: what truncates first at a narrow width',
    board: {
      ...runningBoard({
        ...RUNNING_FORM,
        slug: '07-migrate-every-legacy-session-token-to-the-new-store',
        title: 'Migrate every legacy session token to the new store without logging anyone out mid-request',
        activity: 'agent: Bash Run the integration tests against the staging database with the replay fixtures',
        activityAgo: 3,
        tools: 1284,
        minutes: 127,
      }),
      issues: [
        ...BOARD.issues,
        scratch(
          'a-feature-with-a-rather-long-folder-name',
          '12-an-issue-whose-slug-is-longer-than-the-column',
          'An issue whose title goes on and on past any width the pane could have',
          'waiting',
          'waits on 03, 04, 05, 06, 07, 08, 09, 10, 11',
        ),
      ],
      recent: [
        ...RECENT,
        { ...RECENT[1]!, id: 'x-1', slug: '05-an-older-job-with-a-long-slug', outcome: 'never-started' },
        { ...RECENT[0]!, id: 'x-2', outcome: 'stalled', lateOutcome: 'done' },
      ],
    },
  },
  {
    name: 'worker',
    about: "A worker session's own band while it works",
    worker: { job: 'login-02-m1x9' },
  },
  {
    name: 'worker-done',
    about: "A worker session's band once it reported done",
    worker: { job: 'login-02-m1x9', ended: 'done' },
  },
  {
    name: 'worker-stalled',
    about: "A worker session's band once it stopped without a report",
    worker: { job: 'login-02-m1x9', ended: 'stalled' },
  },
  { name: 'loading', about: 'Before the first read of the issues', board: null },
  {
    name: 'problem',
    about: "The issues couldn't be read",
    board: {
      issues: [],
      recent: [],
      problem: "gh couldn't read the GitHub issues: error connecting to api.github.com",
    },
  },
  { name: 'empty', about: 'The tracker has no issue for orchestra', board: { tracker: 'github', issues: [], recent: [] } },
]

/** The scenario named `name`, by its whole name or the start of it. */
export function scenarioNamed(name: string): Scenario | undefined {
  return SCENARIOS.find(one => one.name === name) ?? SCENARIOS.find(one => one.name.startsWith(name))
}
