# Webcam Montefalcone di Val Fortore

Sito statico per una webcam, pubblicato su GitHub Pages. Non richiede un server Node, installazioni npm o un passaggio di compilazione per la pubblicazione. Il codice è separato in HTML, CSS e moduli JavaScript.

## Pubblicazione

1. Estrarre `webcam-montefalcone-v2.1.zip` sul proprio computer.
2. Aprire `https://github.com/Montefalcone/live`, quindi **Add file → Upload files**.
3. Trascinare **il contenuto** della cartella estratta nella radice della repository, comprese le cartelle `assets`, `js` e `vendor`. Non caricare lo ZIP e non aggiungere una cartella superiore.
4. Confermare il commit. Mantenere la configurazione GitHub Pages già in uso: branch `main`, cartella `/ (root)`.
5. Attendere che la pubblicazione di GitHub Pages termini e ricaricare il sito.

Il file `CNAME` mantiene `www.webcammontefalconedivalfortore.it`. I vecchi file `galaxy.mp4`, `q.webp`, `p.png` e `last.otf` non sono più richiamati dal nuovo sito: possono restare nella repository e non vengono scaricati dal player.

Prima di pubblicare è possibile leggere le modifiche del branch locale `codex/player-refresh`. Il pacchetto non pubblica nulla automaticamente.

## Aggiornamento 2.1

- Nessun avviso per brevi eventi `waiting`/`stalled` mentre il video prosegue; restano attivi rilevamento dei blocchi e riconnessione.
- Footer eliminato. Su desktop da 901 × 600 pixel CSS, header e spazi ridotti: il player usa lo spazio verticale disponibile e mantiene tutta l’inquadratura. Nelle finestre più piccole o con zoom elevato è consentito lo scorrimento per mantenere leggibili i controlli.
- Le informazioni espanse scorrono nel proprio riquadro su desktop. I riferimenti CSS e JavaScript aggiornati usano `?v=2.1` per evitare il riutilizzo della vecchia versione dalla cache.

## Struttura

- `index.html`: struttura della pagina, metadati, controlli accessibili.
- `assets/site.css`: layout adattivo, stati del player, vista ampia e fullscreen.
- `assets/piazza-poster.webp`: fotogramma statico estratto dal flusso pubblico già mascherato. Non è una seconda diretta e non si aggiorna automaticamente.
- `js/config.js`: indirizzo pubblico del flusso, anteprima e predisposizione grafica privacy.
- `js/player.js`: ciclo di vita del player, HLS nativo/HLS.js, riconnessione e sospensione.
- `js/app.js`: comandi, interfaccia, orologio Europe/Rome, condivisione.
- `vendor/`: HLS.js 1.7.3 distribuito insieme al sito, con licenza Apache 2.0. Non dipende dalla disponibilità di un CDN esterno durante la visita.
- `tests/`: test del comportamento del player mediante video e timer simulati.

## Comportamento

- Tenta l'avvio automatico senza audio, salvo richiesta `Save-Data` del browser. Se il browser blocca l'avvio, mostra un pulsante.
- Usa HLS nativo dove disponibile, altrimenti HLS.js.
- Segna la diretta come attiva solo quando la riproduzione avanza.
- Ignora gli eventi di attesa transitori tra segmenti HLS. Dopo almeno 2 secondi senza avanzamento mostra attesa (controllo ogni secondo); dopo 12 secondi ricrea la connessione. Il primo avvio ha una scadenza di 20 secondi.
- Dopo un errore fatale ritenta dopo 2, 5, 10, 20, poi 30 secondi. I tentativi tornano al ritmo iniziale dopo almeno 15 secondi di riproduzione stabile o un comando esplicito.
- La pausa chiude la sessione HLS e viene rispettata al cambio scheda. Riprendere significa ricollegarsi alla diretta attuale, senza mantenere un archivio del punto di pausa.
- Sospende il caricamento quando la scheda viene nascosta, tranne una riproduzione Picture-in-Picture o fullscreen nativo rilevata. Le scelte del sistema operativo possono comunque limitare l'attività in background.
- Non include qualità fittizie: il server offre una sola qualità 1440p. L'etichetta viene letta dai metadati video.
- La disponibilità del fullscreen nativo e della condivisione dipende dal browser; sono previsti fallback.

Il rilevamento dei blocchi osserva l'avanzamento del video. Non confronta il contenuto dei fotogrammi: se la telecamera codifica continuamente la stessa immagine con timestamp nuovi, occorre un controllo aggiuntivo lato sorgente.

## Privacy

Le maschere nere restano applicate nella Dahua e fanno parte del flusso video. Non disattivarle.

`CAMERA.privacyArtwork` è lasciato a `null`: la sostituzione estetica delle bande **non è attiva** in questa versione. Il player può sovrapporre una futura immagine trasparente 16:9, con zone opache in corrispondenza delle maschere. Il livello segue le dimensioni effettive del video anche quando è centrato con bande laterali.

La sovrapposizione sarà solo estetica: nel fullscreen nativo, in Picture-in-Picture o in un player esterno possono restare visibili le maschere nere originali. Una foto diurna può non integrarsi nel paesaggio notturno. Occorre preparare e controllare l'immagine prima di attivarla.

Non inserire nel sito, nella repository o nelle immagini le credenziali RTSP della Dahua.

## Server in uso

La Dahua applica le maschere e codifica H.264. MediaMTX **preleva** il flusso via RTSP/TCP e lo confeziona in HLS/fMP4, senza ricodificarlo. Caddy termina HTTPS e inoltra le richieste a MediaMTX. GitHub Pages distribuisce soltanto il sito e i suoi file statici; ogni visitatore scarica il video dal server Oracle.

- `mediamtx`: immagine `bluenviron/mediamtx:1.21.2`, porta host `127.0.0.1:8888`.
- `webcam-proxy`: Caddy, rete host, porte pubbliche 80/443.
- Configurazione MediaMTX: `/opt/webcam-stack/mediamtx.yml` (contiene le credenziali della sorgente; non è inclusa nel sito).
- Configurazione Caddy: `/opt/webcam-stack/caddy/Caddyfile`.
- Certificati e stato Caddy: volumi Docker `webcam_caddy_data` e `webcam_caddy_config`.
- Entrambi i nuovi container: riavvio `unless-stopped`.
- Restreamer: container conservato e fermo, riavvio automatico disabilitato; configurazione originale in `/opt/restreamer/config` e dati in `/opt/restreamer/data`.
- Backup precedente alla migrazione: `/root/restreamer-backup-20261011-144239`.

Il nuovo sito usa direttamente:

```text
https://live.webcammontefalconedivalfortore.it/piazza/index.m3u8
```

Non dipende dal reindirizzamento del precedente URL `/memfs/…`.

## Verifica e manutenzione

Con Node 20 o successivo, senza dipendenze da installare:

```sh
npm test
npm run check
```

Prima del rilascio definitivo verificare dal proprio PC e telefono: avvio, pausa mantenuta, ritorno dalla scheda nascosta, fullscreen, ripresa dopo una disconnessione Internet. I test automatici simulano gli eventi del player; non sostituiscono una prova di decodifica nei browser reali.

Il sito non cambia né le impostazioni Oracle né la risoluzione della telecamera. Per aggiungere in futuro 1080p/adattamento automatico serve un secondo flusso reale o una transcodifica dimensionata correttamente.
