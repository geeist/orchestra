// The local issue tracker, read: `.scratch/<feature>/issues/NN-slug.md`, each
// with a Status line, a Blocked by line and checkboxes (the repo's
// docs/agents/issue-tracker.md). Also the plan every tracker shares: which
// issue can start, and which one a reference names. Pure, so the tests cover
// it whole.

export type Issue = {
  /**
   * What names the issue for good: relative to the repo root
   * (`.scratch/<feature>/issues/03-ui-shell.md`), `#42` on GitHub, or the
   * Jira story's key (`CORE-42`).
   */
  path: string
  /** The .scratch folder, the parent issue on GitHub (`#12`), or the Jira epic (`CORE-12`); "" for none. */
  feature: string
  /** The parent issue's or the epic's title, on GitHub and Jira. */
  featureTitle?: string
  /** The file name's leading number, two digits at least (`03`), or the GitHub issue's or Jira key's (`42`). */
  number: string
  /** The file name without `.md` (`03-ui-shell`), `#42` on GitHub, `CORE-42` in Jira. */
  slug: string
  /** How the tools name it to the model: `local-stack/03-ui-shell`, `#42` or `CORE-42`. */
  ref: string
  title: string
  /** The Status line's first word, lower-cased, or the triage label's role on GitHub and Jira; "" when there is none. */
  status: string
  /**
   * The numbers on the Blocked by line, spelled like `number`. On GitHub and
   * Jira only the blockers not done yet, as `#41` or `CORE-41`: each one keeps
   * the issue waiting.
   */
  blockedBy: string[]
  openBoxes: number
  doneBoxes: number
  /** A done status, or every checkbox ticked (how 01 and 02 were closed); closed on GitHub, in the Done category in Jira. */
  isDone: boolean
}

export type Candidate = Issue & { canStart: boolean; reason: string }

export const READY = 'ready-for-agent'

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'wontfix'])

export function parseIssue(path: string, text: string): Issue {
  const parts = path.split('/')
  const slug = (parts.at(-1) ?? path).replace(/\.md$/, '')
  const status = (field(text, 'Status') ?? '').replace(/[`*_]/g, '').trim().split(/\s+/)[0] ?? ''
  const blocked = field(text, 'Blocked by') ?? ''
  const { openBoxes, doneBoxes } = boxes(text)
  const feature = parts.at(-3) ?? ''

  return {
    path,
    feature,
    number: normalize(slug.match(/^\d+/)?.[0] ?? slug),
    slug,
    ref: `${feature}/${slug}`,
    title: text.match(/^#\s+(.+?)\s*$/m)?.[1] ?? slug,
    status: status.toLowerCase(),
    blockedBy: /^\s*none\b/i.test(blocked) ? [] : (blocked.match(/\d+/g) ?? []).map(normalize),
    openBoxes,
    doneBoxes,
    isDone: DONE_STATUSES.has(status.toLowerCase()) || (doneBoxes > 0 && openBoxes === 0),
  }
}

/**
 * Every issue in order (feature, then number), each judged: it can start when
 * it is not done, not held, `ready-for-agent`, and every blocker is done.
 * `held` maps an issue's path to why the orchestrator keeps it back.
 */
export function plan(issues: readonly Issue[], held: ReadonlyMap<string, string> = new Map()): Candidate[] {
  const byNumber = new Map(issues.map(issue => [`${issue.feature}/${issue.number}`, issue]))

  const judge = (issue: Issue): { canStart: boolean; reason: string } => {
    if (issue.isDone) return { canStart: false, reason: 'done' }
    const hold = held.get(issue.path)
    if (hold !== undefined) return { canStart: false, reason: hold }
    if (issue.status !== READY) return { canStart: false, reason: `status is ${issue.status || 'missing'}` }
    const waits = issue.blockedBy.filter(n => byNumber.get(`${issue.feature}/${n}`)?.isDone !== true)
    if (waits.length > 0) return { canStart: false, reason: `waits on ${waits.join(', ')}` }
    return { canStart: true, reason: 'can start' }
  }

  return [...issues].sort(byOrder).map(issue => ({ ...issue, ...judge(issue) }))
}

/**
 * The issues `ref` names: a path, a slug (`03-ui-shell`), a number (`03`, `3`),
 * or either behind its feature (`local-stack/03`). On GitHub also `#42`, a
 * link to the issue, or `#12/42`; in Jira `CORE-42`, a link to it, or
 * `CORE-12/CORE-42`.
 */
export function findIssues<T extends Issue>(issues: readonly T[], ref: string): T[] {
  const want = ref
    .trim()
    .replace(/^\.\//, '')
    .replace(/^https?:\/\/\S+\/issues\/(\d+)\/?$/, '#$1')
    .replace(/^https?:\/\/\S+\/browse\/([a-z][\w]*-\d+)\/?$/i, '$1')
    .toLowerCase()
  const slash = want.lastIndexOf('/')
  const feature = slash > 0 && !want.endsWith('.md') ? want.slice(0, slash) : undefined
  const name = feature === undefined ? want : want.slice(slash + 1)

  return issues.filter(issue => {
    if (issue.path.toLowerCase() === want) return true
    if (feature !== undefined && !sameFeature(issue.feature, feature)) return false
    return issue.slug.toLowerCase() === name || (/^\d+$/.test(name) && normalize(issue.number) === normalize(name))
  })
}

/** Whether `name` names the feature: its folder, its parent issue with or without the `#`, or its epic. */
export function sameFeature(feature: string, name: string): boolean {
  return feature.replace(/^#/, '').toLowerCase() === name.replace(/^#/, '').toLowerCase()
}

/** The value of a `Name: value` line, its bold stars dropped. */
export function field(text: string, name: string): string | undefined {
  const line = new RegExp(String.raw`^[ \t]*\**[ \t]*${name}[ \t]*:[ \t]*\**[ \t]*(.*)$`, 'im')

  return text.match(line)?.[1]?.replace(/\**\s*$/, '')
}

/** The checkboxes in Markdown: open and ticked. */
export function boxes(text: string): { openBoxes: number; doneBoxes: number } {
  return { openBoxes: count(text, /^\s*[-*+]\s+\[ \]/gm), doneBoxes: count(text, /^\s*[-*+]\s+\[[xX]\]/gm) }
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function normalize(number: string): string {
  return /^\d+$/.test(number) ? String(Number(number)).padStart(2, '0') : number
}

/** By feature, the GitHub and Jira issues without one last, then by number. */
function byOrder(a: Issue, b: Issue): number {
  return (
    Number(a.feature === '') - Number(b.feature === '') ||
    a.feature.localeCompare(b.feature, undefined, { numeric: true }) ||
    a.number.localeCompare(b.number, undefined, { numeric: true })
  )
}
