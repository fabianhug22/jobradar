// Jobradar – Serverfunktion für Vercel: GET /api/detail?url=<Link zur Ausschreibung>
// Lädt den Text einer einzelnen Ausschreibung und liest daraus:
// Pensum, verlangte Erfahrung (Senior / Einstieg) und ob die Stelle befristet ist.
// Pro Stelle einen Tag lang im Vercel-Cache, damit die Portale nicht unnötig belastet werden.
'use strict';

// Nur diese Portale dürfen abgefragt werden (keine beliebigen Adressen)
const ERLAUBT = ['linkedin.com', 'jobs.ch', 'jobup.ch', 'jobscout24.ch', 'persoenlich.com'];
const TIMEOUT_MS = 9000;

function decode(s) {
  return String(s || '')
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}

async function holen(url) {
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
    return r.ok ? await r.text() : '';
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Text der Ausschreibung aus der Seite holen
function beschreibung(html, istLinkedIn) {
  if (istLinkedIn) {
    const m = html.match(/class="[^"]*(?:show-more-less-html__markup|description__text)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/);
    if (m) return decode(m[1]);
  }
  // JSON-LD (jobs.ch, jobup.ch, JobScout24 …)
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const daten = JSON.parse(m[1]);
      const liste = [].concat(daten['@graph'] || daten);
      const job = liste.find((x) => x && x['@type'] === 'JobPosting' && x.description);
      if (job) return decode(job.description);
    } catch (e) { /* weiter */ }
  }
  // Rückfall: Haupttext der Seite
  const main = html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<body[\s\S]*<\/body>/i);
  return decode(main ? main[0] : html).slice(0, 20000);
}

/* ---------- Verlangter Abschluss ---------- */
// Stufen: Lehre (1) < HF (2) < FH (3) < Uni/ETH (4). Ergebnis ist die tiefste genannte Stufe,
// denn «Lehre oder FH» heisst: eine Lehre reicht.
const ABSCHLUSS_MUSTER = [
  ['efz', /(?<![\p{L}])(efz|lehre|berufslehre|grundbildung|fähigkeitszeugnis|berufsausbildung)(?![\p{L}])/u],
  ['hf', /(?<![\p{L}])(hf|höhere[nr]? fachschule)(?![\p{L}])/u],
  ['fh', /(?<![\p{L}])(fh|fachhochschul\w*|bachelor\w*|bsc|hochschulabschluss|hochschulstudium|abgeschlossene[sn]? studium)(?![\p{L}])/u],
  ['uni', /(?<![\p{L}])(uni|universität\w*|universitär\w*|eth|epfl|msc|masterabschluss|master-abschluss|master of|master in|master degree)(?![\p{L}])/u]
];
function mindestAbschluss(text) {
  const t = String(text || '').toLowerCase();
  const treffer = ABSCHLUSS_MUSTER.find(([, re]) => re.test(t));
  if (!treffer) return { abschluss: null, vergleichbar: false };
  return { abschluss: treffer[0], vergleichbar: /vergleichbar|gleichwertig|oder ähnlich|o\.\s?ä\.|entsprechende ausbildung/.test(t) };
}

/* ---------- Text auswerten ---------- */
// Exportiert für Tests
function analysiere(text) {
  const t = String(text || '');
  const klein = t.toLowerCase();

  // Pensum: zuerst neben einem Stichwort (Pensum, Auslastung …), sonst der erste Bereich «60–80 %»
  let pensum = null;
  const zahl = '(\\d{2,3})\\s*%?\\s*(?:[-–—]|bis)\\s*(\\d{2,3})\\s*%|(\\d{2,3})\\s*%';
  const mitWort = new RegExp('(?:pensum|auslastung|auslastungsgrad|arbeitspensum|beschäftigungsgrad|workload|teilzeit|anstellungsgrad)[^%\\n]{0,40}?(?:' + zahl + ')', 'i');
  const bereich = /(\d{2,3})\s*%?\s*(?:[-–—]|bis)\s*(\d{2,3})\s*%/;
  let m = t.match(mitWort);
  if (m) pensum = m[1] ? `${m[1]}–${m[2]} %` : `${m[3]} %`;
  else if ((m = t.match(bereich))) pensum = `${m[1]}–${m[2]} %`;
  else if ((m = t.match(/\((\d{2,3})\s*%\)/))) pensum = `${m[1]} %`; // «Grafiker:in (60 %)»
  else if (/\bvollzeit\b|\bfull[- ]time\b/i.test(t)) pensum = '100 %';

  // Verlangte Erfahrung in Jahren («mindestens 3 Jahre», «5+ Jahre», «3+ years»)
  let jahre = null;
  const jm = klein.match(/(?:mindestens|min\.|mind\.|ab)?\s*(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:jahre|years)\b[^.\n]{0,40}?(?:erfahrung|experience|berufserfahrung)/);
  if (jm) jahre = Number(jm[1]);

  const senior = (jahre !== null && jahre >= 3)
    || /mehrjährige|langjährige|solide (?:berufs)?erfahrung|fundierte (?:berufs)?erfahrung|ausgewiesene erfahrung|erfahrung als senior|senior[- ]?(?:ux|ui|designer|consultant|berater)|several years|extensive experience/.test(klein);
  const einstieg = /berufseinsteiger|quereinsteiger|quereinstieg|erste (?:berufs)?erfahrung|keine erfahrung|ohne erfahrung|studierende|studenten|praktikum|junior|einstiegsstelle|entry[- ]level|graduate/.test(klein);
  const befristet = /projektdauer|befristet|temporär|temporary|freelance|freiberuf|mandat(?:sdauer)?\b/.test(klein);

  const { abschluss, vergleichbar } = mindestAbschluss(t);
  return { pensum, jahre, senior, einstieg, befristet, abschluss, vergleichbar };
}

module.exports = async (req, res) => {
  const roh = (req.query && req.query.url) || '';
  let ziel;
  try { ziel = new URL(roh); } catch (e) { ziel = null; }
  if (!ziel || ziel.protocol !== 'https:' || !ERLAUBT.some((d) => ziel.hostname === d || ziel.hostname.endsWith('.' + d))) {
    res.status(400).json({ error: 'Ungültige Adresse' });
    return;
  }

  // LinkedIn: öffentliche Gast-Schnittstelle für den Ausschreibungstext
  const linkedinId = ziel.hostname.endsWith('linkedin.com') && (ziel.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1];
  const url = linkedinId ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedinId}` : ziel.href;

  const html = await holen(url);
  if (!html) {
    res.setHeader('Cache-Control', 's-maxage=600');
    res.status(200).json({ ok: false });
    return;
  }
  const text = beschreibung(html, !!linkedinId);
  const ergebnis = { ok: text.length > 80, ...analysiere(text) };
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
  res.status(200).json(ergebnis);
};

module.exports.intern = { analysiere, beschreibung, mindestAbschluss };
