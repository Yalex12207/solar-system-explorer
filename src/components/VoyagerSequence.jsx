/**
 * VoyagerSequence — the departure.
 *
 * A full-screen cinematic layer for the Voyager Experience. It owns only the *look*; the
 * camera does the travelling (see `CameraRig.voyage`) and the scene handles the depth
 * compensation. This component reads two facts from the caller — whether the departure
 * has finished, and how long it has been running — and renders four restrained states:
 *
 *  - **departing**: almost nothing. A distant readout and a quiet exit. The brief calls
 *    for the animation to be "非常克制" (very restrained), so there is deliberately no
 *    progress bar, no telemetry and no chrome competing with the shot.
 *  - **arriving**: a fade through black once the system is a point of light.
 *  - **message**: the title card, `VOYAGER 1` over `A MESSAGE FROM HUMANITY`.
 *  - **ended**: the card stays with a single way back, plus Esc.
 *
 * Everything animates with the project's shared easing tokens and honours
 * `prefers-reduced-motion` by dropping the transitions rather than the content.
 */

import { useEffect, useState } from 'react';

/** Timings, in seconds, of the departure's stages. */
const STAGE = {
  /** Departure is fully over before the card appears, however long the flight took. */
  fadeAfterComplete: 0.9,
  fadeDuration: 1.5,
  /** How long the title card holds before the way back appears. */
  cardHold: 2.2,
};

export default function VoyagerSequence({ mission, complete, progress = 0, onExit }) {
  const [stage, setStage] = useState('departing');

  // Verification seam: the staged card is time-based, so the suite needs to read the
  // component's own view of the sequence rather than infer it from timers.
  if (typeof window !== 'undefined' && window.location.search.includes('gestureTest')) {
    window.__voyageStage = { stage, complete };
  }

  // The card never appears while the camera is still travelling.
  useEffect(() => {
    if (!complete) {
      setStage('departing');
      return undefined;
    }
    const toBlack = setTimeout(() => setStage('arriving'), STAGE.fadeAfterComplete * 1000);
    const toCard = setTimeout(
      () => setStage('message'),
      (STAGE.fadeAfterComplete + STAGE.fadeDuration) * 1000,
    );
    const toEnd = setTimeout(
      () => setStage('ended'),
      (STAGE.fadeAfterComplete + STAGE.fadeDuration + STAGE.cardHold) * 1000,
    );
    return () => {
      clearTimeout(toBlack);
      clearTimeout(toCard);
      clearTimeout(toEnd);
    };
  }, [complete]);

  // Esc leaves at any point, including mid-flight.
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onExit]);

  const showCard = stage === 'message' || stage === 'ended';

  return (
    <div className={`voyage voyage-${stage}`} role="region" aria-label="Voyager departure">
      {/* Fade-through-black between the departure and the card. */}
      <div className="voyage-veil" aria-hidden="true" />

      {stage === 'departing' ? (
        <div className="voyage-hud">
          <p className="voyage-eyebrow mono caps">Leaving the solar system</p>
          <p className="voyage-distance mono">{formatDistance(progress)}</p>
          <button type="button" className="voyage-skip mono caps" onClick={onExit}>
            Return to the system
          </button>
        </div>
      ) : null}

      {showCard ? (
        <div className="voyage-card">
          <p className="voyage-card-eyebrow mono caps">The edge of the solar system</p>
          <h2 className="voyage-card-title">VOYAGER 1</h2>
          <p className="voyage-card-sub">A MESSAGE FROM HUMANITY</p>
          <p className="voyage-card-copy">
            {mission?.summary ||
              'Carrying the Golden Record — greetings in 55 languages, the sound of Earth, and 116 images, for whoever finds it.'}
          </p>
          <p className="voyage-card-note mono">
            Now more than 24 billion km away · still transmitting
          </p>
          <button type="button" className="voyage-return" onClick={onExit}>
            <span aria-hidden="true">←</span> Re-enter the solar system
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A deliberately coarse readout of how far the departure has run.
 *
 * Restraint is the point here, so this is scenery rather than instrumentation. It counts
 * up in light-hours — the unit in which the real mission's distance is reported — scaled
 * so the end of the animation lands near Voyager 1's actual 22-odd light-hours, and is
 * derived from the animation clock rather than pretending to be live telemetry.
 */
function formatDistance(progress) {
  const lightHours = Math.max(0, Math.min(1, progress)) * 22.4;
  if (lightHours < 1) return `${(lightHours * 60).toFixed(0)} light-minutes from the Sun`;
  return `${lightHours.toFixed(1)} light-hours from the Sun`;
}
