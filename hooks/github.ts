// The GitHub issue tracker, read: the repo's GitHub issues as the issues the
// board plans, once docs/agents/issue-tracker.md (which
// /setup-matt-pocock-skills writes) says the repo tracks its work there.
//
// A ticket is an issue with a parent: a native sub-issue, or one whose
// `## Parent` section (or `Part of #12` line) names it. The parent is its
// feature, like a spec, and is never dispatched itself. An issue without a
// parent counts once triage moved it towards an agent: labelled
// ready-for-agent, needs-info or ready-for-human. Its status is its triage
// label, its blockers are its native dependencies and its `## Blocked by`
// section, and done means closed. Pure apart from the query, so the tests
// cover it whole.

import type { JiraScope } from './jira'
import { boxes, field } from './scratch'
import type { Issue } from './scratch'

/** The five triage roles of mattpocock-skills. */
export const ROLES = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'] as const
export type Role = (typeof ROLES)[number]

/** Each role's label in this repo (docs/agents/triage-labels.md): the role's own name unless mapped. */
export type Labels = Record<Role, string>

/** Where the repo's issues live. */
export type Tracker = { kind: 'local' } | { kind: 'github'; labels: Labels } | ({ kind: 'jira'; labels: Labels } & JiraScope)

/** A label that holds an issue back wins over ready-for-agent: a worker may add one and leave the other. */
const PRECEDENCE: readonly Role[] = ['wontfix', 'ready-for-human', 'needs-info', 'needs-triage', 'ready-for-agent']

/** The roles that put an issue without a parent on the board. */
export const ON_BOARD: readonly Role[] = ['ready-for-agent', 'needs-info', 'ready-for-human']

/** One issue as QUERY returns it. */
export type Node = {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  updatedAt: string
  labels: { nodes: { name: string }[] }
  parent: { number: number; title: string } | null
  subIssuesSummary: { total: number }
  blockedBy: { nodes: { number: number; state: 'OPEN' | 'CLOSED' }[] }
}

/** One page of QUERY's answer. */
export type Page = {
  data: {
    repository: {
      open: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] }
      closed?: { nodes: Node[] }
    }
  }
}

/**
 * The open issues a page of 100 at a time and, with `withClosed`, the 50
 * closed last: they show a feature's finished tickets. Run through
 * `gh api graphql`, which fills `{owner}` and `{repo}` from the clone.
 */
export const QUERY = `query($owner: String!, $repo: String!, $after: String, $withClosed: Boolean!) {
  repository(owner: $owner, name: $repo) {
    open: issues(states: OPEN, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ...ticket }
    }
    closed: issues(states: CLOSED, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $withClosed) {
      nodes { ...ticket }
    }
  }
}
fragment ticket on Issue {
  number title body state updatedAt
  labels(first: 20) { nodes { name } }
  parent { number title }
  subIssuesSummary { total }
  blockedBy(first: 20) { nodes { number state } }
}`

/** Whether docs/agents/issue-tracker.md says the issues live on GitHub: its heading names it. */
export function namesGithub(doc: string | undefined): boolean {
  return /\bGitHub\b/i.test(doc?.match(/^#\s+(.+)$/m)?.[1] ?? '')
}

/** The label of each role, from the table in docs/agents/triage-labels.md. */
export function triageLabels(doc: string | undefined): Labels {
  const labels = Object.fromEntries(ROLES.map(role => [role, role])) as Labels
  for (const [, role, label] of doc?.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm) ?? []) {
    const known = ROLES.find(one => one === role)
    if (known !== undefined && label !== undefined) labels[known] = label
  }

  return labels
}

/** The issues the board plans, and when each last changed (a hold ends once it does). */
export function githubIssues(
  nodes: readonly Node[],
  labels: Labels,
): { issues: Issue[]; changedAt: Map<string, number> } {
  // Bodies written on github.com end their lines with CRLF.
  const byNumber = new Map(nodes.map(node => [node.number, { ...node, body: node.body.replace(/\r\n?/g, '\n') }]))
  const parentOf = (node: Node) => node.parent?.number ?? parentRef(node.body)
  const parents = new Set(nodes.map(parentOf).filter(parent => parent !== undefined))
  const isOpen = (number: number) => byNumber.get(number)?.state === 'OPEN'

  const issues: Issue[] = []
  const changedAt = new Map<string, number>()
  for (const node of byNumber.values()) {
    if (parents.has(node.number) || node.subIssuesSummary.total > 0) continue
    const role = roleOf(node.labels.nodes.map(label => label.name), labels)
    const parent = parentOf(node)
    if (parent === undefined && !ON_BOARD.some(one => one === role)) continue

    const blockers = new Set([
      ...node.blockedBy.nodes.filter(one => one.state === 'OPEN').map(one => one.number),
      ...blockerRefs(node.body).filter(isOpen),
    ])
    const path = `#${node.number}`
    const featureTitle = parent === undefined ? undefined : (node.parent?.title ?? byNumber.get(parent)?.title)
    issues.push({
      path,
      feature: parent === undefined ? '' : `#${parent}`,
      ...(featureTitle === undefined ? {} : { featureTitle }),
      number: String(node.number),
      slug: path,
      ref: path,
      title: node.title,
      status: node.state === 'CLOSED' ? 'closed' : role,
      blockedBy: [...blockers].sort((a, b) => a - b).map(number => `#${number}`),
      ...boxes(node.body),
      isDone: node.state === 'CLOSED',
    })
    changedAt.set(path, Date.parse(node.updatedAt))
  }

  return { issues, changedAt }
}

/** The triage role an issue's labels give it, "" for none: the one that holds it back wins. */
export function roleOf(names: readonly string[], labels: Labels): Role | '' {
  const byLabel = new Map<string, Role>(ROLES.map(role => [labels[role].toLowerCase(), role]))
  const roles = new Set(names.map(name => byLabel.get(name.toLowerCase())))

  return PRECEDENCE.find(one => roles.has(one)) ?? ''
}

/** The parent a ticket's body names, where GitHub links none: `## Parent`, `Parent: #12` or `Part of #12`. */
function parentRef(body: string): number | undefined {
  const text = section(body, 'Parent') ?? field(body, 'Parent') ?? body.match(/^\W*Part of\b(.*)$/im)?.[1]

  return text === undefined ? undefined : refs(text)[0]
}

/** The blockers a ticket's body names: its `## Blocked by` section, or a `Blocked by:` line. */
function blockerRefs(body: string): number[] {
  return refs(section(body, 'Blocked by') ?? field(body, 'Blocked by') ?? '')
}

/** The issue numbers `text` points to: `#12`, or a link to `/issues/12`. */
function refs(text: string): number[] {
  return [...text.matchAll(/(?:#|\/issues\/)(\d+)/g)].map(match => Number(match[1]))
}

/** The text under a `## name` heading, up to the next heading. */
export function section(text: string, name: string): string | undefined {
  const heading = text.match(new RegExp(String.raw`^#{1,6}[ \t]+${name}[ \t#]*$`, 'im'))
  if (heading?.index === undefined) return undefined
  const rest = text.slice(heading.index + heading[0].length)
  const end = rest.search(/^#{1,6}[ \t]/m)

  return end === -1 ? rest : rest.slice(0, end)
}
