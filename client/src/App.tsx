import { useState, useEffect, useRef } from 'react';
import { Globe } from './components/Globe';
import { Sidebar } from './components/Sidebar';
import { DetailPanel } from './components/DetailPanel';
import { api, type TleSatellite, type SpaceWeatherAlert, type SscLocationPoint } from './services/api';
import './App.css';

function App() {
  // Satellites database states
  const [allSatellites, setAllSatellites] = useState<TleSatellite[]>([]);
  const [filteredSatellites, setFilteredSatellites] = useState<TleSatellite[]>([]);
  const [selectedSatellite, setSelectedSatellite] = useState<TleSatellite | null>(null);
  
  // HUD Filters and Search
  const [activeFilter, setActiveFilter] = useState<string>('stations'); // default to Space Stations (light & fast loading)
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Space Weather Alert states
  const [spaceWeatherAlerts, setSpaceWeatherAlerts] = useState<SpaceWeatherAlert[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState<boolean>(false);
  
  // Time and propagation states
  const [simulationTime, setSimulationTime] = useState<Date>(new Date());
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeMultiplier, setTimeMultiplier] = useState<number>(1); // simulation speed multipliers (1x, 5x, 10x, 60x, etc.)
  
  // Toggle states
  const [drawOrbitPath, setDrawOrbitPath] = useState<boolean>(true);
  const [cameraLock, setCameraLock] = useState<boolean>(false);
  
  // NASA SSC specific states
  const [useNasaData, setUseNasaData] = useState<boolean>(false);
  const [nasaPoints, setNasaPoints] = useState<SscLocationPoint[]>([]);
  
  // Refs
  const lastTimeRef = useRef<number>(Date.now());
  const frameIdRef = useRef<number | null>(null);

  // Fetch Space Weather alerts on mount
  const fetchSpaceWeather = async () => {
    setIsLoadingAlerts(true);
    try {
      const alerts = await api.getSpaceWeatherAlerts();
      // Only keep the most recent 5 alerts to keep sidebar clean
      setSpaceWeatherAlerts(alerts.slice(0, 5));
    } catch (err) {
      console.error('Failed to load space weather notifications', err);
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  useEffect(() => {
    fetchSpaceWeather();
  }, []);

  // Fetch satellites when activeFilter changes
  useEffect(() => {
    const fetchData = async () => {
      setAllSatellites([]);
      
      try {
        if (activeFilter === 'nasa') {
          // Fetch from NASA SSC
          const obsList = await api.getSscObservatories();
          
          // Map observatories into TleSatellite format (with mock TLE lines so Globe component can render placeholders if needed, though we will overlay actual NASA points on click)
          const mappedObs: TleSatellite[] = obsList.map((obs) => ({
            name: obs.name,
            noradId: obs.id, // Use unique alphanumeric string as ID
            line1: '', // Empty since it uses coordinate list
            line2: '',
            type: 'satellite',
            group: 'nasa',
          }));
          setAllSatellites(mappedObs);
        } else if (activeFilter === 'debris') {
          // Space Debris includes multiple CelesTrak groups (Cosmos 2251, Iridium 33, Fengyun-1C, 1999-025, etc.)
          const groups = ['cosmos-2251-debris', 'iridium-33-debris', '1999-025'];
          const results = await Promise.all(
            groups.map((grp) => 
              api.getTleData(grp).catch((e) => {
                console.warn(`Failed to fetch debris group ${grp}`, e);
                return [] as TleSatellite[];
              })
            )
          );
          
          // Combine all debris sets into one list
          const combined = results.flat();
          setAllSatellites(combined);
        } else {
          // Fetch single group (active / stations)
          const data = await api.getTleData(activeFilter);
          setAllSatellites(data);
        }
      } catch (err) {
        console.error(`Error loading database group: ${activeFilter}`, err);
      }
    };
    
    fetchData();
    // Auto-clear selection when filter changes
    setSelectedSatellite(null);
    setNasaPoints([]);
    setUseNasaData(false);
  }, [activeFilter]);

  // Apply Search query & Filter on the loaded satellites list
  useEffect(() => {
    if (allSatellites.length === 0) {
      setFilteredSatellites([]);
      return;
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFilteredSatellites(allSatellites);
      return;
    }

    const filtered = allSatellites.filter(
      (sat) =>
        sat.name.toLowerCase().includes(query) ||
        sat.noradId.toLowerCase().includes(query)
    );
    setFilteredSatellites(filtered);
  }, [allSatellites, searchQuery]);

  // If a NASA SSC satellite is selected, fetch its actual coordinates from the proxy server
  useEffect(() => {
    if (!selectedSatellite || selectedSatellite.group !== 'nasa') {
      setNasaPoints([]);
      setUseNasaData(false);
      return;
    }

    const fetchNasaLocations = async () => {
      try {
        // Fetch positions for a 3-hour window around simulation time
        const baseTime = simulationTime;
        const start = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
        const end = new Date(baseTime.getTime() + 1 * 60 * 60 * 1000);

        const response = await api.getSscLocations(
          selectedSatellite.noradId,
          start.toISOString(),
          end.toISOString()
        );
        
        if (response.points && response.points.length > 0) {
          setNasaPoints(response.points);
          setUseNasaData(true);
          
          // Attach latest coords to satellite for telemetry view
          const latestPt = response.points[response.points.length - 1];
          (selectedSatellite as any).lastLat = latestPt.lat;
          (selectedSatellite as any).lastLon = latestPt.lon;
          (selectedSatellite as any).lastAlt = latestPt.alt;
          
          // Speed: calculate from velocity components
          (selectedSatellite as any).lastVelocity = Math.sqrt(
            latestPt.x * latestPt.x +
            latestPt.y * latestPt.y +
            latestPt.z * latestPt.z
          ) / 1000;
          (selectedSatellite as any).lastInclination = 45; // Placeholder
          (selectedSatellite as any).lastPeriod = 120; // Placeholder
        }
      } catch (err) {
        console.error('Failed to load NASA SSC coordinates', err);
        setUseNasaData(false);
      }
    };

    fetchNasaLocations();
  }, [selectedSatellite]);

  // Real-time tick update loop
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const deltaMs = now - lastTimeRef.current;
      lastTimeRef.current = now;

      if (!isPaused) {
        setSimulationTime((prev) => {
          // Increment simulation time by delta * multiplier
          const incMs = deltaMs * timeMultiplier;
          return new Date(prev.getTime() + incMs);
        });
      }

      frameIdRef.current = requestAnimationFrame(tick);
    };

    lastTimeRef.current = Date.now();
    frameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [isPaused, timeMultiplier]);

  const handleSelectSatellite = (sat: TleSatellite | null) => {
    setSelectedSatellite(sat);
    if (!sat) {
      setCameraLock(false);
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col select-none bg-slate-950">
      {/* 1. Sleek Top Header Bar */}
      <div className="w-full shrink-0 hud-panel z-10 flex justify-between items-center px-6 py-3 border-b border-cyan-400/20 pointer-events-auto bg-slate-950/70 select-none" style={{ borderRadius: '0px' }}>
        {/* Left Side: Title and Status */}
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-widest text-cyan-400" style={{ fontFamily: 'var(--font-title)' }}>
            HYPERION
          </h1>
          <div className="flex items-center gap-1.5 border border-cyan-400/30 px-2 py-0.5 rounded-sm bg-cyan-950/20 font-mono text-cyan-400 font-bold" style={{ fontSize: '9px' }}>
            LIVE FEED
          </div>
        </div>

        {/* Center: Mission Time Clock */}
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-mono" style={{ fontSize: '10px' }}>MISSION TIME:</span>
          <span className="font-bold text-cyan-400 font-mono tracking-widest bg-slate-950/50 px-3 py-1 rounded border border-cyan-400/10" style={{ fontSize: '12px' }}>
            {simulationTime.toISOString().replace('T', ' ').substring(0, 19)} UTC
          </span>
        </div>

        {/* Right Side: Simulation Control Widgets */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsPaused(!isPaused)} 
            className="flex items-center gap-2 py-1 px-3 rounded border border-cyan-400/30 hover:border-cyan-400 text-xs font-mono text-cyan-400 transition bg-cyan-950/20"
          >
            {isPaused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>

          <div className="flex items-center gap-1.5 border border-cyan-400/20 rounded px-2.5 py-0.5 bg-cyan-950/10">
            <span className="font-mono text-slate-500 uppercase" style={{ fontSize: '9px' }}>SPEED:</span>
            <select
              value={timeMultiplier}
              onChange={(e) => setTimeMultiplier(Number(e.target.value))}
              className="bg-transparent border-none text-cyan-400 text-xs font-mono font-bold focus:outline-none cursor-pointer"
              style={{ paddingRight: '0.5rem' }}
            >
              <option value={1} className="bg-slate-900">1x</option>
              <option value={5} className="bg-slate-900">5x</option>
              <option value={10} className="bg-slate-900">10x</option>
              <option value={60} className="bg-slate-900">60x</option>
              <option value={600} className="bg-slate-900">600x</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. Interactive Map/HUD Container */}
      <div className="flex-1 w-full relative min-h-0">
        {/* 3D Globe Canvas (Background layer) */}
        <div className="absolute inset-0 w-full h-full z-0">
          <Globe
            satellites={filteredSatellites}
            selectedSatellite={selectedSatellite}
            onSelectSatellite={handleSelectSatellite}
            drawOrbitPath={drawOrbitPath}
            simulationTime={simulationTime}
            nasaPoints={nasaPoints}
            useNasaData={useNasaData}
            cameraLock={cameraLock}
          />
        </div>

        {/* 2D Control Dashboard (Foreground UI overlay) */}
        <div className="absolute inset-0 w-full h-full z-10 flex justify-between pointer-events-none p-4">
          {/* Left Side: Search list, Filters, Solar Alerts */}
          <Sidebar
            satellites={filteredSatellites}
            selectedSatellite={selectedSatellite}
            onSelectSatellite={handleSelectSatellite}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            spaceWeatherAlerts={spaceWeatherAlerts}
            isLoadingAlerts={isLoadingAlerts}
            onFetchAlerts={fetchSpaceWeather}
            totalSatellitesCount={allSatellites.length}
          />

          {/* Right Side: Object Detail HUD readout */}
          {selectedSatellite && (
            <DetailPanel
              satellite={selectedSatellite}
              onClose={() => handleSelectSatellite(null)}
              drawOrbitPath={drawOrbitPath}
              setDrawOrbitPath={setDrawOrbitPath}
              cameraLock={cameraLock}
              setCameraLock={setCameraLock}
              useNasaData={useNasaData}
              setUseNasaData={setUseNasaData}
              hasNasaSupport={selectedSatellite.group === 'nasa'}
            />
          )}
        </div>
      </div>

      {/* Futuristic Scanline and Vignette effects overlays */}
      <div className="absolute inset-0 pointer-events-none z-20" style={{ boxShadow: 'inset 0 0 80px rgba(0,0,0,0.7)' }}></div>
      <div className="absolute inset-0 pointer-events-none z-20" style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 60%, rgba(3,7,18,0.45) 100%)' }}></div>
    </div>
  );
}

export default App;
