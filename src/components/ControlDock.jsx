/**
 * ControlDock — time, view options, quality, sound and the guided tour.
 *
 * Collapsed by default to a compact bar so it never competes with the scene; the
 * expanded state adds the time readout and the quality row. Every control keeps a
 * 44px target on touch devices and an accessible label.
 */

import { useState } from 'react';
import { TIME_SCALES } from '../store/store.jsx';
import { QUALITY_ORDER, QUALITY_PRESETS } from '../data/scale.js';

const SPEED_LABELS = {
  0: 'PAUSE',
  // Six speeds no longer fit as raw digits; the largest is abbreviated so one row holds
  // them all without the dock wrapping on a laptop.
  1000: '1k×',
  10000: '10k×',
};

function scaleLabel(scale) {
  return SPEED_LABELS[scale] ?? `${scale}×`;
}

export default function ControlDock({
  timeScale,
  quality,
  showOrbits,
  showLabels,
  soundEnabled,
  storyActive,
  simulation,
  fps,
  controlMode = 'mouse',
  cosmicActive = false,
  onStartCosmicTour,
  onLeaveCosmic,
  onSetControlMode,
  onSetTimeScale,
  onSetQuality,
  onToggleOrbits,
  onToggleLabels,
  onToggleSound,
  onToggleStory,
  onReset,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`dock glass ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="dock-collapse"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="mono caps">{expanded ? 'Hide controls' : 'Controls'}</span>
      </button>

      <div className="dock-body" hidden={!expanded}>
        <div className="dock-group input-control">
          <span className="dock-label caps mono">Input</span>
          <div className="dock-buttons">
            {['mouse', 'touch', 'hand'].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`dock-button ${controlMode === mode ? 'active' : ''}`}
                onClick={() => onSetControlMode?.(mode)}
                aria-pressed={controlMode === mode}
                title={
                  mode === 'hand'
                    ? 'Control the system with hand gestures (uses the camera)'
                    : `Control with ${mode}`
                }
              >
                {mode === 'mouse' ? 'MOUSE' : mode === 'touch' ? 'TOUCH' : 'HAND CONTROL'}
              </button>
            ))}
          </div>
        </div>

        <div className="dock-group time-control">
          <span className="dock-label caps mono">Time</span>
          <div className="dock-buttons">
            {TIME_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                className={`dock-button ${timeScale === scale ? 'active' : ''}`}
                onClick={() => onSetTimeScale(scale)}
                aria-pressed={timeScale === scale}
                title={scale === 0 ? 'Pause the simulation' : `${scale}× real time`}
              >
                {scaleLabel(scale)}
              </button>
            ))}
          </div>
        </div>

        <div className="dock-group">
          <span className="dock-label caps mono">View</span>
          <div className="dock-buttons">
            <button
              type="button"
              className={`dock-button ${showOrbits ? 'active' : ''}`}
              onClick={onToggleOrbits}
              aria-pressed={showOrbits}
            >
              ORBITS
            </button>
            <button
              type="button"
              className={`dock-button ${showLabels ? 'active' : ''}`}
              onClick={onToggleLabels}
              aria-pressed={showLabels}
            >
              LABELS
            </button>
            <button type="button" className="dock-button" onClick={onReset}>
              RESET
            </button>
            <button
              type="button"
              className={`dock-button ${storyActive ? 'active' : ''}`}
              onClick={onToggleStory}
              aria-pressed={storyActive}
            >
              {storyActive ? 'STOP TOUR' : 'TOUR'}
            </button>
          </div>
        </div>

        {/*
          Cosmic Scale. The trigger carries the whole guided trip when nothing is open yet,
          and becomes "leave" once the ladder is active, so there is always exactly one
          control and no mode to discover.
        */}
        <div className="dock-group cosmic-control">
          <span className="dock-label caps mono">Scale</span>
          <div className="dock-buttons">
            <button
              type="button"
              className={`dock-button cosmic-button ${cosmicActive ? 'active' : ''}`}
              onClick={cosmicActive ? onLeaveCosmic : onStartCosmicTour}
              aria-pressed={cosmicActive}
              title={cosmicActive ? 'Leave Cosmic Scale' : 'Understand how large the solar system is'}
            >
              {cosmicActive ? 'LEAVE COSMIC SCALE' : 'COSMIC SCALE'}
            </button>
          </div>
        </div>

        <div className="dock-group">
          <span className="dock-label caps mono">
            {expanded ? `Quality · ${QUALITY_PRESETS[quality].label}` : 'Settings'}
          </span>
          <div className="dock-buttons">
            <button
              type="button"
              className={`dock-button ${expanded ? 'active' : ''}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'LESS' : 'MORE'}
            </button>
            {expanded ? (
              <>
                {QUALITY_ORDER.slice()
                  .reverse()
                  .map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`dock-button ${quality === key ? 'active' : ''}`}
                      onClick={() => onSetQuality(key)}
                      aria-pressed={quality === key}
                      title={`${QUALITY_PRESETS[key].sphereSegments} segments · ${QUALITY_PRESETS[key].starCount} stars`}
                    >
                      {key === 'high' ? 'HIGH' : key === 'balanced' ? 'BALANCED' : 'PERFORMANCE'}
                    </button>
                  ))}
                <button
                  type="button"
                  className={`dock-button ${soundEnabled ? 'active' : ''}`}
                  onClick={onToggleSound}
                  aria-pressed={soundEnabled}
                >
                  {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {expanded ? (
          <div className="dock-group time-readout">
            <div>
              <div className="time-readout-value mono">{simulation.iso}</div>
              <div className="time-readout-label caps">Solar system time</div>
            </div>
            <div>
              <div className="time-readout-value mono">{simulation.dayOfYear}</div>
              <div className="time-readout-label caps">Earth</div>
            </div>
            <div>
              <div className="time-readout-value mono">{fps ? Math.round(fps) : '—'}</div>
              <div className="time-readout-label caps">Frame rate</div>
            </div>
            {timeScale === 0 ? (
              <div>
                <div className="time-readout-value mono paused">PAUSED</div>
                <div className="time-readout-label caps">Space to resume</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {expanded ? (
          <div className="dock-group legend-group">
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ '--color': '#FFB347' }} /> Star
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ '--color': '#5AA9E6' }} /> Planets
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ '--color': '#C9C6C0' }} /> Moons
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
