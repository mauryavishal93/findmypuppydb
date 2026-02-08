/** Obstacle types: jump over hurdles, duck under low obstacles (e.g. birds/barriers) */
export type ObstacleType = 'hurdle' | 'low';

export interface Obstacle {
  id: string;
  type: ObstacleType;
  x: number;
  width: number;
  height: number;
  passed: boolean;
}

/** Puppy pose: running, jumping, or ducking */
export type PuppyPose = 'run' | 'jump' | 'duck';

export interface RunnerGameState {
  isPlaying: boolean;
  isGameOver: boolean;
  score: number;
  pose: PuppyPose;
  obstacles: Obstacle[];
  groundY: number;
  puppyX: number;
  puppyY: number;
  puppyWidth: number;
  puppyHeight: number;
  speed: number;
}

export const RUNNER_DEFAULTS = {
  GROUND_Y: 0.82,
  PUPPY_X: 0.15,
  PUPPY_WIDTH: 0.08,
  PUPPY_HEIGHT_RUN: 0.1,
  PUPPY_HEIGHT_DUCK: 0.055,
  BASE_SPEED: 0.012,
  MAX_SPEED: 0.022,
  SPEED_INCREASE: 0.00002,
  OBSTACLE_MIN_GAP: 0.35,
  OBSTACLE_MAX_GAP: 0.7,
  JUMP_VELOCITY: -0.22,
  GRAVITY: 0.011,
  HURDLE_HEIGHT: 0.12,
  LOW_OBSTACLE_HEIGHT: 0.06,
} as const;
