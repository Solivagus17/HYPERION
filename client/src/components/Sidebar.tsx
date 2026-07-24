import React, { useState } from 'react';
import { Search, Zap, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { type TleSatellite, type SpaceWeatherAlert } from '../services/api';

interface SidebarProps {
  satellites: TleSatellite[];
  selectedSatellite: TleSatellite | null;
  onSelectSatellite: (sat: TleSatellite | null) => void;
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  spaceWeatherAlerts: SpaceWeatherAlert[];
  isLoadingAlerts: boolean;
  onFetchAlerts: () => void;
  totalSatellitesCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  satellites,
  selectedSatellite,
  onSelectSatellite,
  activeFilter,
  setActiveFilter,
  searchQuery,
  setSearchQuery,
  spaceWeatherAlerts,
  isLoadingAlerts,
  onFetchAlerts,
  totalSatellitesCount,
}) => {
  const [showSpaceWeather, setShowSpaceWeather] = useState(false);

  // Categories definition
  const filters = [
    { id: 'active',   label: 'ACTIVE SATS', color: 'border-cyan-500/30 text-cyan-400' },
    { id: 'stations', label: 'STATIONS',     color: 'border-green-500/30 text-green-400' },
    { id: 'debris',   label: 'DEBRIS',       color: 'border-pink-500/30 text-pink-400' },
    { id: 'nasa',     label: 'NASA SSC',     color: 'border-blue-500/30 text-blue-400' },
  ];

  return (
    <div className="w-80 h-full flex flex-col gap-4 pointer-events-auto select-none">

      {/* 3. Space Weather Alerts Box */}
      <div className="hud-panel flex flex-col">
        <button
          onClick={() => setShowSpaceWeather(!showSpaceWeather)}
          className="w-full flex items-center justify-between p-3 text-xs font-mono font-bold text-violet-200 border-b border-cyan-400/10"
        >
          <span className="flex items-center gap-1.5 text-cyan-400/90">
            <Zap className="w-4 h-4 fill-cyan-400/30" /> SPACE WEATHER ALERTS
          </span>
          {showSpaceWeather ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showSpaceWeather && (
          <div className="p-3 max-h-48 overflow-y-auto flex flex-col gap-2 bg-black/25">
            <div className="flex justify-between items-center pb-1">
              <span className="text-[10px] text-violet-400/70 font-mono">NASA DONKI DATABASE</span>
              <button 
                onClick={onFetchAlerts} 
                disabled={isLoadingAlerts}
                className="text-[9px] font-mono text-cyan-400 hover:underline flex items-center gap-1"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${isLoadingAlerts ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            
            {isLoadingAlerts ? (
              <div className="text-center py-4 text-xs font-mono text-violet-400/60">Querying telemetry...</div>
            ) : spaceWeatherAlerts.length === 0 ? (
              <div className="text-[10px] font-mono text-green-400/80 bg-green-950/20 border border-green-500/20 p-2 rounded">
                ✔ NO ACTIVE SOLAR WEATHER ANOMALIES REPORTED. EARTH MAGNETOSPHERE IS STABLE.
              </div>
            ) : (
              spaceWeatherAlerts.map((alert) => (
                <div 
                  key={alert.messageID} 
                  className="text-[10px] font-mono p-2 rounded border border-amber-500/20 bg-amber-950/15 text-amber-300 flex flex-col gap-1"
                >
                  <div className="flex justify-between font-bold border-b border-amber-500/10 pb-0.5">
                    <span>{alert.messageType}</span>
                    <span className="text-violet-400/50">{alert.messageIssueTime.substring(0, 10)}</span>
                  </div>
                  <p className="line-clamp-2 text-violet-300/80 leading-tight">
                    {alert.messageBody.replace(/[\r\n]+/g, ' ')}
                  </p>
                  <a 
                    href={alert.messageURL} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-[9px] text-cyan-400 hover:underline mt-0.5 text-right font-bold"
                  >
                    READ FULL NASA REPORT &gt;
                  </a>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 4. Tracking and Database Filters */}
      <div className="hud-panel flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="p-3 border-b border-cyan-400/10 flex flex-col gap-2">
          {/* Search Input */}
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="SEARCH SATELLITE / NORAD ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/70 border border-cyan-400/20 rounded px-2 py-1.5 pl-8 text-xs font-mono text-cyan-400 placeholder-cyan-900/40 focus:outline-none focus:border-cyan-400/60 focus:box-shadow-cyan"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-violet-500 pointer-events-none" />
          </div>

          {/* Database Info Readout */}
          <div className="flex justify-between items-center text-[10px] font-mono text-violet-400/70">
            <span>TRACKING DATABASE:</span>
            <span className="text-cyan-400 font-bold">{satellites.length} / {totalSatellitesCount} ACTIVE</span>
          </div>
        </div>

        {/* Filter categories tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-950/20 border-b border-cyan-400/10">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`text-[10px] font-mono py-1.5 rounded border text-center transition ${
                activeFilter === f.id
                  ? 'border-cyan-400 bg-cyan-950/30 font-bold text-cyan-400 shadow-[0_0_8px_rgba(167,139,250,0.35)]'
                  : 'border-cyan-400/10 hover:border-cyan-400/30 text-violet-300 hover:text-cyan-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Target list */}
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {satellites.length === 0 ? (
            <div className="text-center py-8 text-xs font-mono text-violet-400/55">
              NO SIGNALS DETECTED
            </div>
          ) : (
            satellites.map((sat) => {
              const isSelected = selectedSatellite?.noradId === sat.noradId;
              let statusDot = 'bg-cyan-400 shadow-[0_0_5px_rgba(167,139,250,0.8)]'; // Active
              if (sat.type === 'station') {
                statusDot = 'bg-green-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]'; // Station
              } else if (sat.type === 'debris') {
                statusDot = 'bg-pink-400 shadow-[0_0_5px_rgba(248,113,113,0.8)]'; // Debris
              }

              return (
                <button
                  key={sat.noradId}
                  onClick={() => onSelectSatellite(sat)}
                  className={`w-full flex items-center justify-between text-left p-2 rounded text-xs font-mono transition border ${
                    isSelected
                      ? 'bg-cyan-950/30 border-cyan-400/70 text-cyan-300 shadow-[inset_0_0_8px_rgba(167,139,250,0.15)]'
                      : 'border-transparent hover:bg-slate-900/40 text-violet-200'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot} shrink-0`}></span>
                    <span className="truncate font-bold tracking-wide">
                      {sat.name.replace(/^[0 ]+/, '').toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[10px] text-violet-400/60 text-right shrink-0">
                    ID: {sat.noradId}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
