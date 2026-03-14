export type Mode = 'detect' | 'record';

export interface IConfig {
  UPLOAD_SERVER: string;
  DEVICE: string;
  TRIGGER_PREFIX: string;
  VIDEO_PREFIX: string;
  SCENE_THRESHOLD: string;
  POST_MOTION_TIME: number;
  WARMUP_TIME: number;
  TEMP_DIR: string;
}