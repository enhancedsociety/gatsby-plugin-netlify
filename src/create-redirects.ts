import { existsSync, readFile, writeFile } from 'fs-extra'

import { HEADER_COMMENT } from './constants'

const toNetlifyPath = (fromPath: string, toPath: string): Array<string> => {
 // Modifies query parameter redirects, having no effect on other fromPath strings
 const netlifyFromPath = fromPath.replace(/[&?]/, ' ')
 // Modifies wildcard & splat redirects, having no effect on other toPath strings
 const netlifyToPath = toPath.replace(/\*/, ':splat')

  return [
    netlifyFromPath,
    netlifyToPath,
  ]
}

// eslint-disable-next-line max-statements
export default async function writeRedirectsFile(pluginData: any, redirects: any, rewrites: any) {
  const { publicFolder } = pluginData

  if (redirects.length === 0 && rewrites.length === 0) return null

  const FILE_PATH = publicFolder(`_redirects`)

  // https://www.netlify.com/docs/redirects/
  const NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST = new Set([
    `query`,
    `conditions`,
    `headers`,
    `signed`,
    `edge_handler`,
  ])

  const NETLIFY_CONDITIONS_ALLOWLIST = new Set([
    `language`,
    `country`,
    `Cookie`
  ])

  // Map redirect data to the format Netlify expects
  // eslint-disable-next-line max-statements
  const buildRedirects = (redirects) => redirects.map((redirect: any) => {
    const { fromPath, isPermanent, redirectInBrowser, force, toPath, statusCode, ...rest } = redirect

    let status = isPermanent ? `301` : `302`
    if (statusCode) status = String(statusCode)

    if (force) status = `${status}!`

    const [netlifyFromPath, netlifyToPath] = toNetlifyPath(fromPath, toPath)

    // The order of the first 3 parameters is significant.
    // The order for rest params (key-value pairs) is arbitrary.
    const pieces = [netlifyFromPath, netlifyToPath, status]

    for (const key in rest) {
      const value = rest[key]

      if (typeof value === `string` && value.includes(` `)) {
        console.warn(`Invalid redirect value "${value}" specified for key "${key}". Values should not contain spaces.`)
      } else if (key === 'conditions') {
        // "conditions" key from Gatsby contains only "language" and "country"
        // which need special transformation to match Netlify _redirects
        // https://www.gatsbyjs.com/docs/reference/config-files/actions/#createRedirect

        for (const conditionKey in value) {
          if (NETLIFY_CONDITIONS_ALLOWLIST.has(conditionKey)) {
            const conditionValue = Array.isArray(value[conditionKey]) ? value[conditionKey].join(',') : value[conditionKey]
            // Gatsby gives us "country", we want "Country"
            const conditionName = conditionKey.charAt(0).toUpperCase() + conditionKey.slice(1)
            pieces.push(`${conditionName}=${conditionValue}`)
          }
        }
      } else if (NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST.has(key)) {
        pieces.push(`${key}=${value}`)
      }
    }

    return pieces.join(`  `)
  })

  const sortedPostponed = redirects.filter(r => r.postpone).sort((a,b) => {
    if (a.fromPath == b.fromPath) {
      return (a.Country || 'zz') < (b.Country || 'zz') ? -1 : 1
    }
    return a.fromPath < b.fromPath ? -1 : 1
  })

  const cookie_compare_default = 'set_cake_locale_zz'
  const sortedNonPosponed = redirects.filter(r => !r.postpone).sort((a,b) => {
    if (a.fromPath == b.fromPath) {
      const cookieA = (a.Cookie && a.Cookie[0] || cookie_compare_default).replace('null', 'zz')
      const cookieB = (b.Cookie && b.Cookie[0] || cookie_compare_default).replace('null', 'zz')
      return cookieA < cookieB ? -1 : 1
    }
    const aHasWildcard = a.fromPath.endsWith('/*')
    if (aHasWildcard || b.fromPath.endsWith('/*')) {
      const removeLastSlashOnwardsRegex = new RegExp(/[^\/]+\/?$/)
      const aPathWithoutWildcard = a.fromPath.replace(removeLastSlashOnwardsRegex, '')
      const bPathWithoutWildcard = b.fromPath.replace(removeLastSlashOnwardsRegex, '')
      if (aPathWithoutWildcard == bPathWithoutWildcard) {
        // the path WITHOUT the wildcard needs to go first
        return aHasWildcard ? 1 : -1
      }
    }
    return a.fromPath < b.fromPath ? -1 : 1
  })
  redirects = [
      ...buildRedirects(sortedNonPosponed),
      ...buildRedirects(sortedPostponed)
  ]

  rewrites = rewrites.map(({ fromPath, toPath }: any) => `${fromPath}  ${toPath}  200`)

  let commentFound = false

  // Websites may also have statically defined redirects
  // In that case we should append to them (not overwrite)
  // Make sure we aren't just looking at previous build results though
  const fileExists = existsSync(FILE_PATH)
  let fileContents = ``
  if (fileExists) {
    fileContents = await readFile(FILE_PATH, `utf8`)
    commentFound = fileContents.includes(HEADER_COMMENT)
  }
  let data
  if (commentFound) {
    const [theirs] = fileContents.split(`\n${HEADER_COMMENT}\n`)
    data = theirs
  } else {
    data = fileContents
  }

  return writeFile(FILE_PATH, [data, HEADER_COMMENT, ...redirects, ...rewrites].join(`\n`))
}
