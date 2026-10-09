/**
 * TopBar — persistent chrome for the in-system view.
 *
 * Left: identity + section navigation. Right: search, sound and quality.
 * Everything here is a dispatch; no component reaches into the 3D scene directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NAV_LINKS, BRAND } from '../data/narrative.js';
import { searchCatalog } from '../data/catalog.js';
import { useStore, ActionType } from '../store/store.jsx';
import { QUALITY_ORDER, QUALITY_PRESETS } from '../data/scale.js';
import { PLANETS, SUN } from '../data/planets.js';
import { MOONS } from '../data/moons.js';
import { MISSIONS } from '../data/missions.js';

const KIND_LABEL = {
  planet: 'PLANET',
  moon: 'MOON',
  star: 'STAR',
  mission: 'MISSION',
};

export default function TopBar({ onSetQuality, onOpenMission, onSelectBody }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [planetsOpen, setPlanetsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const results = useMemo(() => searchCatalog(query), [query]);

  const suggestions = useMemo(
    () =>
      ['Earth', 'Mars', 'Jupiter', 'Saturn', 'Moon', 'Europa', 'Titan', 'Apollo', 'Voyager', 'Cassini'].slice(
        0,
        8,
      ),
    [],
  );

  const closeAll = useCallback(() => {
    setSearchOpen(false);
    setPlanetsOpen(false);
    setQualityOpen(false);
  }, []);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) closeAll();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [closeAll]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === '/' && !searchOpen) {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }
      if (event.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, closeAll]);

  const runSearch = useCallback(
    (result) => {
      if (result.kind === 'mission') {
        onOpenMission(result.id);
      } else {
        onSelectBody(result.id);
      }
      setSearchOpen(false);
      setQuery('');
    },
    [onOpenMission, onSelectBody],
  );

  const isPlanetsView = state.planetsOpen;

  return (
    <header className="topbar" ref={containerRef}>
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-brand"
          onClick={() => {
            dispatch({ type: ActionType.OPEN_HERO });
          }}
          title="Back to title"
        >
          <span className="mono caps">{BRAND.short}</span>
        </button>
        <nav className="topbar-nav" aria-label="Sections">
          <button
            type="button"
            className={`topbar-link ${state.view === 'explore' ? 'active' : ''}`}
            onClick={() => {
              dispatch({ type: ActionType.CLOSE_DETAIL });
              dispatch({ type: ActionType.CLEAR_SELECTION });
            }}
          >
            Explore
          </button>
          <button
            type="button"
            className={`topbar-link ${isPlanetsView ? 'active' : ''}`}
            aria-expanded={planetsOpen}
            onClick={() => {
              dispatch({ type: ActionType.TOGGLE_PLANETS });
              setPlanetsOpen((open) => !open);
              setSearchOpen(false);
            }}
          >
            Planets
          </button>
          <button
            type="button"
            className={`topbar-link ${state.view === 'missions' ? 'active' : ''}`}
            onClick={() => {
              dispatch({ type: ActionType.OPEN_MISSIONS });
              closeAll();
            }}
          >
            Missions
          </button>
          <button
            type="button"
            className={`topbar-link ${state.view === 'about' ? 'active' : ''}`}
            onClick={() => {
              dispatch({ type: ActionType.OPEN_ABOUT });
              closeAll();
            }}
          >
            About
          </button>
        </nav>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`icon-button ${searchOpen ? 'active' : ''}`}
          aria-label="Search planets, moons and missions"
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((open) => !open);
            setPlanetsOpen(false);
            setQualityOpen(false);
            window.setTimeout(() => inputRef.current?.focus(), 60);
          }}
        >
          <span aria-hidden="true">⌕</span>
          <span className="mono caps hide-narrow">SEARCH</span>
        </button>

        <div className="topbar-dropdown">
          <button
            type="button"
            className={`icon-button ${qualityOpen ? 'active' : ''}`}
            aria-label="Render quality"
            aria-expanded={qualityOpen}
            onClick={() => {
              setQualityOpen((open) => !open);
              setPlanetsOpen(false);
              setSearchOpen(false);
            }}
          >
            <span className="mono caps">{state.quality === 'performance' ? 'PERF' : state.quality === 'high' ? 'HIGH' : 'BAL'}</span>
          </button>
          {qualityOpen ? (
            <div className="dropdown glass">
              <p className="dropdown-label caps mono">Render profile</p>
              {QUALITY_ORDER.slice()
                .reverse()
                .map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`dropdown-item ${state.quality === key ? 'active' : ''}`}
                    onClick={() => {
                      onSetQuality(key);
                      setQualityOpen(false);
                    }}
                  >
                    <span>{QUALITY_PRESETS[key].label}</span>
                    <span className="dropdown-meta mono">
                      {QUALITY_PRESETS[key].sphereSegments}² · {QUALITY_PRESETS[key].starCount.toLocaleString()} stars
                    </span>
                  </button>
                ))}
              <p className="dropdown-note">Quality changes rebuild the scene once, then stay smooth.</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="icon-button"
          aria-label={state.locale === 'en' ? 'Switch language to Chinese' : 'Switch language to English'}
          title={
            state.locale === 'en'
              ? 'Language switching is wired up; Chinese copy is not written yet'
              : 'Language switching is wired up; English copy restored'
          }
          onClick={() => dispatch({ type: ActionType.SET_LOCALE, locale: state.locale === 'en' ? 'zh' : 'en' })}
        >
          <span className="mono caps">{state.locale === 'en' ? 'EN' : '中文'}</span>
        </button>

        <button
          type="button"
          className={`icon-button ${state.soundEnabled ? 'active' : ''}`}
          aria-pressed={state.soundEnabled}
          aria-label={state.soundEnabled ? 'Disable ambient sound' : 'Enable ambient sound'}
          onClick={() => dispatch({ type: ActionType.TOGGLE_SOUND })}
        >
          <span className="mono caps">{state.soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span>
        </button>
      </div>

      {planetsOpen ? (
        <div className="topbar-mega glass" role="menu" aria-label="Planets">
          <div className="mega-column">
            <p className="dropdown-label caps mono">Star</p>
            <button
              type="button"
              className="mega-item"
              onClick={() => {
                onSelectBody(SUN.id);
                setPlanetsOpen(false);
              }}
            >
              <span className="mega-dot" style={{ background: SUN.accent }} />
              <span>{SUN.name}</span>
            </button>
            <p className="dropdown-label caps mono">Planets</p>
            {PLANETS.map((planet) => (
              <button
                key={planet.id}
                type="button"
                className="mega-item"
                onClick={() => {
                  onSelectBody(planet.id);
                  setPlanetsOpen(false);
                }}
              >
                <span className="mega-dot" style={{ background: planet.accent }} />
                <span>{planet.name}</span>
                <span className="mega-meta mono">{planet.distanceFromSun.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          <div className="mega-column">
            <p className="dropdown-label caps mono">Moons</p>
            <div className="mega-moons">
              {MOONS.map((moon) => (
                <button
                  key={moon.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    onSelectBody(moon.id);
                    setPlanetsOpen(false);
                  }}
                >
                  {moon.name}
                </button>
              ))}
            </div>
            <p className="dropdown-label caps mono">Flagship missions</p>
            <div className="mega-moons">
              {MISSIONS.slice(0, 8).map((mission) => (
                <button
                  key={mission.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    onOpenMission(mission.id);
                    setPlanetsOpen(false);
                  }}
                >
                  {mission.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Search overlay: centred, hidden until opened, closed by clicking outside. */}
      <div className={`search ${searchOpen ? 'open' : ''}`} aria-hidden={!searchOpen}>
        <div className="search-field glass">
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            value={query}
            placeholder="Search planets, moons, missions…"
            aria-label="Search planets, moons and missions"
            tabIndex={searchOpen ? 0 : -1}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="search-kbd mono">ESC</kbd>
        </div>

        {searchOpen ? (
          <div className="search-results glass" role="listbox" aria-label="Search results">
            {query.trim() === '' ? (
              <div className="search-suggest">
                <p className="search-suggest-label caps mono">Try</p>
                <div className="search-chips">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="chip" onClick={() => setQuery(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : results.length === 0 ? (
              <p className="search-empty">No match for “{query}”. Try Earth, Europa or Voyager.</p>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.kind}-${result.id}`}
                  type="button"
                  className="search-result"
                  role="option"
                  aria-selected={false}
                  onClick={() => runSearch(result)}
                >
                  <span className="search-result-mark" style={{ background: result.accent || '#7FB0FF' }} />
                  <span className="search-result-text">
                    <span className="search-result-title">{result.title}</span>
                    <span className="search-result-sub">{result.subtitle}</span>
                  </span>
                  <span className="search-result-kind mono caps">{KIND_LABEL[result.kind]}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
