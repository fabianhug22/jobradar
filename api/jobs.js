// Jobradar – Serverfunktion für Vercel: GET /api/jobs?terms=grafik,ux&places=Frauenfeld,Bern
// Holt Stellen von JobScout24, jobs.ch, jobup.ch und LinkedIn (öffentliche Gast-Suche),
// führt Duplikate zusammen und liefert ein einheitliches JSON.
// Die Trefferquote rechnet die App im Browser, weil das Profil nur dort gespeichert ist.
// Die Parser stammen aus dem Scriptable-Widget «Designstellen ZH · TG».
'use strict';

/* ---------- Einstellungen ---------- */
const MAX_ABFRAGEN = 40;      // Begriffe × Orte × Quellen pro Aufruf
const PARALLEL = 8;           // gleichzeitige Abfragen
const TIMEOUT_MS = 9000;      // pro Abfrage
const GESAMT_MS = 40000;      // danach liefern, was schon da ist
const MAX_ALTER_TAGE = 45;    // ältere Inserate weglassen

/* ---------- Hilfsfunktionen ---------- */
const enc = encodeURIComponent;

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

function str(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return decode(v);
    if (v && typeof v === 'object' && typeof v.name === 'string') return decode(v.name);
    if (v && typeof v === 'object' && typeof v.city === 'string') return decode(v.city);
  }
  return '';
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parseRelativeDate(text) {
  const t = (text || '').toLowerCase();
  const d = new Date();
  let m;
  if ((m = t.match(/^(\d+)\+?\s*([twm])$/))) { d.setDate(d.getDate() - (+m[1]) * ({ t: 1, w: 7, m: 30 })[m[2]]); return d.getTime(); }
  if (/heute|today|neu|new/.test(t)) return d.getTime();
  if (/gestern|yesterday/.test(t)) { d.setDate(d.getDate() - 1); return d.getTime(); }
  if ((m = t.match(/vor\s+(\d+)\s+tag/))) { d.setDate(d.getDate() - +m[1]); return d.getTime(); }
  if ((m = t.match(/vor\s+(\d+)\s+woche/))) { d.setDate(d.getDate() - 7 * m[1]); return d.getTime(); }
  if ((m = t.match(/vor\s+(\d+)\+?\s+monat/))) { d.setDate(d.getDate() - 30 * m[1]); return d.getTime(); }
  if ((m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return new Date(+m[3], m[2] - 1, +m[1]).getTime();
  return null;
}

// «Zürich, Zürich, Schweiz» -> «Zürich»
function cleanPlace(s) {
  const parts = String(s || '').split(',').map((p) => p.trim())
    .filter((p) => p && !/^(schweiz|switzerland|suisse|svizzera)$/i.test(p));
  return [...new Set(parts)].slice(0, 2).join(', ');
}

// Ortsname für URLs von JobScout24: «St. Gallen» -> «st-gallen»
function slug(s) {
  return String(s).toLowerCase().replace(/\./g, '').trim().replace(/\s+/g, '-');
}

/* ---------- Quellen: URLs ---------- */
const URLS = {
  jobscout: (term, place) => `https://www.jobscout24.ch/de/jobs-in-${enc(slug(place))}/${enc(term)}/`,
  jobsch: (term, place) => `https://www.jobs.ch/de/stellenangebote/?term=${enc(term)}&location=${enc(place)}`,
  jobup: (term, place) => `https://www.jobup.ch/de/jobs/?term=${enc(term)}&location=${enc(place)}`,
  linkedin: (term, place) => `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${enc(term)}&location=${enc(place + ', Schweiz')}&distance=10&f_TPR=r2592000&start=0`
};
const QUELLEN = [...Object.keys(URLS), 'persoenlich'];

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept-Language': 'de-CH,de;q=0.9',
        Accept: 'text/html,application/xhtml+xml,*/*'
      }
    });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Quellen: Parser ---------- */
function fromJsonLd(html) {
  const out = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    const items = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o['@type'] === 'JobPosting') items.push(o);
      Object.values(o).forEach(walk);
    };
    walk(data);
    for (const j of items) {
      const url = j.url || j.sameAs || '';
      const id = (url.match(/[0-9a-f]{8}-[0-9a-f-]{27}/) || [])[0] || url;
      if (!id || !url) continue;
      const loc = [].concat(j.jobLocation || [])[0];
      out.push({
        id, url,
        title: decode(j.title),
        company: str(j.hiringOrganization),
        location: str(loc && loc.address && loc.address.addressLocality),
        workload: '',
        posted: toDate(j.datePosted)
      });
    }
  }
  return out;
}

// Links auf Inserate + Text rundherum (JobScout24, jobs.ch, jobup.ch)
function fromCardLinks(html, pathRe, base) {
  const out = [];
  const re = new RegExp(`<a[^>]+href="([^"]*${pathRe.source}([0-9a-f]{8}-[0-9a-f-]{27})\\/?[^"]*)"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
  const hits = [];
  let m;
  while ((m = re.exec(html))) hits.push({ href: m[1], id: m[2], inner: m[3], end: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const title = decode(h.inner);
    if (!title || title.length < 4) continue;
    const nextStart = i + 1 < hits.length ? html.lastIndexOf('<a', hits[i + 1].end) : h.end + 1500;
    const block = html.slice(h.end, Math.min(nextStart, h.end + 2500));
    const parts = block.split(/<[^>]+>/).map(decode).filter((s) => s && s.length < 90 && s !== title);
    const isDate = (p) => /^(new|neu|heute|gestern)$|^\d+\+?\s*[twm]$|vor\s+\d|\d+\.\d+\.\d{4}/i.test(p);
    const isTag = (p) => /^(kmu|grossunternehmen|personaldienstleister|fachverantwortung|führungsposition|top|merken|speichern|bewerben|new|neu|pensum:?|arbeitsort:?|vertragsart:?|festanstellung|temporär|einfach bewerben|\*|,|\||·|-)$/i.test(p);
    const pensum = parts.find((p) => /\d+\s*%/.test(p)) || '';
    const rest = parts.filter((p) => !isDate(p) && !isTag(p) && !/\d+\s*%/.test(p));
    let company = '';
    let place = '';
    const joined = rest.find((p) => /,\s/.test(p));
    if (joined) { const k = joined.lastIndexOf(','); company = joined.slice(0, k).trim(); place = joined.slice(k + 1).trim(); }
    else { company = rest[0] || ''; place = rest[1] || ''; }
    out.push({
      id: h.id,
      url: h.href.startsWith('http') ? h.href : base + h.href,
      title, company, location: place,
      workload: pensum.replace(/^(\*|pensum:?)\s*/i, ''),
      posted: parseRelativeDate(parts.find(isDate) || '')
    });
  }
  return out;
}

function fromJobScout(html) {
  return fromJsonLd(html).concat(fromCardLinks(html, /\/de\/job\//, 'https://www.jobscout24.ch'));
}

// jobs.ch & jobup.ch: bewusst tolerant, damit kleine Änderungen nicht alles kaputt machen
function pensumFromObject(o) {
  const nums = [];
  for (const [k, v] of Object.entries(o)) {
    if (!/grade|workload|pensum|employment/i.test(k)) continue;
    [].concat(v).forEach((x) => {
      const n = +(x && typeof x === 'object' ? (x.value || x.min || x.max) : x);
      if (n >= 10 && n <= 100) nums.push(n);
    });
  }
  if (!nums.length) return '';
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? `${lo} %` : `${lo}–${hi} %`;
}

function walkJobCloud(data, host, detailPath) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const id = o.job_id || o.jobId || o.id;
    if (typeof o.title === 'string' && id && (o.company_name || o.company || o.place || o.publication_date)) {
      const links = o.links || o._links || {};
      let link = links.detail_de || links.detail || '';
      if (link && typeof link === 'object') link = link.href || '';
      out.push({
        id: String(id),
        url: link ? (link.startsWith('http') ? link : host + link) : `${host}${detailPath}${id}/`,
        title: decode(o.title),
        company: str(o.company_name, o.company),
        location: str(o.place, o.city, o.location, [].concat(o.locations || [])[0]),
        workload: pensumFromObject(o),
        posted: toDate(o.publication_date || o.initial_publication_date || o.datePosted || o.published_at)
      });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return out;
}

function makeJobCloudParser(host, detailPath) {
  const linkRe = new RegExp(detailPath.replace(/\//g, '\\/'));
  return (text) => {
    // 1. eingebettete Daten im Seiten-Code, 2. JSON-LD, 3. Inserat-Links
    const fromState = [];
    const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(text))) {
      const s = m[1];
      if (!/job_id|publication_date|employment_grade/.test(s)) continue;
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a < 0 || b <= a) continue;
      try { fromState.push(...walkJobCloud(JSON.parse(s.slice(a, b + 1)), host, detailPath)); } catch (e) { /* weiter */ }
    }
    const byId = {};
    for (const j of fromCardLinks(text, linkRe, host).concat(fromJsonLd(text), fromState)) {
      byId[j.id] = Object.assign(byId[j.id] || {}, Object.fromEntries(Object.entries(j).filter(([, v]) => v)));
    }
    return Object.values(byId);
  };
}

// LinkedIn: öffentliche Gast-Suche (ohne Login)
function fromLinkedIn(html) {
  const out = [];
  for (const c of html.split(/<li[\s>]/).slice(1)) {
    const id = (c.match(/jobPosting:(\d+)/) || [])[1];
    const title = decode((c.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    if (!id || !title) continue;
    const href = (c.match(/href="(https:\/\/[a-z]+\.linkedin\.com\/jobs\/view\/[^"?]+)/) || [])[1];
    const dt = (c.match(/datetime="([\d-]+)"/) || [])[1];
    out.push({
      id, url: href || `https://www.linkedin.com/jobs/view/${id}/`, title,
      company: decode((c.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/) || [])[1]),
      location: cleanPlace(decode((c.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/) || [])[1])),
      workload: '', posted: toDate(dt)
    });
  }
  return out;
}

// persoenlich.com: Stellenmarkt der Kommunikationsbranche (Agenturen, oft nur hier inseriert).
// Eine Liste für die ganze Schweiz (wenige Inserate), daher ohne Suchbegriff abgefragt.
// Ort steht oft nur als Kanton («Thurgau, 29.10.2026»), die Stadt manchmal im Text.
function fromPersoenlich(html) {
  const out = [];
  const bloecke = html.split(/<a\s+href="\/stellenmarkt\//).slice(1);
  for (const b of bloecke) {
    const slug = (b.match(/^([a-z0-9-]+)"/) || [])[1];
    if (!slug) continue; // z. B. «?page=2» oder Übersicht
    const title = decode((b.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
    if (!title) continue;
    const company = decode((b.match(/<strong[^>]*>([\s\S]*?)<\/strong>/) || [])[1]);
    const ortDatum = decode((b.match(/<b[^>]*>([\s\S]*?)<\/b>/) || [])[1]);
    const dm = ortDatum.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    const location = ortDatum.replace(/,?\s*\d{1,2}\.\d{1,2}\.\d{4}.*$/, '').trim();
    const text = decode((b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
    out.push({
      id: slug,
      url: 'https://persoenlich.com/stellenmarkt/' + slug,
      title, company, location,
      workload: (title.match(/\d{2,3}\s*(?:%\s*)?(?:-|–|bis)?\s*\d{0,3}\s*%/) || [''])[0],
      posted: dm ? new Date(+dm[3], dm[2] - 1, +dm[1]).getTime() : null,
      text
    });
  }
  return out;
}

const PARSE = {
  jobscout: fromJobScout,
  jobsch: makeJobCloudParser('https://www.jobs.ch', '/de/stellenangebote/detail/'),
  jobup: makeJobCloudParser('https://www.jobup.ch', '/de/jobs/detail/'),
  linkedin: fromLinkedIn,
  persoenlich: fromPersoenlich
};
const PERSOENLICH_SEITEN = ['https://persoenlich.com/stellenmarkt/', 'https://persoenlich.com/stellenmarkt/?page=2'];

/* ---------- Fachfremde Stellen aussortieren ---------- */
// Portale finden bei «Designer» auch Technik-Stellen (Tooling Designer, Chip-Designer …).
// Diese Wörter im Titel schliessen eine Stelle aus, ausser es steht klar Grafik/UX/UI drin.
// Liste aus dem Scriptable-Widget, ergänzt um Werkzeug- und Fertigungsbegriffe.
const TECHNIK = [
  'maschinen', 'mechanical', 'mechanik', 'konstrukt', 'elektro', 'electrical', 'hardware',
  'chip', 'asic', 'fpga', 'pcb', 'ic designer', 'analog', 'silicon', 'rf ', 'rf/',
  'werkzeug', 'tooling', 'turbin', 'cad', 'fertigung', 'manufacturing', 'process engineer',
  'engineer', 'developer', 'entwickler', 'security', 'solution architect', 'architekt',
  'hochbau', 'tiefbau', 'sanitär', 'heizung', 'lüftung', 'monteur', 'interior', 'innenarch',
  'küche', 'garten', 'schmuck'
];
function istFachfremd(titel) {
  const t = ' ' + String(titel).toLowerCase() + ' ';
  if (!TECHNIK.some((w) => t.includes(w))) return false;
  return !/\bux\b|\bui\b|grafik|graphic|kommunikationsdesign|communication design|visual/.test(t);
}

/* ---------- Zusammenführen ---------- */
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\((m|w|d|f|h)[^)]*\)/g, '').replace(/\d+\s*(-|–|bis)?\s*\d*\s*%/g, '')
    .replace(/[^a-zäöü0-9]+/g, '');
}

function enthaeltOrt(text, ort) {
  const o = String(ort).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![\\p{L}])' + o + '(?![\\p{L}])', 'u').test(String(text || '').toLowerCase());
}

function liste(wert, max) {
  return String(wert || '').split(',').map((s) => s.trim().slice(0, 40)).filter(Boolean)
    .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, max);
}

async function sammle(terms, places) {
  // Abfragen planen: zuerst alle Orte für den wichtigsten Begriff, dann den nächsten …
  const tasks = [];
  for (const term of terms) for (const place of places) for (const src of Object.keys(URLS)) tasks.push({ src, term, place, url: URLS[src](term, place) });
  const plan = tasks.slice(0, MAX_ABFRAGEN);
  // persoenlich.com: ganze Liste (2 Seiten) einmal pro Aufruf
  PERSOENLICH_SEITEN.forEach((url) => plan.unshift({ src: 'persoenlich', url }));

  const status = Object.fromEntries(QUELLEN.map((q) => [q, 'fehler']));
  const roh = [];
  const ende = Date.now() + GESAMT_MS;
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, plan.length) }, async () => {
    while (i < plan.length && Date.now() < ende) {
      const t = plan[i++];
      const html = await fetchText(t.url);
      if (!html) continue;
      let gefunden = [];
      try { gefunden = PARSE[t.src](html); } catch (e) { gefunden = []; }
      status[t.src] = 'ok';
      gefunden.forEach((j) => {
        if (!j.title) return;
        if (t.src === 'persoenlich') {
          // Nur Stellen, deren Ort oder Text einen Ort aus dem Profil nennt
          const hier = places.find((p) => enthaeltOrt(j.location, p) || enthaeltOrt(j.text, p));
          if (hier) roh.push({ ...j, src: t.src, suchOrt: hier });
          return;
        }
        roh.push({ ...j, src: t.src, suchOrt: t.place });
      });
    }
  }));

  // Gleiche Stelle auf mehreren Portalen -> ein Eintrag mit allen Quellen
  const grenze = Date.now() - MAX_ALTER_TAGE * 864e5;
  const gruppen = {};
  for (const j of roh) {
    if (j.posted && j.posted < grenze) continue;
    if (istFachfremd(j.title)) continue;
    const k = norm(j.title) + '|' + norm(j.company);
    const g = gruppen[k];
    if (!g) {
      gruppen[k] = { ...j, quellen: [j.src], suchOrte: [j.suchOrt] };
      continue;
    }
    if (!g.quellen.includes(j.src)) g.quellen.push(j.src);
    if (!g.suchOrte.includes(j.suchOrt)) g.suchOrte.push(j.suchOrt);
    if (!g.workload && j.workload) g.workload = j.workload;
    if (!g.posted && j.posted) g.posted = j.posted;
    if (!g.location && j.location) g.location = j.location;
  }

  const jobs = Object.values(gruppen).map((j) => ({
    id: j.src + ':' + j.id,
    titel: j.title,
    firma: j.company || '',
    ort: cleanPlace(j.location) || j.suchOrt,
    pensum: j.workload || '',
    datum: j.posted ? new Date(j.posted).toISOString() : null,
    link: j.url,
    quellen: j.quellen,
    suchOrte: j.suchOrte // für welche Orte aus dem Profil die Stelle gefunden wurde
  }));

  return { updated: new Date().toISOString(), sources: status, abfragen: plan.length, jobs };
}

/* ---------- Vercel-Handler ---------- */
module.exports = async (req, res) => {
  const q = req.query || {};
  const terms = liste(q.terms, 5);
  const places = liste(q.places, 5);
  if (!terms.length || !places.length) {
    res.status(400).json({ error: 'Parameter terms und places sind nötig, z. B. ?terms=grafik&places=Bern' });
    return;
  }
  try {
    const daten = await sammle(terms, places);
    // Eine Stunde im Vercel-Cache, danach im Hintergrund neu laden
    const keineDaten = Object.values(daten.sources).every((s) => s !== 'ok');
    res.setHeader('Cache-Control', keineDaten ? 'no-store' : 's-maxage=3600, stale-while-revalidate=600');
    res.status(200).json(daten);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Stellen konnten nicht geladen werden.' });
  }
};

// Für lokale Tests
module.exports.intern = { PARSE, sammle, norm, cleanPlace, liste, enthaeltOrt, istFachfremd };
