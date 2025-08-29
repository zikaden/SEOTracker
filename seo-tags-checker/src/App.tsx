import { useMemo, useState } from 'react'

type ParsedTags = {
  title?: string
  description?: string
  canonical?: string
  robots?: string
  og: Record<string, string>
  twitter: Record<string, string>
}

type ScoreResult = { score: number; issues: string[] }

// Proxies that return RAW HTML (not extracted text)
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://cors.isomorphic-git.org/${url}`,
]

function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`)
    return u.toString()
  } catch {
    return null
  }
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) return await res.text()
  } catch {}
  for (const wrap of CORS_PROXIES) {
    try {
      const res = await fetch(wrap(url))
      if (res.ok) return await res.text()
    } catch {}
  }
  throw new Error('Unable to fetch page HTML (CORS/network)')
}

function parseTags(html: string): ParsedTags {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const og: Record<string, string> = {}
  const twitter: Record<string, string> = {}
  const get = (sel: string) => doc.querySelector(sel)?.getAttribute('content') || undefined

  doc.querySelectorAll('meta[property^="og:"]').forEach((m) => {
    const p = m.getAttribute('property') || ''
    const c = m.getAttribute('content') || ''
    if (p) og[p.replace('og:', '')] = c
  })
  doc.querySelectorAll('meta[name^="twitter:"]').forEach((m) => {
    const n = m.getAttribute('name') || ''
    const c = m.getAttribute('content') || ''
    if (n) twitter[n.replace('twitter:', '')] = c
  })
  // some sites incorrectly put twitter meta in property attribute
  doc.querySelectorAll('meta[property^="twitter:"]').forEach((m) => {
    const n = (m.getAttribute('property') || '').replace('twitter:', '')
    const c = m.getAttribute('content') || ''
    if (n && !twitter[n]) twitter[n] = c
  })

  return {
    title: doc.querySelector('title')?.textContent || undefined,
    description: get('meta[name="description"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || undefined,
    robots: get('meta[name="robots"]'),
    og,
    twitter,
  }
}

function computeScore(t: ParsedTags): ScoreResult {
  let score = 100
  const issues: string[] = []

  if (!t.title) { score -= 20; issues.push('Missing <title>') }
  else {
    const len = t.title.trim().length
    if (len < 50 || len > 60) { score -= 5; issues.push('Title length suboptimal (50–60)') }
  }

  if (!t.description) { score -= 20; issues.push('Missing meta description') }
  else {
    const len = t.description.trim().length
    if (len < 150 || len > 160) { score -= 5; issues.push('Description length suboptimal (150–160)') }
  }

  if (!t.canonical) { score -= 10; issues.push('Missing canonical link') }
  if (t.robots && /noindex|nofollow/i.test(t.robots)) { score -= 10; issues.push('Robots prevents indexing') }

  const ogComplete = !!(t.og.title || t.og['site_name']) && !!t.og.description && !!t.og.image
  if (!ogComplete) { score -= 10; issues.push('Incomplete Open Graph tags') }

  const twComplete = !!t.twitter.title && !!t.twitter.description && !!t.twitter.image
  if (!twComplete) { score -= 10; issues.push('Incomplete Twitter Card tags') }

  return { score: Math.max(0, score), issues }
}

function getSuggestions(t: ParsedTags): string[] {
  const s: string[] = []
  // Title
  if (!t.title) s.push('Add a concise <title> around 50–60 characters including a primary keyword.')
  else {
    const len = t.title.trim().length
    if (len < 50) s.push('Lengthen your title toward 50–60 characters for better display in SERP.')
    if (len > 60) s.push('Shorten your title to ~50–60 characters to avoid truncation.')
  }
  // Description
  if (!t.description) s.push('Add a compelling meta description around 150–160 characters.')
  else {
    const len = t.description.trim().length
    if (len < 150) s.push('Expand meta description toward 150–160 characters to improve CTR.')
    if (len > 160) s.push('Trim meta description to ~155 characters to avoid truncation.')
  }
  // Canonical & robots
  if (!t.canonical) s.push('Add <link rel="canonical" href="https://example.com/page"> to consolidate duplicates.')
  if (t.robots && /noindex|nofollow/i.test(t.robots)) s.push('Remove noindex/nofollow from robots meta if the page should be indexed.')
  // Social
  if (!t.og.title || !t.og.description || !t.og.image) s.push('Provide Open Graph tags: og:title, og:description, og:image (1200×630).')
  if (!t.twitter.title || !t.twitter.description || !t.twitter.image) s.push('Provide Twitter Card tags (summary_large_image) with title, description, and image.')
  return s
}

function SerpPreview({ url, title, description }: { url: string; title: string; description: string }) {
  const hostname = useMemo(() => { try { return new URL(url).hostname } catch { return url } }, [url])
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M19.5 14.25v-4.5a3 3 0 0 0-3-3h-9a3 3 0 0 0-3 3v4.5m15 0A2.25 2.25 0 0 1 17.25 16.5h-10.5A2.25 2.25 0 0 1 4.5 14.25m15 0v2.25A2.25 2.25 0 0 1 17.25 18.75h-10.5A2.25 2.25 0 0 1 4.5 16.5V14.25"/></svg>
        Google SERP Preview
      </div>
      <div className="mt-2">
        <div className="text-[#1a0dab] text-xl leading-snug">{title}</div>
        <div className="text-[#4d5156] text-sm mt-1">{description}</div>
        <div className="text-green-700 text-sm mt-1">{hostname}</div>
      </div>
    </div>
  )
}

function SocialCard({ network, title, description, image, url }: { network: 'Facebook/LinkedIn' | 'Twitter'; title: string; description: string; image?: string; url: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M12 4.5c-4.694 0-8.5 3.806-8.5 8.5S7.306 21.5 12 21.5s8.5-3.806 8.5-8.5S16.694 4.5 12 4.5Zm0 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z"/></svg>
        {network} preview
      </div>
      <div className="mt-2 flex gap-3">
        <div className="h-16 w-16 flex-shrink-0 rounded bg-gray-100 overflow-hidden">
          {image ? <img src={image} alt="preview" className="h-full w-full object-cover" /> : <div className="h-full w-full grid place-items-center text-xs text-gray-400">no image</div>}
        </div>
        <div>
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="text-sm text-gray-600 line-clamp-2">{description}</div>
          <div className="text-xs text-gray-500 mt-1">{url}</div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [url, setUrl] = useState('https://example.com')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)

  const parsed = useMemo(() => (html ? parseTags(html) : undefined), [html])
  const scored = useMemo(() => (parsed ? computeScore(parsed) : undefined), [parsed])

  async function handleAnalyze() {
    setError(null)
    const normalized = normalizeUrl(url)
    if (!normalized) { setError('Enter a valid URL'); return }
    // reflect normalized value back in the input so users don't need to type https://
    setUrl(normalized)
    setLoading(true)
    try {
      const text = await fetchHtml(normalized)
      setHtml(text)
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch HTML')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-gray-700"><path d="M10.5 3.75a6.75 6.75 0 1 0 3.986 12.201l3.781 3.782 1.061-1.061-3.782-3.781A6.75 6.75 0 0 0 10.5 3.75Zm0 1.5a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5Z"/></svg>
            SEO Tags Checker
          </div>
          <a className="text-sm text-blue-600 hover:underline" href="https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=de" target="_blank" rel="noreferrer">What is SEO?</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="example.com or domain.com/page"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze() }}
          />
          <button className="rounded-md bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700 disabled:opacity-50" onClick={handleAnalyze} disabled={loading}>{loading ? 'Analyzing…' : 'Analyze'}</button>
        </div>

        {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {!parsed && (
          <section className="mt-8">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3">
                <div className="p-6 md:col-span-2">
                  <h2 className="text-xl font-semibold text-gray-900">Analyze your page’s SEO tags</h2>
                  <p className="mt-2 text-gray-600 text-sm">Enter a URL above and we’ll fetch the HTML, extract key meta tags, and show previews for Google and social platforms.</p>
                  <ul className="mt-4 list-disc pl-5 text-sm text-gray-700 space-y-1">
                    <li>Checks title and description length</li>
                    <li>Validates canonical and robots</li>
                    <li>Open Graph & Twitter Card coverage</li>
                  </ul>
                </div>
                <div className="relative hidden md:block">
                  <img
                    src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=60"
                    alt="Analytics illustration"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {parsed && scored && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="lg:col-span-1 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 font-semibold text-gray-900">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.76 9.76 0 0 0 12 2.25Zm-1.2 13.2-3-3 1.35-1.35 1.65 1.65 3.9-3.9L16.05 9l-5.25 6.45Z"/></svg>
                    SEO Score
                  </div>
                  <div className="text-3xl font-extrabold text-gray-900">{scored.score}</div>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {scored.issues.length === 0 ? <li>No major issues found</li> : scored.issues.map((i, k) => <li key={k}>{i}</li>)}
                </ul>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="inline-flex items-center gap-2 font-semibold text-gray-900 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.76 9.76 0 0 0 12 2.25Zm.75 4.5h-1.5v6h1.5Zm0 7.5h-1.5v1.5h1.5Z"/></svg>
                  Suggestions
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {getSuggestions(parsed).map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="inline-flex items-center gap-2 font-semibold text-gray-900 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M3.75 6.75h16.5v10.5H3.75zM6 9h5.25v1.5H6z"/></svg>
                  Extracted Tags
                </div>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium text-gray-900">Title:</span> {parsed.title || <span className="text-gray-400">(missing)</span>}</div>
                  <div><span className="font-medium text-gray-900">Description:</span> {parsed.description || <span className="text-gray-400">(missing)</span>}</div>
                  <div><span className="font-medium text-gray-900">Canonical:</span> {parsed.canonical || <span className="text-gray-400">(missing)</span>}</div>
                  <div><span className="font-medium text-gray-900">Robots:</span> {parsed.robots || <span className="text-gray-400">(none)</span>}</div>
                </div>
              </div>
            </section>

            <section className="lg:col-span-2 space-y-6">
              <SerpPreview url={parsed.canonical || url} title={parsed.title || 'Example Website'} description={parsed.description || 'No description provided.'} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SocialCard network="Facebook/LinkedIn" title={parsed.og.title || parsed.title || 'Open Graph title'} description={parsed.og.description || parsed.description || 'Open Graph description'} image={parsed.og.image || parsed.twitter.image} url={parsed.canonical || url} />
                <SocialCard network="Twitter" title={parsed.twitter.title || parsed.title || 'Twitter title'} description={parsed.twitter.description || parsed.description || 'Twitter description'} image={parsed.twitter.image || parsed.og.image} url={parsed.canonical || url} />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
