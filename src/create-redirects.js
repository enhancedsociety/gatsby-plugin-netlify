import { HEADER_COMMENT } from "./constants"
import { exists, readFile, writeFile } from "fs-extra"

export default async function writeRedirectsFile(
  pluginData,
  redirects,
  rewrites
) {
  const { publicFolder } = pluginData

  if (!redirects.length && !rewrites.length) return null

  const FILE_PATH = publicFolder(`_redirects`)

  // https://www.netlify.com/docs/redirects/
  const NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST = [
    `query`,
    `conditions`,
    `headers`,
    `signed`,
    `edge_handler`,
    `Language`,
    `Country`,
    `Cookie`,
  ]

  // Map redirect data to the format Netlify expects
  const buildRedirects = (redirects) => redirects.map(redirect => {
    const {
      fromPath,
      isPermanent,
      redirectInBrowser, // eslint-disable-line no-unused-vars
      force,
      toPath,
      statusCode,
      ...rest
    } = redirect

    let status = isPermanent ? `301` : `302`
    if (statusCode) status = String(statusCode)

    if (force) status = `${status}!`

    // The order of the first 3 parameters is significant.
    // The order for rest params (key-value pairs) is arbitrary.
    const pieces = [fromPath, toPath, status]

    for (const key in rest) {
      const value = rest[key]

      if (typeof value === `string` && value.includes(` `)) {
        console.warn(
          `Invalid redirect value "${value}" specified for key "${key}". ` +
            `Values should not contain spaces.`
        )
      } else {
        if (NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST.includes(key)) {
          pieces.push(`${key}=${value}`)
        }
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
    return a.fromPath < b.fromPath ? -1 : 1
  })
  const postPonedRedirects = buildRedirects(sortedPostponed)
  redirects = [
      ...buildRedirects(sortedNonPosponed),
      ...buildRedirects(sortedPostponed)
  ]

  rewrites = rewrites.map(
    ({ fromPath, toPath }) => `${fromPath}  ${toPath}  200`
  )

  let commentFound = false

  // Websites may also have statically defined redirects
  // In that case we should append to them (not overwrite)
  // Make sure we aren't just looking at previous build results though
  const fileExists = await exists(FILE_PATH)
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

  return writeFile(
    FILE_PATH,
    [data, HEADER_COMMENT, ...redirects, ...rewrites].join(`\n`)
  )
}
