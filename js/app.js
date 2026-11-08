'use strict';

/* ---------- Konstanten ---------- */
const KEY_PROFIL = 'jobradar.profil';
const KEY_CACHE = 'jobradar.cache';
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

/* ---------- Zustand ---------- */
let profil = null;      // gespeichertes Profil oder null
let jobs = [];          // zuletzt geladene Stellen
let stand = null;       // Zeitpunkt der letzten Aktualisierung
let offline = false;    // true, wenn Daten aus dem Cache stammen

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

  let summe = 30; // Basis
  const gruende = [];
  const add = (wert, text) => { if (wert) { summe += wert; gruende.push({ wert, text }); } };

  // 1. Stichwörter im Titel: bester Treffer volle Punkte, jeder weitere die Hälfte
  p.stichwoerter
    .filter((k) => enthaelt(titel, k.wort))
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
  const orte = p.orte.filter((o) => enthaelt(job.ort || '', o.name)).sort((a, b) => NAEHE[b.naehe] - NAEHE[a.naehe]);
  if (orte.length) add(NAEHE[orte[0].naehe], orte[0].name);

  // 6. Frische: bis 7 Tage +10, bis 21 Tage +5
  const tage = (Date.now() - new Date(job.datum).getTime()) / 86400000;
  if (tage <= 7) add(10, 'Frisch');
  else if (tage <= 21) add(5, 'Frisch');

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
    const res = await fetch('data/jobs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const daten = await res.json();

    // Demo-Daten: Datum so verschieben, dass die neuste Stelle ca. 1 h alt ist
    const neuste = Math.max(...daten.map((j) => new Date(j.datum).getTime()));
    const verschiebung = Date.now() - 60 * 60 * 1000 - neuste;
    jobs = daten.map((j) => ({ ...j, datum: new Date(new Date(j.datum).getTime() + verschiebung).toISOString() }));

    stand = Date.now();
    offline = false;
    schreiben(KEY_CACHE, { stand, jobs });
  } catch (e) {
    // Keine Verbindung: zuletzt geladene Stellen aus localStorage
    const cache = lesen(KEY_CACHE);
    if (cache && Array.isArray(cache.jobs)) {
      jobs = cache.jobs;
      stand = cache.stand;
    } else {
      jobs = [];
      stand = null;
    }
    offline = true;
  }
  zeigeListe();
}

/* ---------- Anzeige ---------- */
function zeigeSkeleton() {
  const liste = $('liste');
  liste.setAttribute('aria-busy', 'true');
  liste.replaceChildren(...[1, 2, 3].map(() => el('div', 'skeleton')));
}

function zeigeKopf() {
  $('stand').textContent = stand ? `Zuletzt aktualisiert: ${uhrzeit(stand)}` : '';
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
    .map((j) => ({ job: j, score: matchScore(j, profil) }))
    .filter((t) => !t.score.ausgeblendet)
    .sort((a, b) => b.score.punkte - a.score.punkte || new Date(b.job.datum) - new Date(a.job.datum));

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

  liste.replaceChildren(...treffer.map(({ job, score }) => karte(job, score)));
}

function karte(job, score) {
  const quote = score.punkte;
  const jung = Date.now() - new Date(job.datum).getTime() < NEU_MS;
  const k = el('button', `karte ${klasseFuer(quote)}`);
  k.type = 'button';
  k.setAttribute('aria-label', `${job.titel}, ${job.firma}, Trefferquote ${quote} Prozent. Steckbrief öffnen`);

  const text = el('div', 'karte-text');
  const titel = el('div', 'karte-titel', job.titel);
  if (quote >= TOP_AB) titel.append(el('span', 'badge-top', 'Top'));
  if (jung) titel.append(el('span', 'badge-neu', 'Neu'));
  text.append(titel, el('div', 'karte-meta', `${job.firma} · ${job.ort} · ${pensumText(pensumVon(job))}`));

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
    ['Veröffentlicht', new Date(job.datum).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })]
  ];
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
  $('steckbrief').showModal();
}

/* ---------- Profil-Dialog: Onboarding und Verwalten ---------- */
// Ansichten: 'start', 1–4 (Schritte), 'zusammenfassung', 'loeschen'
let ansicht = 'start';
let entwurf = leeresProfil();  // Arbeitskopie, wird erst beim Speichern übernommen
let bearbeiten = false;        // true, wenn ein Schritt aus der Zusammenfassung geöffnet wurde
let meldung = null;            // { typ: 'fehler' | 'ok', text }
let cvText = '';
let cvVorschlaege = null;      // null = noch nicht abgeglichen

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
  meldung = null;
  zeichne();
  $('profil').scrollTop = 0;
}

function zeichne(fokusId) {
  const box = $('pf-inhalt');
  box.replaceChildren();
  $('pf-x').hidden = !profil; // Beim ersten Start kann der Dialog nicht geschlossen werden

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
    const balken = el('span');
    balken.style.width = `${ansicht * 25}%`;
    fort.append(balken);
    box.append(el('p', 'schritt-text', `Schritt ${ansicht} von 4`), fort);
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
  titelZeile(box, 'Willkommen bei Jobradar');
  box.append(el('p', 'hinweis', 'Erstelle dein Suchprofil. Wir sortieren die Stellen danach. Dein Profil bleibt auf diesem Gerät.'));
  zeigeMeldung(box);
  const aktionen = el('div', 'aktionen');
  aktionen.append(
    knopf('Profil erstellen', 'btn', () => gehe(1)),
    knopf('Profil importieren (.json)', 'btn btn-zweit', () => $('pf-datei').click())
  );
  box.append(aktionen);
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

/* --- Schritt 1: Was du machst --- */
function schritt1(box) {
  titelZeile(box, 'Was du machst');
  box.append(el('p', 'hinweis', 'Tippe passende Stichwörter an und gewichte sie. Je stärker, desto mehr Punkte, wenn das Wort im Stellentitel steht.'));

  const hat = (w) => entwurf.stichwoerter.some((k) => gleich(k.wort, w));
  const fuegeHinzu = (w) => { if (!hat(w)) entwurf.stichwoerter.push({ wort: w, gewicht: 'mittel' }); };
  const entferne = (w) => { entwurf.stichwoerter = entwurf.stichwoerter.filter((k) => !gleich(k.wort, w)); };

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

  // Optional: CV-Text mit den Vorschlägen abgleichen
  const det = el('details', 'cv');
  det.open = cvVorschlaege !== null || !!cvText;
  det.append(el('summary', '', 'Optional: CV-Text einfügen'));
  const ta = el('textarea');
  ta.id = 'pf-cv';
  ta.rows = 5;
  ta.placeholder = 'Text aus deinem Lebenslauf hier einfügen';
  ta.setAttribute('aria-label', 'CV-Text');
  ta.value = cvText;
  ta.addEventListener('input', () => { cvText = ta.value; });
  det.append(ta, knopf('Mit Vorschlägen abgleichen', 'btn btn-zweit', () => {
    cvVorschlaege = VORSCHLAEGE_STICHWORT.filter((w) => !hat(w) && enthaelt(cvText, w));
    zeichne();
  }));
  if (cvVorschlaege !== null) {
    if (!cvVorschlaege.length) det.append(el('p', 'hinweis', 'Keine neuen passenden Stichwörter gefunden.'));
    else {
      det.append(el('p', 'hinweis', 'Gefunden. Bestätige oder verwirf jeden Vorschlag:'));
      const ul = el('ul', 'wortliste');
      cvVorschlaege.forEach((w) => {
        const li = el('li', 'wort-zeile');
        const weg = () => { cvVorschlaege = cvVorschlaege.filter((x) => x !== w); };
        const ja = knopf('Übernehmen', 'mini mini-ja', () => { fuegeHinzu(w); weg(); zeichne(); });
        ja.setAttribute('aria-label', `${w} übernehmen`);
        const nein = knopf('Verwerfen', 'mini', () => { weg(); zeichne(); });
        nein.setAttribute('aria-label', `${w} verwerfen`);
        li.append(el('span', 'wort-name', w), ja, nein);
        ul.append(li);
      });
      det.append(ul);
    }
  }
  box.append(det);
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

/* --- Schritt 3: Wo und wie viel --- */
function schritt3(box) {
  titelZeile(box, 'Wo und wie viel');
  box.append(el('p', 'hinweis', 'Bis zu 5 Orte. Wertung: nah = beste Wertung, weit = kleine Wertung.'));

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
  box.append(lab, eigenesFeld('pf-ort', 'z. B. Frauenfeld', (w) => {
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
    box.append(sicher);
  }
}

function speichereProfil() {
  const sauber = profilBereinigen(entwurf);
  if (!sauber) { meldung = { typ: 'fehler', text: 'Bitte ergänze Stichwörter und mindestens einen Ort.' }; zeichne(); return; }
  profil = sauber;
  schreiben(KEY_PROFIL, profil);
  $('profil').close();
  if (jobs.length) zeigeListe(); else ladeJobs();
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
  if (jobs.length) zeigeListe(); else ladeJobs();
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
