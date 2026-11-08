'use strict';

/* ---------- Konstanten ---------- */
const KEY_PROFIL = 'jobradar.profil';
const KEY_CACHE = 'jobradar.cache';
const KEY_AUSGEBLENDET = 'jobradar.ausgeblendet'; // Stellen, die mit «Passt nicht» weggeklickt wurden
const PASST_AB = 60;                 // ab dieser Quote oben in der Liste, darunter eingeklappt
const PROFIL_VERSION = 1;
const INTERVALL_MS = 60 * 60 * 1000; // 60 Minuten
const NEU_MS = 24 * 60 * 60 * 1000;  // 24 Stunden
const TOP_AB = 70;                   // ab dieser Trefferquote: Badge «Top»

const VORSCHLAEGE_STICHWORT = [
  'Grafik', 'Kommunikationsdesign', 'Gestalter', 'Werbetechnik', 'Signaletik', 'Content Creator',
  'Social Media', 'Mediamatik', 'Digitale Medien', 'Multimedia', 'Visual Design', 'Layout',
  'Typografie', 'Polygraf', 'Branding', 'Illustration', 'Webdesign', 'UX', 'UI',
  'Interaction Design', 'Art Direction', 'Motion Design', '3D', 'Game Design'
];
// Starter-Pakete: ein Tipp statt viele einzelne Stichwörter
const PAKETE = {
  'Grafik & Print': [['Grafik', 'stark'], ['Layout', 'mittel'], ['Typografie', 'mittel'], ['Gestalter', 'mittel'], ['Polygraf', 'leicht']],
  'UX/UI & Digital': [['UX', 'stark'], ['UI', 'stark'], ['Interaction Design', 'stark'], ['Webdesign', 'mittel'], ['Digitale Medien', 'leicht']],
  'Marke & Kommunikation': [['Kommunikationsdesign', 'stark'], ['Branding', 'stark'], ['Visual Design', 'mittel'], ['Art Direction', 'mittel']],
  'Content & Social Media': [['Content Creator', 'stark'], ['Social Media', 'stark'], ['Multimedia', 'mittel'], ['Mediamatik', 'leicht']],
  'Motion & 3D': [['Motion Design', 'stark'], ['3D', 'mittel'], ['Illustration', 'leicht'], ['Game Design', 'leicht']]
};
// Wörter, die beim «Passt nicht» nicht zum Ausblenden angeboten werden
const FUELLWOERTER = ['designer', 'design', 'designerin', 'junior', 'senior', 'stelle', 'team', 'gmbh', 'mwd', 'oder', 'und', 'mit', 'für', 'als', 'unser', 'unsere', 'ihre'];

const VORSCHLAEGE_AUSSCHLUSS = [
  'Maschinen', 'Konstrukteur', 'Elektro', 'Engineer', 'Entwickler', 'Developer', 'Interior',
  'Mode', 'Fashion', 'Verkauf', 'Sales', 'Lehrstelle', 'Lernende', 'Praktikum'
];
const VORSCHLAEGE_ABWERTEND = ['Product Designer', '3D', 'Motion', 'Game'];

// Punkte je Gewicht eines Stichworts im Titel
const GEWICHTE = { stark: 25, mittel: 15, leicht: 8 };
// Punkte je Wertung eines Ortes
const NAEHE = { nah: 20, mittel: 12, weit: 5 };
const STUFEN = {
  einsteiger: ['Einsteiger', 'Erste Berufserfahrung oder Berufseinstieg'],
  junior: ['Junior', 'Bis ca. 2 Jahre Erfahrung'],
  mid: ['Mid', 'Selbstständig, mehrere Jahre Erfahrung'],
  senior: ['Senior', 'Langjährige Erfahrung, fachliche Führung']
};

// Wörter im Stellentitel
const WOERTER_SENIOR = ['senior', 'sr.'];
const WOERTER_LEAD = ['head', 'lead', 'leiter', 'leitung', 'director', 'direktor', 'principal', 'chief'];
const WOERTER_JUNIOR = ['junior', 'einsteiger', 'berufseinsteiger'];
const WOERTER_MID = ['mid', 'medior'];
// Diese Wörter dürfen auch Teil eines Wortes sein (Teamleiter, Tech-Lead)
const WORT_TEIL = ['lead', 'leiter', 'leitung', 'director', 'direktor'];

// Englische Titel (v. a. LinkedIn): Stichwort zählt auch, wenn die Übersetzung im Titel steht
const ALIAS = {
  grafik: ['graphic'],
  kommunikationsdesign: ['communication design'],
  typografie: ['typography'],
  illustration: ['illustrator'],
  'digitale medien': ['digital media'],
  'art direction': ['art director'],
  'motion design': ['motion designer']
};
const QUELLEN_NAME = { jobscout: 'JobScout24', jobsch: 'jobs.ch', jobup: 'jobup.ch', linkedin: 'LinkedIn', persoenlich: 'persoenlich.com' };

/* ---------- Zustand ---------- */
let profil = null;      // gespeichertes Profil oder null
let jobs = [];          // zuletzt geladene Stellen
let stand = null;       // Zeitpunkt der letzten Aktualisierung
let offline = false;    // true, wenn Daten aus dem Cache stammen
let live = false;       // true = echte Stellen von /api/jobs, false = Beispieldaten
let ausgeblendet = [];  // Schlüssel der weggeklickten Stellen

/* ---------- Hilfsfunktionen ---------- */
const $ = (id) => document.getElementById(id);

// Element mit Text erstellen (kein innerHTML, damit nichts eingeschleust wird)
function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

function knopf(text, klasse, onClick) {
  const b = el('button', klasse, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function uhrzeit(zeit) {
  return new Date(zeit).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

function lesen(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function schreiben(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); } catch (e) { /* Speicher voll oder gesperrt */ }
}

/* ---------- Text-Erkennung ---------- */

// Prüft, ob ein Wort im Text vorkommt. Gross-/Kleinschreibung egal.
// Vorne muss eine Wortgrenze sein (damit «UI» nicht in «Guide» gefunden wird).
// Hinten darf das Wort weitergehen («Grafik» findet «Grafikdesigner:in»),
// ausser bei kurzen Wörtern bis 4 Zeichen und Abkürzungen («UI», «3D», «Mode», «sr.»).
function enthaelt(text, wort) {
  const w = String(wort).toLowerCase().trim();
  if (!w) return false;
  const maskiert = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const links = WORT_TEIL.includes(w) ? '' : '(?<![\\p{L}\\p{N}])';
  const rechts = (w.length <= 4 || w.endsWith('.')) && !WORT_TEIL.includes(w) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(links + maskiert + rechts, 'u').test(String(text).toLowerCase());
}

// Pensum aus Text lesen: «60–80 %», «60 bis 80%», «60 - 80 %», «80%».
// Ergebnis {von, bis} oder null, wenn nichts Brauchbares drinsteht.
function parsePensum(text) {
  if (typeof text !== 'string') return null;
  const ok = (n) => n >= 5 && n <= 100;
  const bereich = text.match(/(\d{1,3})\s*(?:%\s*)?(?:[-–—]|bis)\s*(\d{1,3})\s*%/i);
  if (bereich) {
    const von = Number(bereich[1]);
    const bis = Number(bereich[2]);
    if (ok(von) && ok(bis) && von <= bis) return { von, bis };
  }
  const einzeln = text.match(/(\d{1,3})\s*%/);
  if (einzeln && ok(Number(einzeln[1]))) return { von: Number(einzeln[1]), bis: Number(einzeln[1]) };
  return null;
}

// Pensum einer Stelle: zuerst das Pensum-Feld, sonst der Titel («Webdesigner 70–90%»)
function pensumVon(job) {
  return parsePensum(job.pensum) || parsePensum(job.titel);
}

function pensumText(p) {
  if (!p) return 'Pensum offen';
  return p.von === p.bis ? `${p.von} %` : `${p.von}–${p.bis} %`;
}

// Stichwort oder eine seiner Übersetzungen im Titel?
function trifftStichwort(titel, wort) {
  return [wort, ...(ALIAS[String(wort).toLowerCase()] || [])].some((w) => enthaelt(titel, w));
}

// Datum einer Stelle als Zeitstempel (null, wenn das Portal keins nennt)
function datumVon(job) {
  const t = job.datum ? new Date(job.datum).getTime() : NaN;
  return isNaN(t) ? null : t;
}

function pensumPasst(pensum, p) {
  const ueberlappt = pensum.von <= p.pensumBis && pensum.bis >= p.pensumVon;
  const imBereich = pensum.bis <= p.pensumBis || pensum.von < p.pensumBis;
  return ueberlappt && imBereich;
}

/* ---------- Trefferquote ---------- */

// Berechnet die Trefferquote einer Stelle (0–100) für ein Profil.
// Es zählen nur Titel, Ort, Pensum und Datum, denn mehr liefern die Portale nicht.
// Rückgabe: { ausgeblendet, grund, punkte, gruende: [{ wert, text }] }
// «gruende» zeigt im Steckbrief, woher die Punkte kommen.
function matchScore(job, p) {
  const titel = job.titel || '';
  const pensum = pensumVon(job);

  // Ausschlusswort im Titel: Stelle wird ausgeblendet
  const verboten = p.ausschluss.find((w) => enthaelt(titel, w));
  if (verboten) return { ausgeblendet: true, grund: verboten, punkte: 0, gruende: [] };
  // Stelle ohne Pensum-Angabe, aber Schalter steht auf «nein»
  if (!pensum && !p.ohnePensum) return { ausgeblendet: true, grund: 'Pensum fehlt', punkte: 0, gruende: [] };
  // Pensum ausserhalb des Wunschbereichs: ausblenden (Regel aus dem Widget).
  // Bleibt: Stelle liegt ganz im Bereich oder beginnt darin («60–100 %» bei 60–80 %).
  // Fällt weg: «100 %», «80–100 %» bei 60–80 %, «20–40 %» bei 60–80 %.
  if (pensum && !pensumPasst(pensum, p)) return { ausgeblendet: true, grund: 'Pensum', punkte: 0, gruende: [] };
  // Ohne eigenes Stichwort im Titel passt die Stelle fachlich nicht: ausblenden
  // (sonst reichen Ort + Frische + Basis schon für 60 %)
  const treffer = p.stichwoerter.filter((k) => trifftStichwort(titel, k.wort));
  if (!treffer.length) return { ausgeblendet: true, grund: 'Kein Stichwort', punkte: 0, gruende: [] };

  let summe = 30; // Basis
  const gruende = [];
  const add = (wert, text) => { if (wert) { summe += wert; gruende.push({ wert, text }); } };

  // 1. Stichwörter im Titel: bester Treffer volle Punkte, jeder weitere die Hälfte
  treffer
    .map((k) => ({ wort: k.wort, punkte: GEWICHTE[k.gewicht] }))
    .sort((a, b) => b.punkte - a.punkte)
    .forEach((t, i) => add(i === 0 ? t.punkte : Math.round(t.punkte / 2), t.wort));

  // 2. Erfahrungsstufe aus Wörtern im Titel
  const istSenior = WOERTER_SENIOR.some((w) => enthaelt(titel, w));
  const istLead = WOERTER_LEAD.some((w) => enthaelt(titel, w));
  const istJunior = WOERTER_JUNIOR.some((w) => enthaelt(titel, w));
  const istMid = WOERTER_MID.some((w) => enthaelt(titel, w));
  if (p.erfahrung === 'einsteiger' || p.erfahrung === 'junior') {
    if (istJunior) add(10, STUFEN[p.erfahrung][0]);
    if (istSenior) add(-30, 'Senior');
    if (istLead) add(-40, 'Lead');
  } else if (p.erfahrung === 'mid') {
    if (istMid) add(10, 'Mid');
    if (istLead) add(-20, 'Lead');
  } else { // senior
    if (istSenior || istLead) add(10, 'Senior');
    if (istJunior) add(-10, 'Junior');
  }

  // 3. Abwertende Wörter: je −10
  p.abwertend.filter((w) => enthaelt(titel, w)).forEach((w) => add(-10, w));

  // 4. Pensum: ganz im Wunschbereich +15, teilweise überlappend +5, unbekannt 0
  if (pensum) {
    if (pensum.von >= p.pensumVon && pensum.bis <= p.pensumBis) add(15, 'Pensum');
    else if (pensum.von <= p.pensumBis && pensum.bis >= p.pensumVon) add(5, 'Pensum teilweise');
  }

  // 5. Ort: beste Wertung unter allen passenden Orten (nah 20, mittel 12, weit 5)
  //    Zählt auch, wenn das Portal die Stelle bei der Suche nach diesem Ort gefunden hat
  //    (z. B. Weinfelden bei der Suche «Frauenfeld»).
  const suchOrte = Array.isArray(job.suchOrte) ? job.suchOrte : [];
  const orte = p.orte
    .filter((o) => enthaelt(job.ort || '', o.name) || suchOrte.some((s) => gleich(s, o.name)))
    .sort((a, b) => NAEHE[b.naehe] - NAEHE[a.naehe]);
  if (orte.length) add(NAEHE[orte[0].naehe], orte[0].name);

  // 6. Frische: bis 7 Tage +10, bis 21 Tage +5 (ohne Datum: 0)
  const datum = datumVon(job);
  if (datum !== null) {
    const tage = (Date.now() - datum) / 86400000;
    if (tage <= 7) add(10, 'Frisch');
    else if (tage <= 21) add(5, 'Frisch');
  }

  // Auf 0–100 begrenzen
  return { ausgeblendet: false, punkte: Math.max(0, Math.min(100, Math.round(summe))), gruende };
}

// «+25 Grafik · +20 Frauenfeld · −30 Senior»
function gruendeText(gruende) {
  return gruende.map((g) => `${g.wert > 0 ? '+' : '−'}${Math.abs(g.wert)} ${g.text}`).join(' · ');
}

function klasseFuer(quote) {
  if (quote >= TOP_AB) return 'hoch';
  if (quote >= 50) return 'mittel';
  return 'tief';
}

/* ---------- Profil prüfen und bereinigen ---------- */
// Wird beim Laden aus localStorage und beim Import benutzt.
// Gibt ein sauberes Profil zurück oder null, wenn die Daten nicht passen.
function profilBereinigen(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.stichwoerter) || !Array.isArray(p.orte)) return null;
  const text = (s) => (typeof s === 'string' ? s.trim().slice(0, 60) : '');
  const wortliste = (a) => (Array.isArray(a) ? a.map(text).filter(Boolean).slice(0, 50) : []);

  const stichwoerter = p.stichwoerter
    .map((k) => ({ wort: text(k && k.wort), gewicht: k && k.gewicht }))
    .filter((k) => k.wort && Object.hasOwn(GEWICHTE, k.gewicht))
    .slice(0, 50);
  const orte = p.orte
    .map((o) => ({ name: text(o && o.name), naehe: o && o.naehe }))
    .filter((o) => o.name && Object.hasOwn(NAEHE, o.naehe))
    .slice(0, 5);
  const von = Number(p.pensumVon);
  const bis = Number(p.pensumBis);

  if (!stichwoerter.length || !orte.length) return null;
  if (!Object.hasOwn(STUFEN, p.erfahrung)) return null;
  if (!(von >= 10 && bis <= 100 && von <= bis)) return null;
  if (typeof p.ohnePensum !== 'boolean') return null;

  return {
    stichwoerter, erfahrung: p.erfahrung, orte,
    pensumVon: von, pensumBis: bis, ohnePensum: p.ohnePensum,
    ausschluss: wortliste(p.ausschluss), abwertend: wortliste(p.abwertend)
  };
}

function leeresProfil() {
  return {
    stichwoerter: [], erfahrung: 'junior', orte: [],
    pensumVon: 60, pensumBis: 80, ohnePensum: true, ausschluss: [], abwertend: []
  };
}

/* ---------- Stellen laden ---------- */
async function ladeJobs() {
  // Skeleton nur zeigen, wenn noch nichts angezeigt wird
  if (!jobs.length && profil) zeigeSkeleton();
  try {
    const echt = profil ? await ladeLive() : null;
    if (echt) {
      jobs = echt;
      live = true;
    } else {
      jobs = await ladeDemo();
      live = false;
    }
    stand = Date.now();
    offline = false;
    schreiben(KEY_CACHE, { stand, jobs, live });
  } catch (e) {
    // Keine Verbindung: zuletzt geladene Stellen aus localStorage
    const cache = lesen(KEY_CACHE);
    if (cache && Array.isArray(cache.jobs)) {
      jobs = cache.jobs;
      stand = cache.stand;
      live = !!cache.live;
    } else {
      jobs = [];
      stand = null;
    }
    offline = true;
  }
  zeigeListe();
}

// Echte Stellen von der Vercel-Funktion /api/jobs.
// Suchbegriffe = Stichwörter (stärkste zuerst), Orte = Orte aus dem Profil.
// Pro Aufruf höchstens ~10 Kombinationen aus Begriff × Ort (× 4 Portale).
// Rückgabe null, wenn es die Funktion nicht gibt (lokal mit python-Server) → Beispieldaten.
async function ladeLive() {
  const rang = { stark: 0, mittel: 1, leicht: 2 };
  const orte = [...profil.orte].sort((a, b) => NAEHE[b.naehe] - NAEHE[a.naehe]).map((o) => o.name);
  const anzahl = Math.min(5, Math.max(1, Math.floor(10 / orte.length)));
  const begriffe = [...profil.stichwoerter].sort((a, b) => rang[a.gewicht] - rang[b.gewicht])
    .slice(0, anzahl).map((k) => k.wort);
  const url = `api/jobs?terms=${encodeURIComponent(begriffe.join(','))}&places=${encodeURIComponent(orte.join(','))}`;

  let res;
  try { res = await fetch(url); } catch (e) { throw e; } // offline → Cache
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const daten = await res.json();
  if (!daten || !Array.isArray(daten.jobs)) throw new Error('Ungültige Antwort');
  return daten.jobs;
}

// Beispieldaten aus data/jobs.json (für die lokale Entwicklung)
async function ladeDemo() {
  const res = await fetch('data/jobs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const daten = await res.json();
  // Datum so verschieben, dass die neuste Stelle ca. 1 h alt ist
  const neuste = Math.max(...daten.map((j) => new Date(j.datum).getTime()));
  const verschiebung = Date.now() - 60 * 60 * 1000 - neuste;
  return daten.map((j) => ({ ...j, datum: new Date(new Date(j.datum).getTime() + verschiebung).toISOString() }));
}

/* ---------- Anzeige ---------- */
function zeigeSkeleton() {
  const liste = $('liste');
  liste.setAttribute('aria-busy', 'true');
  liste.replaceChildren(...[1, 2, 3].map(() => el('div', 'skeleton')));
}

function zeigeKopf() {
  $('stand').textContent = stand ? `Zuletzt aktualisiert: ${uhrzeit(stand)}${live ? '' : ' · Beispieldaten'}` : '';
  const banner = $('offline');
  if (offline && stand) {
    banner.textContent = `Offline – Stand: ${uhrzeit(stand)}`;
    banner.hidden = false;
  } else if (offline) {
    banner.textContent = 'Offline – keine gespeicherten Stellen vorhanden.';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function zeigeListe() {
  const liste = $('liste');
  liste.setAttribute('aria-busy', 'false');
  zeigeKopf();
  if (!profil) { liste.replaceChildren(); return; }

  // Ausgeblendete Stellen entfernen, Rest absteigend nach Trefferquote (bei Gleichstand: neuste zuerst)
  const treffer = jobs
    .filter((j) => !ausgeblendet.includes(jobKey(j)))
    .map((j) => ({ job: j, score: matchScore(j, profil) }))
    .filter((t) => !t.score.ausgeblendet)
    // Neueste zuerst; Stellen ohne Datum ans Ende, bei gleichem Datum die höhere Quote
    .sort((a, b) => (datumVon(b.job) || 0) - (datumVon(a.job) || 0) || b.score.punkte - a.score.punkte);

  if (!treffer.length) {
    const box = el('div', 'leer');
    box.append(el('h2', '', 'Keine Treffer'));
    box.append(el('p', '', jobs.length
      ? 'Mit deinem Profil gibt es aktuell keine passenden Stellen.'
      : 'Es konnten keine Stellen geladen werden.'));
    if (jobs.length) box.append(knopf('Profil anpassen', 'btn', oeffneProfil));
    liste.replaceChildren(box);
    return;
  }

  // Gute Treffer oben, der Rest eingeklappt. So muss niemand selbst aussortieren.
  const gut = treffer.filter((t) => t.score.punkte >= PASST_AB);
  const rest = treffer.filter((t) => t.score.punkte < PASST_AB);
  const teile = [];
  if (gut.length) {
    teile.push(el('p', 'liste-titel', `${gut.length} passende ${gut.length === 1 ? 'Stelle' : 'Stellen'} · neueste zuerst`));
    gut.forEach(({ job, score }) => teile.push(karte(job, score)));
  } else {
    const box = el('div', 'leer leer-klein');
    box.append(el('p', '', 'Gerade keine Stelle über ' + PASST_AB + ' %. Unten findest du die nächstbesten.'));
    teile.push(box);
  }
  if (rest.length) {
    const det = el('details', 'weitere');
    det.open = !gut.length;
    det.append(el('summary', '', `Weitere Stellen (${rest.length})`));
    rest.forEach(({ job, score }) => det.append(karte(job, score)));
    teile.push(det);
  }
  liste.replaceChildren(...teile);
}

// «heute», «gestern», «vor 3 Tagen»
function alterText(job) {
  const d = datumVon(job);
  if (d === null) return 'Datum unbekannt';
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const tag = new Date(d); tag.setHours(0, 0, 0, 0);
  const n = Math.round((heute - tag) / 86400000);
  if (n <= 0) return 'Heute';
  if (n === 1) return 'Gestern';
  if (n < 7) return `Vor ${n} Tagen`;
  return tag.toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
}

// Eindeutiger Schlüssel einer Stelle (auch für Beispieldaten ohne Portal-ID)
function jobKey(job) {
  return String(job.id || '') + '|' + String(job.titel || '').toLowerCase() + '|' + String(job.firma || '').toLowerCase();
}

// Kurz und verständlich, warum eine Stelle passt: «Grafik · Lenzburg · 60–80 %»
function begruendung(job, score) {
  const plus = score.gruende.filter((g) => g.wert > 0 && g.text !== 'Frisch')
    .map((g) => (g.text.startsWith('Pensum') ? pensumText(pensumVon(job)) : g.text));
  const minus = score.gruende.filter((g) => g.wert < 0).map((g) => g.text);
  return { plus: plus.slice(0, 3), minus: minus.slice(0, 2) };
}

function karte(job, score) {
  const quote = score.punkte;
  const jung = datumVon(job) !== null && Date.now() - datumVon(job) < NEU_MS;
  const k = el('button', `karte ${klasseFuer(quote)}`);
  k.type = 'button';
  k.setAttribute('aria-label', `${job.titel}, ${job.firma}, Trefferquote ${quote} Prozent. Steckbrief öffnen`);

  const text = el('div', 'karte-text');
  const titel = el('div', 'karte-titel', job.titel);
  if (quote >= TOP_AB) titel.append(el('span', 'badge-top', 'Top'));
  if (jung) titel.append(el('span', 'badge-neu', 'Neu'));
  text.append(el('div', 'karte-alter', alterText(job)), titel, el('div', 'karte-meta', [job.firma, job.ort, pensumText(pensumVon(job))].filter(Boolean).join(' · ')));
  const b = begruendung(job, score);
  if (b.plus.length || b.minus.length) {
    const g = el('div', 'karte-grund');
    if (b.plus.length) g.append(el('span', 'grund-plus', '✓ ' + b.plus.join(' · ')));
    if (b.minus.length) g.append(el('span', 'grund-minus', '– ' + b.minus.join(' · ')));
    text.append(g);
  }

  const q = el('div', 'quote', String(quote));
  q.append(el('small', '', ' %'));

  k.append(text, q);
  k.addEventListener('click', () => oeffneSteckbrief(job, score));
  return k;
}

/* ---------- Steckbrief ---------- */
function oeffneSteckbrief(job, score) {
  const box = $('sb-inhalt');
  const quote = score.punkte;
  const titel = el('h2', '', job.titel);
  titel.id = 'sb-titel';

  const q = el('p', `sb-quote ${klasseFuer(quote)}`, `${quote} % Trefferquote`);

  const dl = el('dl', 'sb-liste');
  const zeilen = [
    ['Firma', job.firma],
    ['Ort', job.ort],
    ['Pensum', pensumText(pensumVon(job))],
    ['Veröffentlicht', datumVon(job) !== null
      ? new Date(datumVon(job)).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'unbekannt']
  ];
  if (Array.isArray(job.quellen) && job.quellen.length) {
    zeilen.push(['Gefunden auf', job.quellen.map((q) => QUELLEN_NAME[q] || q).join(', ')]);
  }
  zeilen.forEach(([k, v]) => dl.append(el('dt', '', k), el('dd', '', v)));

  // Woher die Punkte kommen
  const punkte = el('div', 'sb-punkte');
  punkte.append(el('h3', '', 'So kommt die Quote zustande'));
  punkte.append(el('p', 'sb-gruende', score.gruende.length ? gruendeText(score.gruende) : 'Keine Übereinstimmung'));
  punkte.append(el('p', 'hinweis', 'Basis 30 Punkte, begrenzt auf 0–100.'));

  box.replaceChildren(titel, q, dl, punkte);
  if (job.link) {
    const link = el('a', 'btn', 'Zur Stelle');
    link.href = job.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    box.append(link);
  }
  box.append(knopf('Passt nicht', 'btn btn-zweit passt-nicht', () => passtNicht(job)));
  $('steckbrief').showModal();
}

/* ---------- «Passt nicht»: Stelle ausblenden und daraus lernen ---------- */
function passtNicht(job) {
  ausgeblendet = [...ausgeblendet.filter((k) => k !== jobKey(job)), jobKey(job)].slice(-300);
  schreiben(KEY_AUSGEBLENDET, ausgeblendet);
  zeigeListe();

  // Wörter aus dem Titel anbieten, damit ähnliche Stellen künftig gar nicht erscheinen
  const woerter = [...new Set(String(job.titel).split(/[^\p{L}0-9]+/u).filter(Boolean))]
    .filter((w) => w.length >= 4 && !FUELLWOERTER.includes(w.toLowerCase()))
    .filter((w) => !profil.stichwoerter.some((k) => trifftStichwort(w, k.wort)))
    .slice(0, 8);

  const box = $('sb-inhalt');
  const h = el('h2', '', 'Ausgeblendet');
  h.id = 'sb-titel';
  box.replaceChildren(h, el('p', 'hinweis', 'Die Stelle erscheint nicht mehr.'));
  if (woerter.length) {
    box.append(el('h3', '', 'Solche Stellen künftig ausblenden?'));
    box.append(el('p', 'hinweis', 'Tippe Wörter an, die du nie im Stellentitel sehen willst.'));
    const hat = (w) => profil.ausschluss.some((x) => gleich(x, w));
    const zeichneChips = () => {
      const g = chipGruppe(woerter, hat, (w) => {
        profil.ausschluss = hat(w) ? profil.ausschluss.filter((x) => !gleich(x, w)) : [...profil.ausschluss, w];
        schreiben(KEY_PROFIL, profil);
        zeigeListe();
        g.replaceWith(zeichneChips());
      }, 'Wörter ausblenden');
      return g;
    };
    box.append(zeichneChips());
  }
  box.append(knopf('Fertig', 'btn', () => $('steckbrief').close()));
}

/* ---------- Profil-Dialog: Onboarding und Verwalten ---------- */
// Ansichten: 'start', 1–4 (Schritte), 'zusammenfassung', 'loeschen'
let ansicht = 'start';
let entwurf = leeresProfil();  // Arbeitskopie, wird erst beim Speichern übernommen
let bearbeiten = false;        // true, wenn ein Schritt aus der Zusammenfassung geöffnet wurde
let meldung = null;            // { typ: 'fehler' | 'ok', text }
let cvText = '';
let cvVorschlaege = null;      // null = noch nicht abgeglichen
let cvStatus = null;           // { typ: 'laeuft' | 'fehler' | 'ok', text }

function oeffneProfil() {
  cvText = '';
  cvVorschlaege = null;
  bearbeiten = false;
  meldung = null;
  if (profil) {
    entwurf = JSON.parse(JSON.stringify(profil));
    ansicht = 'zusammenfassung';
  } else {
    entwurf = leeresProfil();
    ansicht = 'start';
  }
  zeichne();
  $('profil').showModal();
  $('profil').scrollTop = 0;
}

function gehe(neu) {
  ansicht = neu;
  gpsStatus = null;
  cvStatus = null;
  meldung = null;
  zeichne();
  $('profil').scrollTop = 0;
}

function zeichne(fokusId) {
  const box = $('pf-inhalt');
  box.replaceChildren();
  $('pf-x').hidden = !profil; // Beim ersten Start kann die Seite nicht geschlossen werden
  $('profil').classList.toggle('ist-start', ansicht === 'start');

  if (ansicht === 'start') zeichneStart(box);
  else if (ansicht === 'zusammenfassung') zeichneZusammenfassung(box);
  else if (ansicht === 'loeschen') zeichneLoeschen(box);
  else {
    // Fortschrittsanzeige
    const fort = el('div', 'fortschritt');
    fort.setAttribute('role', 'progressbar');
    fort.setAttribute('aria-valuemin', '1');
    fort.setAttribute('aria-valuemax', '4');
    fort.setAttribute('aria-valuenow', String(ansicht));
    fort.setAttribute('aria-label', `Schritt ${ansicht} von 4`);
    // 4 Segmente: erledigt, aktuell, offen
    [1, 2, 3, 4].forEach((n) => fort.append(el('span', n < ansicht ? 'fertig' : n === ansicht ? 'aktuell' : '')));
    const namen = ['Was du machst', 'Erfahrung', 'Wo und wie viel', 'Was du nicht willst'];
    box.append(el('p', 'schritt-text', `Schritt ${ansicht} von 4 · ${namen[ansicht - 1]}`), fort);
    [schritt1, schritt2, schritt3, schritt4][ansicht - 1](box);
    zeichneNavigation(box);
  }
  if (fokusId && $(fokusId)) $(fokusId).focus();
}

function titelZeile(box, text) {
  const h = el('h2', '', text);
  h.id = 'pf-titel';
  box.append(h);
}

function zeigeMeldung(box) {
  if (!meldung) return;
  const m = el('p', meldung.typ === 'ok' ? 'erfolg' : 'fehler', meldung.text);
  m.setAttribute('role', meldung.typ === 'ok' ? 'status' : 'alert');
  box.append(m);
}

/* --- Start-Screen --- */
function zeichneStart(box) {
  const hero = el('div', 'start-hero');
  // Radar-Zeichen (dekorativ)
  const marke = el('div', 'start-marke');
  marke.setAttribute('aria-hidden', 'true');
  marke.innerHTML = '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="32" cy="32" r="26" opacity=".35"/><circle cx="32" cy="32" r="16" opacity=".6"/><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M32 32 L52 16"/><circle cx="46" cy="22" r="3.5" fill="currentColor" stroke="none"/></svg>';
  const h = el('h2', 'start-titel', 'Alle Kreativ-Jobs.');
  h.id = 'pf-titel';
  h.append(el('br'), el('span', '', 'Ein Ort. Stündlich neu.'));
  hero.append(marke, el('p', 'start-name', 'Jobradar'), h, el('p', 'start-lead',
    'Schluss mit zig Jobportalen. Jobradar durchsucht jobs.ch, jobup.ch, JobScout24, LinkedIn und persoenlich.com für dich und zeigt zuerst, was wirklich passt.'));
  box.append(hero);

  const vorteile = el('ul', 'start-vorteile');
  [
    ['1', 'In 2 Minuten eingerichtet', 'Wähle ein Paket wie «Grafik & Print» und deine Orte.'],
    ['%', 'Trefferquote mit Begründung', 'Du siehst sofort, warum eine Stelle passt.'],
    ['↑', 'Neueste Stellen zuoberst', 'Damit du dich als Erste:r bewirbst.']
  ].forEach(([icon, titel, text]) => {
    const li = el('li');
    const i = el('span', 'vorteil-icon', icon);
    i.setAttribute('aria-hidden', 'true');
    const t = el('div');
    t.append(el('strong', '', titel), el('span', '', text));
    li.append(i, t);
    vorteile.append(li);
  });
  box.append(vorteile);

  zeigeMeldung(box);
  const aktionen = el('div', 'aktionen start-aktionen');
  aktionen.append(
    knopf('Los geht’s', 'btn btn-gross', () => gehe(1)),
    knopf('Profil importieren (.json)', 'link-btn', () => $('pf-datei').click())
  );
  box.append(aktionen, el('p', 'start-fuss', 'Kein Login. Dein Profil bleibt auf diesem Gerät.'));
}

/* --- Bausteine für die Schritte --- */
function chipGruppe(vorschlaege, istAktiv, umschalten, label) {
  const g = el('div', 'chips');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  vorschlaege.forEach((w) => {
    const c = knopf(w, 'chip', () => umschalten(w));
    c.setAttribute('aria-pressed', String(istAktiv(w)));
    g.append(c);
  });
  return g;
}

function segment(optionen, aktuell, onWahl, label) {
  const g = el('div', 'segment');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  optionen.forEach((o) => {
    const b = knopf(o, '', () => onWahl(o));
    b.setAttribute('aria-pressed', String(o === aktuell));
    g.append(b);
  });
  return g;
}

function entfernenKnopf(name, onClick) {
  const b = knopf('✕', 'entfernen', onClick);
  b.setAttribute('aria-label', `${name} entfernen`);
  return b;
}

// Eingabefeld mit «Hinzufügen»-Knopf (auch per Enter)
function eigenesFeld(id, platzhalter, onAdd, deaktiviert) {
  const zeile = el('div', 'eigen');
  const input = el('input');
  input.type = 'text';
  input.id = id;
  input.placeholder = platzhalter;
  input.maxLength = 60;
  input.setAttribute('aria-label', platzhalter);
  input.disabled = !!deaktiviert;
  const add = () => { const w = input.value.trim(); if (w) onAdd(w); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const b = knopf('Hinzufügen', 'btn btn-zweit', add);
  b.disabled = !!deaktiviert;
  zeile.append(input, b);
  return zeile;
}

const gleich = (a, b) => a.toLowerCase() === b.toLowerCase();

/* --- CV lesen: PDF, Word (.docx) oder Text --- */
// Die Datei wird nur im Browser gelesen und nie hochgeladen.
// Bibliotheken liegen im Projekt (js/lib) und werden erst beim ersten Upload geladen.
const LIB = (datei) => new URL('js/lib/' + datei, document.baseURI).href;
let pdfjs = null;

function ladeSkript(src) {
  return new Promise((ok, fehler) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = ok;
    sc.onerror = () => fehler(new Error('laden'));
    document.head.append(sc);
  });
}

async function textAusDatei(datei) {
  const name = datei.name.toLowerCase();
  if (datei.size > 10 * 1024 * 1024) throw new Error('zu-gross');
  if (name.endsWith('.txt') || datei.type === 'text/plain') return datei.text();

  if (name.endsWith('.pdf') || datei.type === 'application/pdf') {
    if (!pdfjs) {
      pdfjs = await import(LIB('pdf.min.mjs'));
      pdfjs.GlobalWorkerOptions.workerSrc = LIB('pdf.worker.min.mjs');
    }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await datei.arrayBuffer()) }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const inhalt = await (await doc.getPage(i)).getTextContent();
      text += inhalt.items.map((it) => it.str).join(' ') + '\n';
    }
    return text;
  }

  if (name.endsWith('.docx')) {
    if (!window.JSZip) await ladeSkript(LIB('jszip.min.js'));
    const zip = await window.JSZip.loadAsync(await datei.arrayBuffer());
    const teil = zip.file('word/document.xml');
    if (!teil) throw new Error('format');
    const xml = await teil.async('string');
    return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  throw new Error('format');
}

// Stichwörter aus dem CV-Text (inkl. englischer Begriffe wie «Graphic»)
function cvAbgleichen(hat) {
  cvVorschlaege = VORSCHLAEGE_STICHWORT.filter((w) => !hat(w) && trifftStichwort(cvText, w));
}

async function cvHochladen(datei, hat) {
  cvStatus = { typ: 'laeuft', text: `«${datei.name}» wird gelesen …` };
  zeichne();
  try {
    cvText = (await textAusDatei(datei)).trim();
    if (cvText.length < 30) throw new Error('leer');
    cvAbgleichen(hat);
    cvStatus = { typ: 'ok', text: cvVorschlaege.length
      ? `${cvVorschlaege.length} passende Stichwörter in «${datei.name}» gefunden.`
      : `«${datei.name}» gelesen, aber keine neuen Stichwörter gefunden.` };
  } catch (e) {
    const grund = e && e.message;
    cvStatus = { typ: 'fehler', text:
      grund === 'zu-gross' ? 'Die Datei ist grösser als 10 MB.'
        : grund === 'format' ? 'Bitte eine PDF-, Word- (.docx) oder Textdatei wählen.'
          : grund === 'leer' ? 'In der Datei steht kaum Text. Ist das PDF ein eingescanntes Bild? Dann füge den Text unten ein.'
            : 'Die Datei konnte nicht gelesen werden. Füge den Text unten ein.' };
  }
  zeichne();
}

function cvKarte(box, hat, fuegeHinzu) {
  const karte = el('section', 'cv-karte');
  karte.append(el('strong', 'cv-titel', 'Schneller mit deinem CV'));
  karte.append(el('p', 'hinweis', 'PDF, Word oder Text. Wir schlagen passende Stichwörter vor. Die Datei bleibt auf deinem Gerät.'));

  const input = el('input');
  input.type = 'file';
  input.id = 'pf-cv-datei';
  input.accept = '.pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  input.className = 'unsichtbar';
  input.addEventListener('change', () => {
    const datei = input.files[0];
    input.value = '';
    if (datei) cvHochladen(datei, hat);
  });
  const laeuft = cvStatus && cvStatus.typ === 'laeuft';
  const lab = el('label', 'btn btn-zweit cv-knopf', laeuft ? 'Wird gelesen …' : (cvText ? 'Anderen CV hochladen' : 'CV hochladen'));
  lab.setAttribute('for', 'pf-cv-datei');
  lab.setAttribute('role', 'button');
  lab.tabIndex = 0;
  lab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  karte.append(input, lab);

  if (cvStatus) {
    const m = el('p', cvStatus.typ === 'fehler' ? 'fehler' : cvStatus.typ === 'ok' ? 'erfolg' : 'hinweis', cvStatus.text);
    m.setAttribute('role', 'status');
    karte.append(m);
  }

  // Vorschläge bestätigen oder verwerfen
  if (cvVorschlaege && cvVorschlaege.length) {
    const kopf = el('div', 'cv-kopf');
    kopf.append(el('span', 'hinweis', 'Bestätige, was passt:'),
      knopf('Alle übernehmen', 'mini mini-ja', () => { cvVorschlaege.forEach(fuegeHinzu); cvVorschlaege = []; zeichne(); }));
    karte.append(kopf);
    const ul = el('ul', 'wortliste');
    cvVorschlaege.forEach((w) => {
      const li = el('li', 'wort-zeile');
      const weg = () => { cvVorschlaege = cvVorschlaege.filter((x) => x !== w); };
      const ja = knopf('✓', 'mini mini-ja mini-icon', () => { fuegeHinzu(w); weg(); zeichne(); });
      ja.setAttribute('aria-label', `${w} übernehmen`);
      const nein = knopf('✕', 'mini mini-icon', () => { weg(); zeichne(); });
      nein.setAttribute('aria-label', `${w} verwerfen`);
      li.append(el('span', 'wort-name', w), ja, nein);
      ul.append(li);
    });
    karte.append(ul);
  }

  // Alternative: Text einfügen
  const det = el('details', 'cv');
  det.append(el('summary', '', 'Oder CV-Text einfügen'));
  const ta = el('textarea');
  ta.id = 'pf-cv';
  ta.rows = 5;
  ta.placeholder = 'Text aus deinem Lebenslauf hier einfügen';
  ta.setAttribute('aria-label', 'CV-Text');
  ta.value = cvText;
  ta.addEventListener('input', () => { cvText = ta.value; });
  det.append(ta, knopf('Mit Vorschlägen abgleichen', 'btn btn-zweit', () => {
    cvAbgleichen(hat);
    cvStatus = { typ: cvVorschlaege.length ? 'ok' : 'fehler', text: cvVorschlaege.length
      ? `${cvVorschlaege.length} passende Stichwörter gefunden.` : 'Keine neuen passenden Stichwörter gefunden.' };
    zeichne();
  }));
  karte.append(det);
  box.append(karte);
}

/* --- Schritt 1: Was du machst --- */
function schritt1(box) {
  titelZeile(box, 'Was du machst');
  box.append(el('p', 'hinweis', 'Wähle ein oder mehrere Pakete. Feinjustieren kannst du darunter: Je stärker ein Stichwort, desto mehr Punkte, wenn es im Stellentitel steht.'));

  const hat = (w) => entwurf.stichwoerter.some((k) => gleich(k.wort, w));
  const fuegeHinzu = (w) => { if (!hat(w)) entwurf.stichwoerter.push({ wort: w, gewicht: 'mittel' }); };
  const entferne = (w) => { entwurf.stichwoerter = entwurf.stichwoerter.filter((k) => !gleich(k.wort, w)); };

  // CV hochladen: schnellster Weg zu passenden Stichwörtern
  cvKarte(box, hat, fuegeHinzu);

  // Schnellstart mit Paketen
  box.append(el('h3', '', 'Schnellstart'));
  const pg = el('div', 'chips pakete');
  pg.setAttribute('role', 'group');
  pg.setAttribute('aria-label', 'Starter-Pakete');
  Object.entries(PAKETE).forEach(([name, woerter]) => {
    const aktiv = woerter.every(([w]) => hat(w));
    const c = knopf(name, 'chip chip-paket', () => {
      if (aktiv) woerter.forEach(([w]) => entferne(w));
      else woerter.forEach(([w, g]) => { if (!hat(w)) entwurf.stichwoerter.push({ wort: w, gewicht: g }); });
      zeichne();
    });
    c.setAttribute('aria-pressed', String(aktiv));
    pg.append(c);
  });
  box.append(pg);

  box.append(el('h3', '', 'Einzelne Stichwörter'));
  box.append(chipGruppe(VORSCHLAEGE_STICHWORT, hat, (w) => { if (hat(w)) entferne(w); else fuegeHinzu(w); zeichne(); }, 'Vorschläge'));

  if (entwurf.stichwoerter.length) {
    box.append(el('h3', '', 'Deine Stichwörter'));
    const liste = el('ul', 'wortliste');
    entwurf.stichwoerter.forEach((k) => {
      const li = el('li', 'wort-zeile');
      li.append(
        el('span', 'wort-name', k.wort),
        segment(Object.keys(GEWICHTE), k.gewicht, (g) => { k.gewicht = g; zeichne(); }, `Gewicht für ${k.wort}`),
        entfernenKnopf(k.wort, () => { entferne(k.wort); zeichne(); })
      );
      liste.append(li);
    });
    box.append(liste);
  }

  box.append(el('label', 'feld', 'Eigenes Stichwort'));
  box.lastChild.setAttribute('for', 'pf-eigen');
  box.append(eigenesFeld('pf-eigen', 'z. B. Packaging', (w) => { fuegeHinzu(w); zeichne('pf-eigen'); }));

}

/* --- Schritt 2: Erfahrung --- */
function schritt2(box) {
  titelZeile(box, 'Erfahrung');
  box.append(el('p', 'hinweis', 'Welche Stufe passt zu dir? Danach beurteilt die App Wörter im Stellentitel.'));
  const g = el('div', 'optionen');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Erfahrungsstufe');
  Object.entries(STUFEN).forEach(([key, [name, beschr]]) => {
    const b = el('button', 'option');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(entwurf.erfahrung === key));
    b.append(el('strong', '', name), el('span', '', beschr));
    b.addEventListener('click', () => { entwurf.erfahrung = key; zeichne(); });
    g.append(b);
  });
  box.append(g);
  box.append(el('p', 'hinweis', 'Höhere Stufen im Titel: senior, sr., head, lead, leiter, leitung, director, direktor, principal, chief. Einstieg: junior, einsteiger, berufseinsteiger.'));
}

/* --- Ortssuche mit Vorschlägen --- */
// Gemeinden kommen live vom offiziellen Verzeichnis von swisstopo (geo.admin.ch),
// Kantone stehen hier fest. So wird jeder Ort korrekt geschrieben.
const KANTONE = [
  'Aargau', 'Appenzell Ausserrhoden', 'Appenzell Innerrhoden', 'Basel-Landschaft', 'Basel-Stadt',
  'Bern', 'Freiburg', 'Genf', 'Glarus', 'Graubünden', 'Jura', 'Luzern', 'Neuenburg', 'Nidwalden',
  'Obwalden', 'Schaffhausen', 'Schwyz', 'Solothurn', 'St. Gallen', 'Tessin', 'Thurgau', 'Uri',
  'Waadt', 'Wallis', 'Zug', 'Zürich'
];
const ORT_API = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=gg25&limit=8&searchText=';

/* --- GPS: Standort → Gemeinde und Kanton --- */
// Koordinaten werden nur an swisstopo geschickt, um die Gemeinde zu finden. Nichts wird gespeichert.
const GEMEINDE_API = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify'
  + '?geometryType=esriGeometryPoint&sr=4326&tolerance=0&returnGeometry=false'
  + '&layers=all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill&geometry=';
const KANTON_ABK = {
  AG: 'Aargau', AR: 'Appenzell Ausserrhoden', AI: 'Appenzell Innerrhoden', BL: 'Basel-Landschaft',
  BS: 'Basel-Stadt', BE: 'Bern', FR: 'Freiburg', GE: 'Genf', GL: 'Glarus', GR: 'Graubünden',
  JU: 'Jura', LU: 'Luzern', NE: 'Neuenburg', NW: 'Nidwalden', OW: 'Obwalden', SH: 'Schaffhausen',
  SZ: 'Schwyz', SO: 'Solothurn', SG: 'St. Gallen', TI: 'Tessin', TG: 'Thurgau', UR: 'Uri',
  VD: 'Waadt', VS: 'Wallis', ZG: 'Zug', ZH: 'Zürich'
};
let gpsStatus = null; // { typ: 'laeuft' | 'fehler' | 'ok', text }

function standortHolen() {
  return new Promise((ok, fehler) => {
    if (!('geolocation' in navigator)) { fehler(new Error('kein-gps')); return; }
    navigator.geolocation.getCurrentPosition(ok, fehler, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}

async function gemeindeAus(lat, lon) {
  const res = await fetch(GEMEINDE_API + encodeURIComponent(`${lon},${lat}`));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const daten = await res.json();
  // Es gibt mehrere Jahrgänge (historische Grenzen): den aktuellen nehmen, sonst den neusten
  const alle = daten.results || [];
  const r = alle.find((x) => x.attributes && x.attributes.is_current_jahr)
    || alle.slice().sort((a, b) => ((b.attributes || {}).jahr || 0) - ((a.attributes || {}).jahr || 0))[0];
  if (!r) return null;
  const a = r.attributes || {};
  const name = String(a.gemname || a.name || r.label || '').replace(/\s*\([A-Z]{2}\)$/, '').trim();
  const abk = String(a.kanton || a.ak || '').toUpperCase();
  return name ? { name, kanton: KANTON_ABK[abk] || '' } : null;
}

async function nimmStandort() {
  gpsStatus = { typ: 'laeuft', text: 'Standort wird ermittelt …' };
  zeichne();
  try {
    const pos = await standortHolen();
    const ort = await gemeindeAus(pos.coords.latitude, pos.coords.longitude);
    if (!ort) { gpsStatus = { typ: 'fehler', text: 'Kein Schweizer Ort gefunden. Gib den Ort von Hand ein.' }; zeichne(); return; }
    const neu = [];
    const dazu = (name, naehe) => {
      if (!name || entwurf.orte.length >= 5) return;
      const da = entwurf.orte.find((o) => gleich(o.name, name));
      if (da) { da.naehe = naehe === 'nah' ? 'nah' : da.naehe; return; }
      entwurf.orte.push({ name, naehe });
      neu.push(name);
    };
    dazu(ort.name, 'nah');
    if (ort.kanton && !gleich(ort.kanton, ort.name)) dazu(ort.kanton, 'mittel');
    gpsStatus = { typ: 'ok', text: neu.length ? `Hinzugefügt: ${neu.join(' und ')}` : `${ort.name} ist schon in deiner Liste.` };
  } catch (e) {
    const verweigert = e && e.code === 1;
    gpsStatus = { typ: 'fehler', text: verweigert
      ? 'Standortzugriff nicht erlaubt. Du kannst ihn in den Browser-Einstellungen freigeben oder den Ort von Hand eingeben.'
      : 'Standort konnte nicht ermittelt werden. Gib den Ort von Hand ein.' };
  }
  zeichne();
}

// Liefert { liste: [{ name, info }], offline: bool }
async function sucheOrte(text) {
  const q = text.trim().toLowerCase();
  const kantone = KANTONE.filter((k) => k.toLowerCase().startsWith(q)).map((k) => ({ name: k, info: 'Kanton' }));
  let gemeinden = [];
  let offline = false;
  try {
    const res = await fetch(ORT_API + encodeURIComponent(text.trim()));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const daten = await res.json();
    gemeinden = (daten.results || []).map((r) => {
      // Label z. B. «<b>Frauenfeld (TG)</b>»
      const label = String((r.attrs && r.attrs.label) || '').replace(/<[^>]+>/g, '').trim();
      const m = label.match(/^(.*?)\s*\(([A-Z]{2})\)$/);
      return m ? { name: m[1].trim(), info: m[2] } : { name: label, info: '' };
    }).filter((o) => o.name);
  } catch (e) {
    offline = true;
  }
  // Gemeinden zuerst, gleiche Namen nur einmal
  const liste = [];
  [...gemeinden, ...kantone].forEach((o) => { if (!liste.some((x) => gleich(x.name, o.name))) liste.push(o); });
  return { liste: liste.slice(0, 8), offline };
}

function ortFeld(id, onAdd, deaktiviert) {
  const wrap = el('div', 'ort-feld');
  const zeile = el('div', 'eigen');
  const input = el('input');
  input.type = 'text';
  input.id = id;
  input.placeholder = 'z. B. Frauenfeld';
  input.maxLength = 60;
  input.autocomplete = 'off';
  input.disabled = !!deaktiviert;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id + '-liste');
  const ul = el('ul', 'vorschlaege');
  ul.id = id + '-liste';
  ul.setAttribute('role', 'listbox');
  ul.hidden = true;
  const info = el('p', 'hinweis ort-info');
  info.setAttribute('role', 'status');

  let treffer = [];      // aktuelle Vorschläge
  let aktiv = -1;        // per Pfeiltaste markierter Vorschlag
  let offline = false;   // Verzeichnis nicht erreichbar → freie Eingabe erlaubt
  let laufNr = 0;        // nur die Antwort der letzten Eingabe zählt
  let timer = null;

  const schliesse = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); aktiv = -1; };
  const markiere = (i) => {
    aktiv = i;
    [...ul.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', `${id}-opt-${i}`); ul.children[i].scrollIntoView({ block: 'nearest' }); }
  };
  const zeige = () => {
    ul.replaceChildren(...treffer.map((o, i) => {
      const li = el('li');
      li.id = `${id}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.append(el('span', '', o.name), el('span', 'info', o.info));
      // mousedown statt click: passiert vor dem blur des Eingabefelds
      li.addEventListener('mousedown', (e) => { e.preventDefault(); onAdd(o.name); });
      return li;
    }));
    ul.hidden = !treffer.length;
    input.setAttribute('aria-expanded', String(!!treffer.length));
    aktiv = -1;
  };

  input.addEventListener('input', () => {
    info.textContent = '';
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 2) { treffer = []; schliesse(); return; }
    timer = setTimeout(async () => {
      const nr = ++laufNr;
      const r = await sucheOrte(text);
      if (nr !== laufNr) return;
      treffer = r.liste;
      offline = r.offline;
      zeige();
      if (!treffer.length) info.textContent = offline ? '' : 'Kein Ort gefunden. Bitte Schreibweise prüfen.';
    }, 200);
  });

  // Übernehmen: markierter Vorschlag, genauer Treffer oder erster Vorschlag
  const uebernehmen = () => {
    const text = input.value.trim();
    if (!text) return;
    if (aktiv >= 0) { onAdd(treffer[aktiv].name); return; }
    const genau = treffer.find((o) => gleich(o.name, text));
    if (genau) { onAdd(genau.name); return; }
    if (treffer.length) { onAdd(treffer[0].name); return; }
    if (offline) { onAdd(text); return; } // Verzeichnis nicht erreichbar: wie eingegeben
    info.textContent = 'Bitte wähle einen Ort aus der Liste.';
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && treffer.length) { e.preventDefault(); if (ul.hidden) zeige(); markiere(Math.min(aktiv + 1, treffer.length - 1)); }
    else if (e.key === 'ArrowUp' && treffer.length) { e.preventDefault(); markiere(Math.max(aktiv - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); uebernehmen(); }
    else if (e.key === 'Escape' && !ul.hidden) { e.preventDefault(); e.stopPropagation(); schliesse(); }
  });
  input.addEventListener('blur', () => setTimeout(schliesse, 100));

  const b = knopf('Hinzufügen', 'btn btn-zweit', uebernehmen);
  b.disabled = !!deaktiviert;
  zeile.append(input, b);
  wrap.append(zeile, ul, info);
  return wrap;
}

/* --- Schritt 3: Wo und wie viel --- */
function schritt3(box) {
  titelZeile(box, 'Wo und wie viel');
  box.append(el('p', 'hinweis', 'Bis zu 5 Orte. Wertung: nah = beste Wertung, weit = kleine Wertung.'));

  // GPS: eigener Standort mit einem Tipp
  const gps = knopf('', 'btn btn-zweit gps-btn', nimmStandort);
  gps.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  gps.append(gpsStatus && gpsStatus.typ === 'laeuft' ? 'Standort wird ermittelt …' : 'Meinen Standort verwenden');
  gps.disabled = (gpsStatus && gpsStatus.typ === 'laeuft') || entwurf.orte.length >= 5;
  box.append(gps);
  if (gpsStatus && gpsStatus.typ !== 'laeuft') {
    const m = el('p', gpsStatus.typ === 'ok' ? 'erfolg gps-info' : 'fehler gps-info', gpsStatus.text);
    m.setAttribute('role', 'status');
    box.append(m);
  }

  if (entwurf.orte.length) {
    const liste = el('ul', 'wortliste');
    entwurf.orte.forEach((o) => {
      const li = el('li', 'wort-zeile');
      li.append(
        el('span', 'wort-name', o.name),
        segment(Object.keys(NAEHE), o.naehe, (n) => { o.naehe = n; zeichne(); }, `Wertung für ${o.name}`),
        entfernenKnopf(o.name, () => { entwurf.orte = entwurf.orte.filter((x) => x !== o); zeichne(); })
      );
      liste.append(li);
    });
    box.append(liste);
  }
  const voll = entwurf.orte.length >= 5;
  const lab = el('label', 'feld', voll ? 'Maximal 5 Orte' : `Ort hinzufügen (${entwurf.orte.length}/5)`);
  lab.setAttribute('for', 'pf-ort');
  box.append(lab, ortFeld('pf-ort', (w) => {
    if (!entwurf.orte.some((o) => gleich(o.name, w))) entwurf.orte.push({ name: w, naehe: entwurf.orte.length ? 'mittel' : 'nah' });
    zeichne('pf-ort');
  }, voll));

  // Pensum per Slider
  const out = el('output', '', '');
  out.id = 'pf-pensum-out';
  const l = el('p', 'feld');
  l.append('Pensum: ', out);
  box.append(l);
  const von = el('input');
  const bis = el('input');
  [[von, 'Pensum von', entwurf.pensumVon], [bis, 'Pensum bis', entwurf.pensumBis]].forEach(([i, label, wert]) => {
    i.type = 'range'; i.min = '10'; i.max = '100'; i.step = '5'; i.value = String(wert);
    i.setAttribute('aria-label', label);
  });
  const aktualisiere = () => { out.textContent = pensumText({ von: entwurf.pensumVon, bis: entwurf.pensumBis }); };
  von.addEventListener('input', () => {
    entwurf.pensumVon = Number(von.value);
    if (entwurf.pensumVon > entwurf.pensumBis) { entwurf.pensumBis = entwurf.pensumVon; bis.value = String(entwurf.pensumBis); }
    aktualisiere();
  });
  bis.addEventListener('input', () => {
    entwurf.pensumBis = Number(bis.value);
    if (entwurf.pensumBis < entwurf.pensumVon) { entwurf.pensumVon = entwurf.pensumBis; von.value = String(entwurf.pensumVon); }
    aktualisiere();
  });
  aktualisiere();
  box.append(von, bis);

  const schalter = el('label', 'schalter');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.setAttribute('role', 'switch');
  cb.checked = entwurf.ohnePensum;
  cb.addEventListener('change', () => { entwurf.ohnePensum = cb.checked; });
  schalter.append(cb, el('span', '', 'Stellen ohne Pensum-Angabe anzeigen'));
  box.append(schalter);
}

/* --- Schritt 4: Was du nicht willst --- */
function schritt4(box) {
  titelZeile(box, 'Was du nicht willst');
  wortBlock(box, 'ausschluss', 'Ausschlusswörter', 'Stellen mit diesen Wörtern im Titel werden ausgeblendet.', VORSCHLAEGE_AUSSCHLUSS, 'pf-aus');
  wortBlock(box, 'abwertend', 'Abwertende Wörter', 'Jedes Wort im Titel gibt einen leichten Abzug (−10).', VORSCHLAEGE_ABWERTEND, 'pf-ab');
}

function wortBlock(box, feld, titel, hinweis, vorschlaege, id) {
  box.append(el('h3', '', titel), el('p', 'hinweis', hinweis));
  const hat = (w) => entwurf[feld].some((x) => gleich(x, w));
  const entferne = (w) => { entwurf[feld] = entwurf[feld].filter((x) => !gleich(x, w)); };
  box.append(chipGruppe(vorschlaege, hat, (w) => { if (hat(w)) entferne(w); else entwurf[feld].push(w); zeichne(); }, `Vorschläge ${titel}`));

  // Eigene Wörter (nicht aus den Vorschlägen) als entfernbare Chips
  const eigene = entwurf[feld].filter((w) => !vorschlaege.some((v) => gleich(v, w)));
  if (eigene.length) {
    const g = el('ul', 'chips');
    eigene.forEach((w) => {
      const li = el('li', 'chip-eigen');
      li.append(w, entfernenKnopf(w, () => { entferne(w); zeichne(); }));
      g.append(li);
    });
    box.append(g);
  }
  box.append(eigenesFeld(id, 'Eigenes Wort', (w) => { if (!hat(w)) entwurf[feld].push(w); zeichne(id); }));
}

/* --- Navigation der Schritte --- */
function pruefeSchritt(n) {
  if (n === 1 && !entwurf.stichwoerter.length) return 'Bitte wähle mindestens ein Stichwort.';
  if (n === 3 && !entwurf.orte.length) return 'Bitte gib mindestens einen Ort an.';
  return '';
}

function zeichneNavigation(box) {
  zeigeMeldung(box);
  const weiter = (ziel) => {
    const fehler = pruefeSchritt(ansicht);
    if (fehler) { meldung = { typ: 'fehler', text: fehler }; zeichne(); return; }
    gehe(ziel);
  };
  const z = el('div', 'navzeile');
  z.append(
    knopf('Zurück', 'btn btn-zweit', () => gehe(ansicht === 1 ? (profil || bearbeiten ? 'zusammenfassung' : 'start') : ansicht - 1)),
    knopf(ansicht === 4 ? 'Zusammenfassung' : 'Weiter', 'btn', () => weiter(ansicht === 4 ? 'zusammenfassung' : ansicht + 1))
  );
  box.append(z);
  if (bearbeiten && ansicht !== 4) box.append(knopf('Zur Zusammenfassung', 'link-btn', () => weiter('zusammenfassung')));
}

/* --- Zusammenfassung / Profil verwalten --- */
function zeichneZusammenfassung(box) {
  titelZeile(box, profil ? 'Dein Profil' : 'Zusammenfassung');
  const abschnitte = [
    ['Was du machst', entwurf.stichwoerter.map((k) => `${k.wort} (${k.gewicht})`).join(', ') || '–'],
    ['Erfahrung', STUFEN[entwurf.erfahrung][0]],
    ['Wo und wie viel', `${entwurf.orte.map((o) => `${o.name} (${o.naehe})`).join(', ') || '–'}\nPensum ${pensumText({ von: entwurf.pensumVon, bis: entwurf.pensumBis })} · Ohne Pensum-Angabe: ${entwurf.ohnePensum ? 'anzeigen' : 'ausblenden'}`],
    ['Was du nicht willst', `Ausblenden: ${entwurf.ausschluss.join(', ') || '–'}\nAbwerten: ${entwurf.abwertend.join(', ') || '–'}`]
  ];
  abschnitte.forEach(([name, inhalt], i) => {
    const s = el('section', 'zusammen');
    const kopf = el('div', 'zusammen-kopf');
    kopf.append(el('h3', '', name), knopf('Ändern', 'mini', () => { bearbeiten = true; gehe(i + 1); }));
    kopf.lastChild.setAttribute('aria-label', `${name} ändern`);
    s.append(kopf, el('p', 'zusammen-text', inhalt));
    box.append(s);
  });

  zeigeMeldung(box);
  const speichern = knopf(profil ? 'Änderungen speichern' : 'Profil speichern', 'btn', speichereProfil);
  box.append(speichern);

  if (profil) {
    const sicher = el('div', 'sichern');
    sicher.append(el('h3', '', 'Profil sichern'));
    sicher.append(
      knopf('Exportieren (jobradar-profil.json)', 'btn btn-zweit', exportiereProfil),
      knopf('Importieren (.json)', 'btn btn-zweit', () => $('pf-datei').click()),
      knopf('Profil löschen', 'btn btn-gefahr', () => gehe('loeschen'))
    );
    if (ausgeblendet.length) {
      sicher.append(knopf(`Ausgeblendete Stellen wieder zeigen (${ausgeblendet.length})`, 'btn btn-zweit', () => {
        ausgeblendet = [];
        schreiben(KEY_AUSGEBLENDET, ausgeblendet);
        zeigeListe();
        meldung = { typ: 'ok', text: 'Alle Stellen werden wieder angezeigt.' };
        zeichne();
      }));
    }
    box.append(sicher);
  }
}

function speichereProfil() {
  const sauber = profilBereinigen(entwurf);
  if (!sauber) { meldung = { typ: 'fehler', text: 'Bitte ergänze Stichwörter und mindestens einen Ort.' }; zeichne(); return; }
  profil = sauber;
  schreiben(KEY_PROFIL, profil);
  $('profil').close();
  jobs = [];
  ladeJobs(); // Orte oder Stichwörter können sich geändert haben: neu suchen
}

/* --- Löschen mit Bestätigung --- */
function zeichneLoeschen(box) {
  titelZeile(box, 'Profil löschen?');
  box.append(el('p', 'hinweis', 'Dein Suchprofil wird von diesem Gerät entfernt. Exportiere es vorher, wenn du es behalten willst.'));
  const z = el('div', 'navzeile');
  z.append(
    knopf('Abbrechen', 'btn btn-zweit', () => gehe('zusammenfassung')),
    knopf('Löschen', 'btn btn-gefahr', () => {
      try { localStorage.removeItem(KEY_PROFIL); } catch (e) { /* ignorieren */ }
      profil = null;
      entwurf = leeresProfil();
      bearbeiten = false;
      zeigeListe();
      gehe('start'); // Zurück zum Onboarding
    })
  );
  box.append(z);
}

/* --- Export und Import --- */
function exportiereProfil() {
  const daten = { app: 'jobradar', version: PROFIL_VERSION, exportiert: new Date().toISOString(), profil };
  const blob = new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = 'jobradar-profil.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  meldung = { typ: 'ok', text: 'Profil gespeichert' };
  zeichne();
  setTimeout(() => { if (meldung && meldung.typ === 'ok') { meldung = null; zeichne(); } }, 3000);
}

async function importiereDatei(datei) {
  let neu = null;
  try {
    const daten = JSON.parse(await datei.text());
    if (daten && daten.app === 'jobradar' && daten.version === PROFIL_VERSION) neu = profilBereinigen(daten.profil);
  } catch (e) { neu = null; }

  if (!neu) {
    meldung = { typ: 'fehler', text: 'Datei ist kein gültiges Jobradar-Profil.' };
    zeichne();
    return;
  }
  profil = neu;
  entwurf = JSON.parse(JSON.stringify(neu));
  schreiben(KEY_PROFIL, profil);
  ansicht = 'zusammenfassung';
  meldung = { typ: 'ok', text: 'Profil importiert' };
  zeichne();
  jobs = [];
  ladeJobs();
}

/* ---------- Pop-ups: Schliessen per X, Klick daneben, Escape ---------- */
function richtePopupsEin() {
  document.querySelectorAll('dialog').forEach((d) => {
    d.querySelectorAll('[data-schliessen]').forEach((b) => b.addEventListener('click', () => d.close()));
    // Klick auf den Hintergrund (ausserhalb des Inhalts)
    d.addEventListener('click', (e) => {
      if (e.target === d && (d.id !== 'profil' || profil)) d.close();
    });
  });
  // Escape: Ohne Profil bleibt der Dialog offen
  $('profil').addEventListener('cancel', (e) => { if (!profil) e.preventDefault(); });
}

/* ---------- Start ---------- */
function init() {
  richtePopupsEin();

  $('profil-btn').addEventListener('click', oeffneProfil);
  $('pf-datei').addEventListener('change', (e) => {
    const datei = e.target.files[0];
    e.target.value = ''; // gleiche Datei darf erneut gewählt werden
    if (datei) importiereDatei(datei);
  });

  profil = profilBereinigen(lesen(KEY_PROFIL));
  const weg = lesen(KEY_AUSGEBLENDET);
  ausgeblendet = Array.isArray(weg) ? weg.filter((k) => typeof k === 'string') : [];
  if (!profil) oeffneProfil(); // Kein (gültiges) Profil: Onboarding

  ladeJobs();
  setInterval(ladeJobs, INTERVALL_MS);

  // Verbindung kommt zurück: sofort neu laden
  window.addEventListener('online', ladeJobs);
  window.addEventListener('offline', () => { offline = true; zeigeKopf(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

// Für Tests in Node: Rechenlogik exportieren, ohne die Oberfläche zu starten
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchScore, parsePensum, profilBereinigen, gruendeText };
}
if (typeof document !== 'undefined') init();
