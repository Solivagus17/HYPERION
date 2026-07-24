import React from 'react';
import { Target, Eye, X, Globe as GlobeIcon, Compass, Navigation, Gauge } from 'lucide-react';
import { type TleSatellite } from '../services/api';

interface DetailPanelProps {
  satellite: TleSatellite | null;
  onClose: () => void;
  drawOrbitPath: boolean;
  setDrawOrbitPath: (draw: boolean) => void;
  cameraLock: boolean;
  setCameraLock: (lock: boolean) => void;
  useNasaData: boolean;
  setUseNasaData: (use: boolean) => void;
  hasNasaSupport: boolean;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({
  satellite,
  onClose,
  drawOrbitPath,
  setDrawOrbitPath,
  cameraLock,
  setCameraLock,
  useNasaData,
  setUseNasaData,
  hasNasaSupport,
}) => {
  if (!satellite) return null;

  // Retrieve propagated telemetry values from the satellite object
  const lat = (satellite as any).lastLat ?? 0;
  const lon = (satellite as any).lastLon ?? 0;
  const alt = (satellite as any).lastAlt ?? 0;
  const vel = (satellite as any).lastVelocity ?? 0;
  const inc = (satellite as any).lastInclination ?? 0;
  const period = (satellite as any).lastPeriod ?? 0;

  // Format helper
  const fmt = (num: number, dec: number = 2) => num.toFixed(dec);

  // Status mapping
  let categoryLabel = 'TRACKED OBJECT';
  let categoryColor = 'text-cyan-400 border-cyan-400/30 bg-cyan-950/20';
  if (satellite.type === 'station') {
    categoryLabel = 'MANNED SPACE STATION';
    categoryColor = 'text-green-400 border-green-400/30 bg-green-950/20';
  } else if (satellite.type === 'debris') {
    categoryLabel = 'ORBITAL SPACE DEBRIS';
    categoryColor = 'text-pink-400 border-pink-500/30 bg-pink-950/20';
  } else if (satellite.group === 'nasa') {
    categoryLabel = 'NASA RESEARCH OBSERVATORY';
    categoryColor = 'text-blue-400 border-blue-500/30 bg-blue-950/20';
  }

  return (
    <div className="w-80 p-4 flex flex-col gap-4 pointer-events-auto select-none">
      {/* Detail Panel Card */}
      <div className="hud-panel p-4 flex flex-col gap-4 border border-cyan-400/20 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-500 hover:text-cyan-400 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 1. Header & ID details */}
        <div className="flex flex-col gap-1.5 pr-6">
          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 border rounded-full w-fit tracking-wider uppercase ${categoryColor}`}>
            {categoryLabel}
          </span>
          <h2 className="text-base font-bold text-slate-100 tracking-wider truncate" style={{ fontFamily: 'var(--font-title)' }}>
            {satellite.name.replace(/^[0 ]+/, '').toUpperCase()}
          </h2>
          <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 border-b border-cyan-400/10 pb-1.5">
            <span>NORAD ID: {satellite.noradId}</span>
            <span>CAT: {satellite.group.toUpperCase()}</span>
          </div>
        </div>

        {/* 2. Primary Telemetry Values */}
        <div className="grid grid-cols-2 gap-3">
          {/* Coordinates readout */}
          <div className="flex flex-col gap-1 bg-slate-950/35 p-2.5 rounded border border-slate-900">
            <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
              <Navigation className="w-3 h-3 text-cyan-500" /> LATITUDE
            </span>
            <span className="text-sm font-bold font-mono text-slate-200">
              {fmt(Math.abs(lat), 4)}°{lat >= 0 ? 'N' : 'S'}
            </span>
          </div>

          <div className="flex flex-col gap-1 bg-slate-950/35 p-2.5 rounded border border-slate-900">
            <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
              <Compass className="w-3 h-3 text-cyan-500" /> LONGITUDE
            </span>
            <span className="text-sm font-bold font-mono text-slate-200">
              {fmt(Math.abs(lon), 4)}°{lon >= 0 ? 'E' : 'W'}
            </span>
          </div>

          <div className="flex flex-col gap-1 bg-slate-950/35 p-2.5 rounded border border-slate-900">
            <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
              <GlobeIcon className="w-3 h-3 text-cyan-500" /> ALTITUDE
            </span>
            <span className="text-sm font-bold font-mono text-slate-200">
              {fmt(alt, 1)} km
            </span>
          </div>

          <div className="flex flex-col gap-1 bg-slate-950/35 p-2.5 rounded border border-slate-900">
            <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
              <Gauge className="w-3 h-3 text-cyan-500" /> VELOCITY
            </span>
            <span className="text-sm font-bold font-mono text-slate-200">
              {fmt(vel, 3)} km/s
            </span>
          </div>
        </div>

        {/* 3. Orbit Elements */}
        <div className="flex flex-col gap-2 p-2.5 rounded bg-slate-950/40 border border-slate-900 text-xs font-mono text-slate-400">
          <div className="flex justify-between border-b border-slate-900 pb-1">
            <span>INCLINATION:</span>
            <span className="text-slate-200 font-bold">{fmt(inc, 3)}°</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1">
            <span>ORBITAL PERIOD:</span>
            <span className="text-slate-200 font-bold">{fmt(period, 1)} mins</span>
          </div>
          <div className="flex justify-between">
            <span>EPOCH AGE:</span>
            <span className="text-slate-200">
              {satellite.group === 'nasa' ? 'NASA REALTIME' : 'TLE CURRENT'}
            </span>
          </div>
        </div>

        {/* 4. Action Toggles */}
        <div className="flex flex-col gap-2 pt-2 border-t border-cyan-400/10">
          <button
            onClick={() => setDrawOrbitPath(!drawOrbitPath)}
            className={`w-full flex items-center justify-between py-1.5 px-3 rounded border text-xs font-mono transition ${
              drawOrbitPath
                ? 'border-cyan-400 bg-cyan-950/20 text-cyan-400 font-bold'
                : 'border-slate-800 hover:border-slate-700 text-slate-400'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> DRAW PREDICTED ORBIT
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${drawOrbitPath ? 'bg-cyan-400' : 'bg-slate-700'}`}></span>
          </button>

          <button
            onClick={() => setCameraLock(!cameraLock)}
            className={`w-full flex items-center justify-between py-1.5 px-3 rounded border text-xs font-mono transition ${
              cameraLock
                ? 'border-cyan-400 bg-cyan-950/20 text-cyan-400 font-bold'
                : 'border-slate-800 hover:border-slate-700 text-slate-400'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" /> TARGET ACQUISITION LOCK
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${cameraLock ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'}`}></span>
          </button>

          {/* NASA SSC Toggle if applicable */}
          {hasNasaSupport && (
            <div className="flex items-center justify-between py-2 border-t border-slate-900 mt-1">
              <span className="text-[10px] font-mono text-slate-500">PREFER NASA SSC DATA:</span>
              <button
                onClick={() => setUseNasaData(!useNasaData)}
                className={`text-[9px] font-mono px-2 py-0.5 border rounded transition ${
                  useNasaData
                    ? 'border-blue-500 bg-blue-950/20 text-blue-400 font-bold'
                    : 'border-slate-800 text-slate-500'
                }`}
              >
                {useNasaData ? 'NASA ACTIVE' : 'TLE ACTIVE'}
              </button>
            </div>
          )}
        </div>

        {/* 5. Decorative Signal Strength Radar Scan HUD element */}
        <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 border-t border-slate-900 pt-2">
          <span>COMMS STRENGTH:</span>
          <div className="flex gap-0.5">
            <span className="w-1 h-2 bg-cyan-400 rounded-sm"></span>
            <span className="w-1 h-2.5 bg-cyan-400 rounded-sm"></span>
            <span className="w-1 h-3 bg-cyan-400 rounded-sm"></span>
            <span className="w-1 h-3.5 bg-cyan-400 rounded-sm"></span>
            <span className="w-1 h-4 bg-cyan-400 rounded-sm"></span>
          </div>
        </div>
      </div>
    </div>
  );
};
