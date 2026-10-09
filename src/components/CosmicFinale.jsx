/**
 * CosmicFinale — the closing frame of the Cosmic Scale ladder.
 *
 * Deliberately a sibling of `VoyagerSequence` in look and pacing (same veil, same quiet
 * typography) so the two cinematic set pieces read as one product rather than two
 * features. What differs is the message: the Voyager sequence is about leaving, this one
 * is about locating.
 *
 * It shows the brief's final screen — `YOU ARE HERE`, `Solar System`, `Orion Arm`, then
 * `Somewhere in the Milky Way.` — and then offers the way back.
 */

import { useEffect, useState } from 'react';

const STAGE = {
  /** Held after the camera settles before the veil starts. */
  holdBeforeVeil: 0.8,
  veil: 1.4,
  /** How long the frame holds before the return control appears. */
  beforeReturn: 2.6,
};

export default function CosmicFinale({ complete, onExit }) {
  const [phase, setPhase] = useState('arriving');

  useEffect(() => {
    if (!complete) {
      setPhase('arriving');
      return undefined;
    }
    const toCard = setTimeout(() => setPhase('card'), STAGE.holdBeforeVeil * 1000);
    const toSettled = setTimeout(
      () => setPhase('settled'),
      (STAGE.holdBeforeVeil + STAGE.veil) * 1000,
    );
    const toReturn = setTimeout(
      () => setPhase('ready'),
      (STAGE.holdBeforeVeil + STAGE.veil + STAGE.beforeReturn) * 1000,
    );
    return () => {
      clearTimeout(toCard);
      clearTimeout(toSettled);
      clearTimeout(toReturn);
    };
  }, [complete]);

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

  const showCard = phase === 'card' || phase === 'settled' || phase === 'ready';

  return (
    <div className={`cosmic-finale finale-${phase}`} role="region" aria-label="Cosmic scale">
      <div className="finale-veil" aria-hidden="true" />

      {showCard ? (
        <div className="finale-card">
          <p className="finale-tag mono caps">You are here</p>
          <h2 className="finale-title">Solar System</h2>
          <p className="finale-arm mono caps">Orion Arm</p>
          <p className="finale-copy">Somewhere in the Milky Way.</p>
          <button type="button" className="finale-return" onClick={onExit}>
            <span aria-hidden="true">←</span> Return to the solar system
          </button>
        </div>
      ) : (
        <div className="finale-hud">
          <p className="finale-hud-label mono caps">Pulling back</p>
          <button type="button" className="finale-skip mono caps" onClick={onExit}>
            Return to the solar system
          </button>
        </div>
      )}
    </div>
  );
}
