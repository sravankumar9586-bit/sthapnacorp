// Daily check of official and news sources for due-date extensions. Anything found is queued
// for the admin to review; nothing changes on the website until an extension is approved.
const { query } = require('./db');

const UA = 'Mozilla/5.0 (compatible; SthapnaCorpDueDateWatch/1.0; +https://www.sthapnacorp.com)';

// `official: true` sources are lists of circulars/notifications, so any item mentioning
// an extension is relevant. News feeds must also mention a filing or authority.
const SOURCES = [
  { id: 'cbic-gst', name: 'CBIC – GST central tax notifications', url: 'https://cbic-gst.gov.in/central-tax-notifications.html', type: 'html', official: true },
  { id: 'cbdt-circulars', name: 'CBDT – income tax circulars', url: 'https://incometaxindia.gov.in/Pages/communications/circulars.aspx', type: 'html', official: true },
  { id: 'cbdt-press', name: 'CBDT – press releases', url: 'https://incometaxindia.gov.in/Pages/press-releases.aspx', type: 'html', official: true },
  { id: 'mca-circulars', name: 'MCA – general circulars', url: 'https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/circulars.html', type: 'html', official: true },
  { id: 'pib', name: 'PIB – Government press releases', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', type: 'rss', official: false },
  { id: 'news-tax', name: 'News – income tax & TDS', url: newsUrl('("due date" OR "last date") (extended OR extends OR extension) (CBDT OR ITR OR "tax audit" OR TDS)'), type: 'rss', official: false },
  { id: 'news-mca', name: 'News – MCA / ROC', url: newsUrl('MCA (circular OR relaxation OR "additional fee" OR extends) (AOC-4 OR MGT-7 OR LLP OR "Form 8" OR "Form 11" OR filing)'), type: 'rss', official: false },
  { id: 'news-gst', name: 'News – GST', url: newsUrl('GST ("due date" OR "last date") (extended OR extends OR extension) (GSTR OR return)'), type: 'rss', official: false },
];

function newsUrl(q) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:30d') + '&hl=en-IN&gl=IN&ceid=IN:en';
}

const CHANGE_RE = /\b(extend(s|ed|ing)?|extension|due date|last date|relax(ation|es|ed)?|without (any )?additional fee|waive(r|d)?|condon(ation|e))\b/i;
const TOPIC_RE = /\b(CBDT|income[- ]?tax|ITR|TDS|TCS|tax audit|MCA|ROC|AOC-?4|MGT-?7|LLP|Form ?8|Form ?11|DIR-?3|DPT-?3|MSME-?1|GST|GSTR|CBIC)\b/i;

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const get = (tag) => { const t = block.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return t ? decode(t[1]) : ''; };
    const title = get('title');
    const link = get('link') || get('guid');
    const date = get('pubDate') || get('dc:date');
    if (title && link) items.push({ title, url: link, published: date ? new Date(date) : null });
  }
  return items;
}

function parseHtml(html, base) {
  const items = [];
  const seen = new Set();
  const add = (title, href) => {
    if (!title || !href || /^(javascript|mailto|tel):|^#/i.test(href)) return;
    let url;
    try { url = new URL(href, base).toString(); } catch (e) { return; }
    if (seen.has(url)) return;
    seen.add(url);
    title = title.replace(/(\s+(download|view|pdf|click here|hindi|english)(\s*\([^)]*\))?)+\s*$/i, '').trim();
    if (title) items.push({ title: title.slice(0, 400), url, published: null });
  };
  // Table rows carry the subject next to the PDF link on most government listing pages.
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  rows.forEach((row) => {
    const href = (row.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1];
    add(decode(row), href);
  });
  const anchors = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchors.exec(html))) add(decode(m[2]), m[1]);
  return items;
}

const FORM_HINTS = [
  [/AOC-?4/i, 'aoc4'], [/MGT-?7/i, 'mgt7'], [/\bForm ?11\b/i, 'form11'], [/\bForm ?8\b/i, 'form8'],
  [/DPT-?3/i, 'dpt3'], [/MSME-?1/i, 'msme1'], [/INC-?20A/i, 'inc20a'],
  [/GSTR-?3B/i, 'gstr3b'], [/GSTR-?1\b/i, 'gstr1'], [/GSTR-?9/i, 'gstr9'],
  [/\bITR\b|return of income|income[- ]tax return/i, 'itr6'], [/tax audit|audit report|3CD/i, '3cd'],
  [/\bTDS\b|\bTCS\b|statement of deduction/i, 'tds'], [/advance tax/i, 'advtax'],
];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

// Best-effort pre-fill for the admin form; the admin always confirms against the circular.
function suggest(title) {
  const out = {};
  for (const [re, key] of FORM_HINTS) { if (re.test(title)) { out.form_key = key; break; } }
  const dates = [];
  let m;
  const r1 = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})/gi;
  while ((m = r1.exec(title))) dates.push(isoOf(m[3], MONTHS[m[2].toLowerCase()], m[1]));
  const r2 = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/gi;
  while ((m = r2.exec(title))) dates.push(isoOf(m[3], MONTHS[m[1].toLowerCase()], m[2]));
  const r3 = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g;
  while ((m = r3.exec(title))) if (Number(m[2]) <= 12) dates.push(isoOf(m[3], m[2], m[1]));
  if (dates.length) out.new_due = dates.sort().pop();
  const fy = title.match(/\b(?:FY|F\.Y\.|financial year)\s*(20\d{2})\s*[-–/]\s*(\d{2,4})/i);
  const ay = title.match(/\b(?:AY|A\.Y\.|assessment year)\s*(20\d{2})\s*[-–/]\s*(\d{2,4})/i);
  if (fy) out.fy_end = Number(fy[1]) + 1;
  else if (ay) out.fy_end = Number(ay[1]);
  if (/additional fee|without (any )?additional|waive/i.test(title)) out.kind = 'fee_waiver';
  return out;
}

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function checkSource(src, firstRun) {
  let scanned = 0;
  let matched = 0;
  const fresh = [];
  try {
    const body = await fetchText(src.url, 12000);
    const items = src.type === 'rss' ? parseRss(body) : parseHtml(body, src.url);
    scanned = items.length;
    const cutoff = Date.now() - 45 * 86400000;
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    for (const it of items) {
      if (!CHANGE_RE.test(it.title)) continue;
      if (!src.official && !TOPIC_RE.test(it.title)) continue;
      matched++;
      // File older items away so the admin only sees what is new (on a source's first run,
      // everything already listed counts as old) — unless the date it mentions is still ahead.
      const hint = suggest(it.title);
      const stillAhead = hint.new_due && hint.new_due >= today;
      const old = it.published && !isNaN(it.published) ? it.published.getTime() < cutoff : firstRun;
      const status = old && !stillAhead ? 'archived' : 'new';
      const r = await query(
        `INSERT INTO watch_items (source, title, url, published_at, suggestion, status)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO NOTHING RETURNING id, title, url, source, suggestion, status`,
        [src.id, it.title, it.url, it.published && !isNaN(it.published) ? it.published.toISOString() : null, JSON.stringify(hint), status]
      );
      if (r.rows.length && r.rows[0].status === 'new') fresh.push(Object.assign(r.rows[0], { source_name: src.name }));
    }
    await query(
      `INSERT INTO watch_sources (source, checked_at, ok, scanned, matched, error) VALUES ($1, NOW(), TRUE, $2, $3, NULL)
       ON CONFLICT (source) DO UPDATE SET checked_at = NOW(), ok = TRUE, scanned = $2, matched = $3, error = NULL`,
      [src.id, scanned, matched]
    );
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'Timed out' : String(e && e.message || e).slice(0, 300);
    await query(
      `INSERT INTO watch_sources (source, checked_at, ok, scanned, matched, error) VALUES ($1, NOW(), FALSE, 0, 0, $2)
       ON CONFLICT (source) DO UPDATE SET checked_at = NOW(), ok = FALSE, error = $2`,
      [src.id, msg]
    );
  }
  return fresh;
}

async function runWatch() {
  const known = new Set((await query('SELECT source FROM watch_sources')).rows.map((r) => r.source));
  const results = await Promise.all(SOURCES.map((s) => checkSource(s, !known.has(s.id))));
  return results.flat();
}

module.exports = { SOURCES, runWatch, parseRss, parseHtml, suggest, CHANGE_RE, TOPIC_RE };
