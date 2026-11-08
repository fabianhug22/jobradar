// Jobradar – Scriptable-Widget (iOS)
// Zeigt die neusten Stellen aus data/jobs.json auf dem Home-Bildschirm.
// Einrichten: Scriptable installieren, dieses Skript einfügen, Widget (klein/mittel/gross)
// hinzufügen und als «Script» dieses Skript wählen.
// Optional: Widget-Parameter = Ort-Filter (z. B. «Zürich»), mehrere mit Komma.

// >>> Hier die Adresse deiner gehosteten App eintragen (ohne Slash am Ende)
const BASIS_URL = 'https://DEIN-HOST.example';
const JOBS_URL = BASIS_URL + '/data/jobs.json';
const NEU_MS = 24 * 60 * 60 * 1000;

const FARBE_AKZENT = new Color('#4338ca');
const FARBE_HINTEN = Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e'));
const FARBE_TEXT = Color.dynamic(new Color('#111827'), new Color('#f3f4f6'));
const FARBE_GRAU = Color.dynamic(new Color('#6b7280'), new Color('#9ca3af'));

const ANZAHL = { small: 1, medium: 2, large: 5, extraLarge: 5 };

// ---------- Daten laden (mit Cache für Offline) ----------
async function ladeJobs() {
  const fm = FileManager.local();
  const pfad = fm.joinPath(fm.cacheDirectory(), 'jobradar-jobs.json');
  try {
    const req = new Request(JOBS_URL);
    req.timeoutInterval = 15;
    const jobs = await req.loadJSON();
    if (!Array.isArray(jobs)) throw new Error('Ungültige Daten');
    fm.writeString(pfad, JSON.stringify(jobs));
    return { jobs, offline: false };
  } catch (e) {
    if (fm.fileExists(pfad)) return { jobs: JSON.parse(fm.readString(pfad)), offline: true };
    throw e;
  }
}

function filtern(jobs) {
  const orte = (args.widgetParameter || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return jobs
    .filter((j) => !orte.length || orte.some((o) => (j.ort || '').toLowerCase().includes(o)))
    .sort((a, b) => new Date(b.datum) - new Date(a.datum));
}

function vorZeit(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 60) return 'vor ' + Math.max(min, 1) + ' Min.';
  const h = Math.round(min / 60);
  if (h < 24) return 'vor ' + h + ' Std.';
  const t = Math.round(h / 24);
  return 'vor ' + t + (t === 1 ? ' Tag' : ' Tagen');
}

// ---------- Widget bauen ----------
function baueWidget(jobs, offline) {
  const familie = config.widgetFamily || 'medium';
  const n = ANZAHL[familie] || 2;
  const gross = familie === 'small';

  const w = new ListWidget();
  w.backgroundColor = FARBE_HINTEN;
  w.url = BASIS_URL;
  w.setPadding(12, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);

  const kopf = w.addStack();
  kopf.centerAlignContent();
  const titel = kopf.addText('Jobradar');
  titel.font = Font.boldSystemFont(gross ? 13 : 15);
  titel.textColor = FARBE_AKZENT;
  kopf.addSpacer();
  const neu = jobs.filter((j) => Date.now() - new Date(j.datum) < NEU_MS).length;
  const zaehler = kopf.addText(offline ? 'offline' : neu + ' neu');
  zaehler.font = Font.mediumSystemFont(11);
  zaehler.textColor = FARBE_GRAU;

  w.addSpacer(8);

  const zeige = jobs.slice(0, n);
  if (!zeige.length) {
    const t = w.addText('Keine Stellen gefunden.');
    t.font = Font.systemFont(13);
    t.textColor = FARBE_GRAU;
    return w;
  }

  zeige.forEach((j, i) => {
    const zeile = w.addStack();
    zeile.layoutVertically();
    zeile.url = j.link || BASIS_URL;

    const t = zeile.addText(j.titel);
    t.font = Font.semiboldSystemFont(gross ? 13 : 14);
    t.textColor = FARBE_TEXT;
    t.lineLimit = gross ? 3 : 1;

    const meta = [j.firma, j.ort, vorZeit(j.datum)].filter(Boolean).join(' · ');
    const m = zeile.addText(meta);
    m.font = Font.systemFont(11);
    m.textColor = FARBE_GRAU;
    m.lineLimit = 1;

    if (i < zeige.length - 1) w.addSpacer(8);
  });

  w.addSpacer();
  return w;
}

function fehlerWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = FARBE_HINTEN;
  const t = w.addText('Jobradar');
  t.font = Font.boldSystemFont(14);
  t.textColor = FARBE_AKZENT;
  w.addSpacer(6);
  const m = w.addText('Stellen konnten nicht geladen werden.\n' + msg);
  m.font = Font.systemFont(11);
  m.textColor = FARBE_GRAU;
  return w;
}

// ---------- Start ----------
let widget;
try {
  const { jobs, offline } = await ladeJobs();
  widget = baueWidget(filtern(jobs), offline);
} catch (e) {
  widget = fehlerWidget(String(e.message || e));
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
