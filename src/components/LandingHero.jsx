/**
 * LandingHero — the cinematic title card.
 *
 * Sits above the live 3D scene: the camera is already drifting through the system
 * behind this type, so the transition into Explore is a fade rather than a load.
 */

import { useEffect, useState } from 'react';
import { BRAND, HERO_STATS, NAV_LINKS } from '../data/narrative.js';

export default function LandingHero({ onEnter, onNavigate }) {
  const [visibleStats, setVisibleStats] = useState(0);

  useEffect(() => {
    const timers = HERO_STATS.map((_, index) =>
      window.setTimeout(() => setVisibleStats(index + 1), 900 + index * 320),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div className="hero">
      <header className="hero-nav">
        <div className="hero-brand mono caps">{BRAND.short}</div>
        <nav className="hero-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <button key={link.key} type="button" className="hero-link" onClick={() => onNavigate(link.key)}>
              {link.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="hero-center">
        <p className="hero-kicker mono caps">{BRAND.heroKicker}</p>
        <h1 className="hero-title">{BRAND.heroTitle}</h1>
        <p className="hero-sub">{BRAND.tagline}</p>
        <button type="button" className="hero-cta" onClick={onEnter}>
          <span>{BRAND.enterLabel}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="hero-stats">
        {HERO_STATS.map((stat, index) => (
          <div key={stat.label} className={`hero-stat rise ${index < visibleStats ? 'in' : ''}`}>
            <div className="hero-stat-value mono">{stat.value}</div>
            <div className="hero-stat-label caps">{stat.label}</div>
            <div className="hero-stat-detail">{stat.detail}</div>
          </div>
        ))}
      </div>

      <button type="button" className="hero-scroll-hint mono caps" onClick={onEnter}>
        Scroll or click to enter
      </button>
    </div>
  );
}
