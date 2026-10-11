// The Jira issue tracker, read: a Jira project's stories as the issues the
// board plans, once docs/agents/issue-tracker.md says the repo tracks its
// work in Jira. orchestra searches them through the session's Atlassian MCP
// server, so its sign-in is the only one needed.
//
// An epic is a feature, like a parent issue on GitHub, and is never
// dispatched itself: its stories are its tickets. The file names the site,
// the project and, if it likes, epics. With epics, every story of theirs
// counts, labelled or not: a Jira project is shared, and the epics keep
// orchestra to this repo's work. Without, every story in the project that
// triage labelled ready-for-agent, needs-info or ready-for-human counts,
// under its epic if it has one. A story's status is its triage label, its
// blockers are its "is blocked by" links and its `## Blocked by` section,
// and done means its status is in Jira's Done category. Pure apart from the
// search, so the tests cover it whole.

import { ON_BOARD, roleOf, section } from './github'
import type { Labels } from './github'
import { boxes, field } from './scratch'
import type { Issue } from './scratch'

/** Which stories orchestra reads, and through which server. */
export type JiraScope = {
  /** The site (`example.atlassian.net`), which the Atlassian MCP tools take as their cloudId. */
  site: string
  /** The project's key (`CORE`). */
  project: string
  /** The epics whose stories count (`CORE-12`); none for the project's labelled stories. */
  epics: string[]
  /** The Atlassian MCP server's name, as `$.mcp.call` takes it. */
  server: string
}

/** A node of Atlassian Document Format, the rich text a description is written in. */
export type Adf = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Adf[] }

type Category = { statusCategory?: { key?: string } }

/** One issue as the search returns it: Jira's own JSON, the FIELDS of it. */
export type JiraNode = {
  key: string
  fields: {
    summary: string
    description?: string | Adf | null
    status?: Category
    labels?: string[]
    issuetype?: { name?: string; subtask?: boolean; hierarchyLevel?: number }
    parent?: { key: string; fields?: { summary?: string } }
    issuelinks?: {
      type?: { name?: string; inward?: string }
      inwardIssue?: { key: string; fields?: { status?: Category } }
    }[]
    updated?: string
  }
}

/** One page of the search's answer. */
export type JiraPage = { issues: JiraNode[]; nextPageToken?: string; isLast?: boolean }

/** The Atlassian MCP tool orchestra searches with; every version of the server has it. */
export const SEARCH_TOOL = 'searchJiraIssuesUsingJql'

export const FIELDS = ['summary', 'description', 'status', 'labels', 'issuetype', 'parent', 'issuelinks', 'updated']

/** How long a labelled story stays on the board once done, so a feature's finished stories show. */
const DONE_DAYS = 30

/** An issue key: `CORE-12`. */
const KEY = /\b[A-Z][A-Z0-9_]+-\d+\b/g

/** Whether docs/agents/issue-tracker.md says the issues live in Jira: its heading names it. */
export function namesJira(doc: string | undefined): boolean {
  return /\bJira\b/i.test(doc?.match(/^#\s+(.+)$/m)?.[1] ?? '')
}

/**
 * What docs/agents/issue-tracker.md names in its `Site:`, `Project:`,
 * `Epic:` and `MCP server:` lines. A link to the site stands in for the
 * Site line, and the first epic's project for the Project line. Throws when
 * the site or the project is missing.
 */
export function jiraScope(doc: string): Omit<JiraScope, 'server'> & { server?: string } {
  const value = (name: string) => field(doc, name)?.replace(/[`*]/g, '').trim() || undefined
  const named = value('Site')
  const site = named?.replace(/^https?:\/\//, '').split('/')[0] ?? doc.match(/[\w-]+\.atlassian\.net/i)?.[0]
  const epics = keys((value('Epics') ?? value('Epic') ?? '').toUpperCase())
  const project = value('Project')?.toUpperCase().match(/\b[A-Z][A-Z0-9_]+\b/)?.[0] ?? epics[0]?.replace(/-\d+$/, '')
  const server = value('MCP server')
  if (site === undefined || site === '') {
    throw new Error('docs/agents/issue-tracker.md says Jira, but names no site: add a line "Site: <yours>.atlassian.net"')
  }
  if (project === undefined) {
    throw new Error('docs/agents/issue-tracker.md says Jira, but names no project: add a line "Project: <KEY>"')
  }

  return { site, project, epics, ...(server === undefined ? {} : { server }) }
}

/** The Atlassian MCP server among the session's tools: the one whose tools search Jira. */
export function atlassianServer(tools: readonly string[]): string | undefined {
  for (const name of tools) {
    const server = name.match(new RegExp(String.raw`^mcp__(.+)__${SEARCH_TOOL}$`))?.[1]
    if (server !== undefined) return server
  }

  return undefined
}

/** The search: the epics' stories, or else the project's stories labelled for an agent and not done for long. */
export function jql(scope: Pick<JiraScope, 'project' | 'epics'>, labels: Labels): string {
  if (scope.epics.length > 0) return `parent in (${scope.epics.join(', ')}) ORDER BY key`
  const agent = ON_BOARD.map(role => quoted(labels[role])).join(', ')

  return (
    `project = ${quoted(scope.project)} AND labels in (${agent}) ` +
    `AND (statusCategory != Done OR updated >= -${DONE_DAYS}d) ORDER BY key`
  )
}

/** The page a search answered: its structured result, or the JSON in its text. */
export function searchPage(result: {
  content: readonly { type: string; text?: string }[]
  isError: boolean
  structuredContent?: unknown
}): JiraPage {
  const text = result.content.map(block => block.text ?? '').join('')
  if (result.isError) throw new Error(`the Atlassian MCP server couldn't search Jira: ${text.trim() || 'no reason given'}`)
  const value = isPage(result.structuredContent)
    ? result.structuredContent
    : (parse(text) ?? parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)))
  if (!isPage(value)) {
    throw new Error(`the Atlassian MCP server answered the search in a form orchestra doesn't read: ${text.slice(0, 200)}`)
  }

  return value
}

/** The issues the board plans, and when each last changed (a hold ends once it does). */
export function jiraIssues(
  nodes: readonly JiraNode[],
  labels: Labels,
): { issues: Issue[]; changedAt: Map<string, number> } {
  // A sub-task's parent is its story, which stays a ticket.
  const tickets = new Map(nodes.filter(node => !isSubtask(node)).map(node => [node.key, node]))
  const parents = new Set([...tickets.values()].map(node => node.fields.parent?.key))

  const issues: Issue[] = []
  const changedAt = new Map<string, number>()
  for (const node of tickets.values()) {
    const { fields } = node
    if (parents.has(node.key) || isEpic(node)) continue
    const text = description(fields.description)
    const linked = (fields.issuelinks ?? []).flatMap(link =>
      link.inwardIssue !== undefined && isBlocks(link.type) && !isDone(link.inwardIssue) ? [link.inwardIssue.key] : [],
    )
    // A blocker the description names counts while the board shows it not done.
    const named = keys(section(text, 'Blocked by') ?? field(text, 'Blocked by') ?? '').filter(key => {
      const blocker = tickets.get(key)
      return key !== node.key && blocker !== undefined && !isDone(blocker)
    })
    const epic = fields.parent
    issues.push({
      path: node.key,
      feature: epic?.key ?? '',
      ...(epic?.fields?.summary === undefined ? {} : { featureTitle: epic.fields.summary }),
      number: node.key.replace(/^.*-/, ''),
      slug: node.key,
      ref: node.key,
      title: fields.summary,
      status: isDone(node) ? 'done' : roleOf(fields.labels ?? [], labels),
      blockedBy: [...new Set([...linked, ...named])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      ...boxes(text),
      isDone: isDone(node),
    })
    // Jira writes the offset without its colon (`+0200`).
    const updated = fields.updated?.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')
    if (updated !== undefined) changedAt.set(node.key, Date.parse(updated))
  }

  return { issues, changedAt }
}

function isDone(node: { fields?: { status?: Category } }): boolean {
  return node.fields?.status?.statusCategory?.key === 'done'
}

function isSubtask(node: JiraNode): boolean {
  return node.fields.issuetype?.subtask === true || (node.fields.issuetype?.hierarchyLevel ?? 0) < 0
}

/** An epic, or a level above it: a feature even before any story names it. */
function isEpic(node: JiraNode): boolean {
  const type = node.fields.issuetype

  return (type?.hierarchyLevel ?? 0) > 0 || /^(epic|epos)$/i.test(type?.name ?? '')
}

/** The link type of "blocks": on the blocked story, the blocker is the link's inward issue. */
function isBlocks(type: { name?: string; inward?: string } | undefined): boolean {
  return type?.name === 'Blocks' || /\bblocked by\b/i.test(type?.inward ?? '')
}

/** A description as Markdown: Jira's REST API sends Atlassian Document Format, an MCP server may send Markdown. */
function description(value: string | Adf | null | undefined): string {
  if (value === null || value === undefined) return ''

  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : markdown(value)
}

/** As much of the document as Markdown as the board reads: headings, lists, checkboxes and text. */
function markdown(node: Adf): string {
  const inner = (node.content ?? []).map(markdown).join('')
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'inlineCard':
    case 'blockCard':
      return String(node.attrs?.url ?? '')
    case 'mention':
      return String(node.attrs?.text ?? '')
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inner}\n`
    case 'taskItem':
      return `- [${node.attrs?.state === 'DONE' ? 'x' : ' '}] ${inner}\n`
    case 'listItem':
      return `- ${inner}`
    case 'paragraph':
      return `${inner}\n`
    default:
      return inner
  }
}

/** The issue keys `text` names, links to them included. */
function keys(text: string): string[] {
  return [...text.matchAll(KEY)].map(match => match[0])
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isPage(value: unknown): value is JiraPage {
  return typeof value === 'object' && value !== null && Array.isArray((value as JiraPage).issues)
}
