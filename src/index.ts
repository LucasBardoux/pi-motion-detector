
import { spawn, execSync, ChildProcess } from 'child_process';
import { IConfig, Mode } from './types';
import { EnvVariable, getEnvVariable } from './utils/env';
import { Blob } from 'buffer';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs'

const CONFIG: IConfig = {
  UPLOAD_SERVER: getEnvVariable(EnvVariable.UPLOAD_SERVER),
  DEVICE: getEnvVariable(EnvVariable.DEVICE),
  TRIGGER_PREFIX: 'trigger_',
  VIDEO_PREFIX: 'video_',
  SCENE_THRESHOLD: getEnvVariable(EnvVariable.SCENE_THRESHOLD),
  POST_MOTION_TIME: +getEnvVariable(EnvVariable.POST_MOTION_TIME),
  WARMUP_TIME: +getEnvVariable(EnvVariable.WARMUP_TIME),
  TEMP_DIR: getEnvVariable(EnvVariable.TEMP_DIR),
};

let currentProcess: ChildProcess | null = null;
let stopTimer: NodeJS.Timeout | null = null;
let isRecording = false;
let sessionStartTime = 0;

const cleanup = (): void => {
  try {
    execSync('pkill -9 ffmpeg || true');
    fs.readdirSync(CONFIG.TEMP_DIR)
      .filter(f => f.startsWith(CONFIG.TRIGGER_PREFIX) || f.startsWith(CONFIG.VIDEO_PREFIX))
      .forEach(f => fs.unlinkSync(path.join(CONFIG.TEMP_DIR, f)));
  } catch { }
};

const startFFmpeg = (mode: Mode): void => {
  if (currentProcess) {
    currentProcess.kill('SIGKILL');
    currentProcess = null;
  }

  sessionStartTime = Date.now();
  const timestamp = dayjs(new Date()).format('YYYY_MM_DD_HH_mm_ss')
  const videoPath = path.join(__dirname, `${CONFIG.VIDEO_PREFIX}${timestamp}.mp4`);
  const args = ['-f', 'v4l2', '-input_format', 'mjpeg', '-i', CONFIG.DEVICE];

  mode === 'record' ?
    args.push(
      '-filter_complex', `[0:v]split=2[v_rec][v_det];[v_det]fps=2,select='gt(scene,${CONFIG.SCENE_THRESHOLD})'[out_det]`,
      '-map', '[v_rec]', '-c:v', 'h264_v4l2m2m', '-b:v', '4M', '-pix_fmt', 'yuv420p', videoPath,
      '-map', '[out_det]', '-f', 'image2', '-vsync', 'vfr', path.join(CONFIG.TEMP_DIR, `${CONFIG.TRIGGER_PREFIX}%03d.jpg`)
    )
    :
    args.push(
      '-vf', `fps=2,select='gt(scene,${CONFIG.SCENE_THRESHOLD})'`,
      '-f', 'image2', '-vsync', 'vfr', '-loglevel', 'error',
      path.join(CONFIG.TEMP_DIR, `${CONFIG.TRIGGER_PREFIX}%03d.jpg`)
    );

  currentProcess = spawn('ffmpeg', args);

  if (mode === 'record')
    currentProcess.on('close', () => handleFinishedVideo(videoPath, `${CONFIG.VIDEO_PREFIX}${timestamp}.mp4`));
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
    const res = await fetch(CONFIG.UPLOAD_SERVER, { method: 'POST', body: formData });
    if (res.ok) console.log(`[Upload] Erfolg: ${fileName}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('[Upload] Fehler:', err);
  }
};

fs.watch(CONFIG.TEMP_DIR, (_, filename) => {
  if (filename?.startsWith(CONFIG.TRIGGER_PREFIX) && filename.endsWith('.jpg')) {
    const fullPath = path.join(CONFIG.TEMP_DIR, filename);

    // 1. Warmup time
    if (Date.now() - sessionStartTime < CONFIG.WARMUP_TIME) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      return;
    }
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    // 2. Timer management
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      if (isRecording && currentProcess?.stdin) currentProcess.stdin.write('q');
    }, CONFIG.POST_MOTION_TIME);

    // 3. Switch status
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
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c auto_exposure=1`);
      execSync(`v4l2-ctl -d ${CONFIG.DEVICE} -c exposure_time_absolute=${exposureValue}`);
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

cleanup();
setCameraProperties(true, 10, 0);
startFFmpeg('detect');
