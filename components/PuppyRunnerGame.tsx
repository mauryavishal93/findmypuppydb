import React, { useEffect, useRef } from 'react';
import { usePuppyRunnerGame } from '../hooks/usePuppyRunnerGame';

const GROUND_Y_PERCENT = 82;
const PUPPY_X_PERCENT = 15;
const PUPPY_WIDTH_PERCENT = 8;
const OBSTACLE_BASE_WIDTH = 4;

export function PuppyRunnerGame() {
  const { state, startGame, jump, duck, runPose } = usePuppyRunnerGame();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!state.isPlaying && !state.isGameOver) startGame();
        else if (state.isPlaying) jump();
      }
      if (e.code === 'ArrowDown' || e.key === 'Down') {
        e.preventDefault();
        if (state.isPlaying) duck();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' || e.key === 'Down') {
        e.preventDefault();
        if (state.isPlaying) runPose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [state.isPlaying, state.isGameOver, startGame, jump, duck, runPose]);

  const handleTap = () => {
    if (!state.isPlaying && !state.isGameOver) startGame();
    else if (state.isPlaying) jump();
  };

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      onClick={handleTap}
      onKeyDown={(e) => e.key === ' ' && e.preventDefault()}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 600,
        height: 180,
        margin: '0 auto',
        background: 'linear-gradient(to bottom, #87CEEB 0%, #E0F6FF 60%, #f4e4ba 70%, #8B7355 72%, #6B5344 100%)',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: state.isPlaying ? 'default' : 'pointer',
        outline: 'none',
      }}
    >
      {/* Score */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          fontSize: 18,
          fontWeight: 700,
          color: '#333',
          zIndex: 10,
        }}
      >
        {state.score}
      </div>

      {/* Ground line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: '#5a4a3a',
          zIndex: 1,
        }}
      />

      {/* Puppy */}
      <div
        aria-label="Puppy"
        style={{
          position: 'absolute',
          left: `${PUPPY_X_PERCENT}%`,
          bottom: `${state.puppyY * 100}%`,
          width: `${PUPPY_WIDTH_PERCENT}%`,
          height: state.pose === 'duck' ? '5.5%' : '10%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: state.pose === 'duck' ? '1.2rem' : '1.8rem',
          zIndex: 5,
          transition: state.pose === 'jump' ? 'none' : 'bottom 0.05s ease-out',
        }}
      >
        {state.pose === 'duck' ? '🐕' : '🐶'}
      </div>

      {/* Obstacles */}
      {state.obstacles.map((o) => (
        <div
          key={o.id}
          aria-hidden
          style={{
            position: 'absolute',
            left: `${o.x * 100}%`,
            bottom: `${(state.groundY - o.height) * 100}%`,
            width: `${Math.max(o.width * 100, 3)}%`,
            height: `${o.height * 100}%`,
            background: o.type === 'hurdle' ? '#2d5016' : '#5a3520',
            borderRadius: o.type === 'hurdle' ? 4 : 2,
            zIndex: 3,
          }}
        />
      ))}

      {/* Start overlay */}
      {!state.isPlaying && !state.isGameOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.2)',
            zIndex: 8,
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', textShadow: '1px 1px 2px #000' }}>
            Puppy Endless Run
          </span>
          <span style={{ fontSize: 14, color: '#fff', marginTop: 8, textShadow: '1px 1px 2px #000' }}>
            Space or tap to start · Jump (↑/Space) · Duck (↓)
          </span>
        </div>
      )}

      {/* Game over overlay */}
      {state.isGameOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 9,
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Game Over</span>
          <span style={{ fontSize: 18, color: '#ffeb3b', marginTop: 4 }}>Score: {state.score}</span>
          <span style={{ fontSize: 14, color: '#ddd', marginTop: 12 }}>Space or tap to play again</span>
        </div>
      )}
    </div>
  );
}

export default PuppyRunnerGame;
