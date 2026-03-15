import { config } from 'dotenv';
config();

export enum EnvVariable {
  UPLOAD_SERVER = 'UPLOAD_SERVER',
  DEVICE = 'DEVICE',
  SCENE_THRESHOLD = 'SCENE_THRESHOLD',
  POST_MOTION_TIME = 'POST_MOTION_TIME',
  WARMUP_TIME = 'WARMUP_TIME',
  TEMP_DIR = 'TEMP_DIR',
  SHIPPING_PIPELINE_DIRECTORY = 'SHIPPING_PIPELINE_DIRECTORY'
}

export function getEnvVariable(name: EnvVariable): string {
  const value = process.env[name];

  if (!value) throw new Error(`Env variable "${name}" is not defined.`)

  return value;
}