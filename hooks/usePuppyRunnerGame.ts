import { useState, useCallback, useRef, useEffect } from 'react';
import type { Obstacle, PuppyPose, RunnerGameState } from '../types/runner';
import { RUNNER_DEFAULTS } from '../types/runner';

const {
  GROUND_Y,
  PUPPY_X,
  PUPPY_WIDTH,
  PUPPY_HEIGHT_RUN,
  PUPPY_HEIGHT_DUCK,
  BASE_SPEED,
  MAX_SPEED,
  SPEED_INCREASE,
  OBSTACLE_MIN_GAP,
  OBSTACLE_MAX_GAP,
  JUMP_VELOCITY,
  GRAVITY,
  HURDLE_HEIGHT,
  LOW_OBSTACLE_HEIGHT,
} = RUNNER_DEFAULTS;

let obstacleId = 0;
function nextObstacleId() {
  return `obs-${++obstacleId}-${Date.now()}`;
}

export function usePuppyRunnerGame() {
  const [state, setState] = useState<RunnerGameState>({
    isPlaying: false,
    isGameOver: false,
    score: 0,
    pose: 'run',
    obstacles: [],
    groundY: GROUND_Y,
    puppyX: PUPPY_X,
    puppyY: GROUND_Y,
    puppyWidth: PUPPY_WIDTH,
    puppyHeight: PUPPY_HEIGHT_RUN,
    speed: BASE_SPEED,
  });

  const velocityRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  const startGame = useCallback(() => {
    obstacleId = 0;
    velocityRef.current = 0;
    lastSpawnRef.current = 0;
    setState({
      isPlaying: true,
      isGameOver: false,
      score: 0,
      pose: 'run',
      obstacles: [],
      groundY: GROUND_Y,
      puppyX: PUPPY_X,
      puppyY: GROUND_Y,
      puppyWidth: PUPPY_WIDTH,
      puppyHeight: PUPPY_HEIGHT_RUN,
      speed: BASE_SPEED,
    });
  }, []);

  const jump = useCallback(() => {
    setState((prev) => {
      if (!prev.isPlaying || prev.isGameOver) return prev;
      if (prev.pose === 'run') {
        velocityRef.current = JUMP_VELOCITY;
        return { ...prev, pose: 'jump' as PuppyPose, puppyHeight: PUPPY_HEIGHT_RUN };
      }
      return prev;
    });
  }, []);

  const duck = useCallback(() => {
    setState((prev) => {
      if (!prev.isPlaying || prev.isGameOver) return prev;
      return {
        ...prev,
        pose: 'duck' as PuppyPose,
        puppyHeight: PUPPY_HEIGHT_DUCK,
      };
    });
  }, []);

  const runPose = useCallback(() => {
    setState((prev) => {
      if (!prev.isPlaying || prev.isGameOver) return prev;
      if (prev.pose === 'duck') {
        return { ...prev, pose: 'run' as PuppyPose, puppyHeight: PUPPY_HEIGHT_RUN };
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!state.isPlaying || state.isGameOver) return;

    const gameLoop = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 16, 4) : 1;
      lastTimeRef.current = time;

      setState((prev) => {
        if (!prev.isPlaying || prev.isGameOver) return prev;

        let newPuppyY = prev.puppyY;
        let newPose = prev.pose;
        let newVelocity = velocityRef.current;

        if (prev.pose === 'jump') {
          newVelocity += GRAVITY * dt;
          velocityRef.current = newVelocity;
          newPuppyY += newVelocity * dt;
          if (newPuppyY >= prev.groundY) {
            newPuppyY = prev.groundY;
            newVelocity = 0;
            velocityRef.current = 0;
            newPose = 'run';
          }
        }

        const newSpeed = Math.min(MAX_SPEED, prev.speed + SPEED_INCREASE * dt);
        const puppyHeight = newPose === 'duck' ? PUPPY_HEIGHT_DUCK : PUPPY_HEIGHT_RUN;

        let newObstacles: Obstacle[] = prev.obstacles
          .map((o) => ({
            ...o,
            x: o.x - newSpeed * dt,
          }))
          .filter((o) => o.x > -0.15);

        let newScore = prev.score;
        newObstacles = newObstacles.map((o) => {
          if (!o.passed && o.x + o.width < prev.puppyX) {
            newScore += 1;
            return { ...o, passed: true };
          }
          return o;
        });

        const lastObstacle = newObstacles[newObstacles.length - 1];
        const lastX = lastObstacle ? lastObstacle.x : 1;
        const gap = lastX - (lastObstacle ? lastObstacle.width : 0);
        if (gap > OBSTACLE_MIN_GAP && (gap > OBSTACLE_MAX_GAP || Math.random() < 0.015 * dt)) {
          const type: 'hurdle' | 'low' = Math.random() < 0.5 ? 'hurdle' : 'low';
          const width = 0.04 + Math.random() * 0.03;
          const height = type === 'hurdle' ? HURDLE_HEIGHT : LOW_OBSTACLE_HEIGHT;
          newObstacles.push({
            id: nextObstacleId(),
            type,
            x: 1.1,
            width,
            height,
            passed: false,
          });
        }

        const puppyLeft = prev.puppyX;
        const puppyRight = prev.puppyX + prev.puppyWidth;
        const puppyTop = newPuppyY - puppyHeight;
        const puppyBottom = newPuppyY;

        let gameOver = false;
        for (const o of newObstacles) {
          if (o.passed) continue;
          const oLeft = o.x;
          const oRight = o.x + o.width;
          const oTop = prev.groundY - o.height;
          const oBottom = prev.groundY;
          const overlapX = puppyRight > oLeft && puppyLeft < oRight;
          const overlapY = puppyBottom > oTop && puppyTop < oBottom;
          if (overlapX && overlapY) {
            if (o.type === 'hurdle' && prev.pose === 'jump' && puppyBottom < oTop + o.height * 0.3) continue;
            if (o.type === 'low' && prev.pose === 'duck') continue;
            gameOver = true;
            break;
          }
        }

        return {
          ...prev,
          puppyY: newPuppyY,
          pose: newPose,
          puppyHeight,
          obstacles: newObstacles,
          score: newScore,
          speed: newSpeed,
          isGameOver: gameOver,
          isPlaying: !gameOver,
        };
      });

      rafRef.current = requestAnimationFrame(gameLoop);
    };

    rafRef.current = requestAnimationFrame(gameLoop);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [state.isPlaying, state.isGameOver]);

  return {
    state,
    startGame,
    jump,
    duck,
    runPose,
  };
}
