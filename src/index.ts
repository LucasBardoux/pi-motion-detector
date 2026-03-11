import { config } from 'dotenv';
import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Blob } from 'buffer';

config();

const UPLOAD_SERVER = process.env.UPLOAD_SERVER;
if (!UPLOAD_SERVER) throw new Error('UPLOAD_SERVER not defined');

/** 
 * Konfiguration 
 */
const CONFIG = {
  DEVICE: '/dev/video0',
  TRIGGER_PREFIX: 'trigger_',
  VIDEO_PREFIX: 'video_',
  SCENE_THRESHOLD: '0.002',
  POST_MOTION_TIME: 10000, // 10s Nachlauf
  WARMUP_TIME: 3000,       // Kamera-Einschwingzeit
};

let currentProcess: ChildProcess | null = null;
let stopTimer: NodeJS.Timeout | null = null;
let isRecording = false;
let sessionStartTime = 0;

/**
 * Bereinigt die Umgebung
 */
const cleanup = (): void => {
  try {
    execSync('pkill -9 ffmpeg || true');
    fs.readdirSync(__dirname)
      .filter(f => f.startsWith(CONFIG.TRIGGER_PREFIX) || f.startsWith(CONFIG.VIDEO_PREFIX))
      .forEach(f => fs.unlinkSync(path.join(__dirname, f)));
  } catch {}
};

/**
 * Startet den FFmpeg-Prozess. 
 * Im Recording-Modus wird das Video gespeichert UND Trigger-Bilder für den Timer erzeugt.
 */
const startFFmpeg = (mode: 'detect' | 'record'): void => {
  if (currentProcess) {
    currentProcess.kill('SIGKILL');
    currentProcess = null;
  }

  sessionStartTime = Date.now();
  const timestamp = Date.now();
  const videoPath = path.join(__dirname, `${CONFIG.VIDEO_PREFIX}${timestamp}.mp4`);
  
  // Basis-Argumente
  const args = ['-f', 'v4l2', '-input_format', 'mjpeg', '-i', CONFIG.DEVICE];

  if (mode === 'record') {
    // Hochperformantes Splitting: Stream 0 wird zu Video, Stream 1 zu Trigger-Bildern
    args.push(
      '-filter_complex', `[0:v]split=2[v_rec][v_det];[v_det]fps=2,select='gt(scene,${CONFIG.SCENE_THRESHOLD})'[out_det]`,
      '-map', '[v_rec]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', videoPath,
      '-map', '[out_det]', '-f', 'image2', '-vsync', 'vfr', path.join(__dirname, `${CONFIG.TRIGGER_PREFIX}%03d.jpg`)
    );
  } else {
    // Reiner Detektions-Modus
    args.push(
      '-vf', `fps=2,select='gt(scene,${CONFIG.SCENE_THRESHOLD})'`,
      '-f', 'image2', '-vsync', 'vfr', '-loglevel', 'error',
      path.join(__dirname, `${CONFIG.TRIGGER_PREFIX}%03d.jpg`)
    );
  }

  currentProcess = spawn('ffmpeg', args);

  if (mode === 'record') {
    currentProcess.on('close', () => handleFinishedVideo(videoPath, `${CONFIG.VIDEO_PREFIX}${timestamp}.mp4`));
  }
};

const handleFinishedVideo = async (filePath: string, fileName: string) => {
  isRecording = false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 50000) {
    console.log(`[System] Video bereit: ${fileName}`);
    await upload(filePath, fileName);
  } else if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (!isRecording) startFFmpeg('detect');
};

const upload = async (filePath: string, fileName: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('file', new Blob([buffer]), fileName);
    const res = await fetch(UPLOAD_SERVER!, { method: 'POST', body: formData });
    if (res.ok) console.log(`[Upload] Erfolg: ${fileName}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('[Upload] Fehler:', err);
  }
};

/**
 * Watcher-Logik
 */
fs.watch(__dirname, (_, filename) => {
  if (filename?.startsWith(CONFIG.TRIGGER_PREFIX) && filename.endsWith('.jpg')) {
    const fullPath = path.join(__dirname, filename);
    
    // 1. Validierung (Warmup & Existenz)
    if (Date.now() - sessionStartTime < CONFIG.WARMUP_TIME) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      return;
    }
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    // 2. Timer Management (Verlängerung)
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      if (isRecording && currentProcess?.stdin) currentProcess.stdin.write('q');
    }, CONFIG.POST_MOTION_TIME);

    // 3. Status-Wechsel
    if (!isRecording) {
      isRecording = true;
      console.log('[System] Bewegung detektiert - Starte Aufnahme');
      startFFmpeg('record');
    }
  }
});

const setCameraProperties = (isManual = true, exposureValue = 157, gainValue = 0) => {
  try {
    if (isManual) {
      // 1 = Manual Mode, 3 = Aperture Priority (Auto)
      // Wir setzen Modus 1, um 'exposure_time_absolute' zu aktivieren
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c auto_exposure=1`);
      
      // Jetzt ist die Zeit nicht mehr "inactive" und kann gesetzt werden (1 bis 5000)
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c exposure_time_absolute=${exposureValue}`);
      
      // Da manuelle Belichtung oft dunkle Bilder liefert, kannst du 'gain' nutzen
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c gain=${gainValue}`);
      
      console.log(`[Camera] Manuell: Belichtung=${exposureValue}, Verstärkung=${gainValue}`);
    } else {
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c auto_exposure=3`);
      console.log(`[Camera] Automatik aktiv`);
    }
  } catch (err: any) {
    console.error('[Camera] Fehler beim Einstellen:', err.message);
  }
};

// Init
cleanup();
setCameraProperties(true, 20);
startFFmpeg('detect');
