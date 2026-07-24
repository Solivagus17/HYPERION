import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as satellite from 'satellite.js';
import { type TleSatellite, type SscLocationPoint } from '../services/api';

const EARTH_RADIUS = 5;
const MAX_PER_CAT = 5001; // max satellites per category buffer

interface GlobeProps {
  satellites: TleSatellite[];
  selectedSatellite: TleSatellite | null;
  onSelectSatellite: (sat: TleSatellite | null) => void;
  drawOrbitPath: boolean;
  simulationTime: Date;
  nasaPoints: SscLocationPoint[];
  useNasaData: boolean;
  cameraLock: boolean;
}

const latLonToVec3 = (lat: number, lon: number, altKm: number): THREE.Vector3 => {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r     = EARTH_RADIUS + (altKm / 6378.1) * EARTH_RADIUS;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.sin(theta),
    r  * Math.cos(phi),
    r  * Math.sin(phi) * Math.cos(theta)
  );
};

// ─── HOLOGRAM TEXTURE FACTORIES ────────────────────────────────────────────────
type HologramKind = 'station' | 'active' | 'debris' | 'nasa';

const makeHologramTexture = (kind: HologramKind): THREE.CanvasTexture => {
  const S = 64, C = 32; // size, centre
  const cvs = document.createElement('canvas');
  cvs.width = S; cvs.height = S;
  const ctx = cvs.getContext('2d')!;

  const glow = (color: string, blur: number, draw: () => void) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = blur;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    draw();
    ctx.restore();
  };

  if (kind === 'station') {
    // ── Emerald ring with crosshair + axis ticks ──
    const col = '#34d399';
    glow(col, 10, () => {
      // Outer ring
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(C, C, 22, 0, Math.PI * 2); ctx.stroke();
      // Inner ring
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(C, C, 13, 0, Math.PI * 2); ctx.stroke();
      // Crosshair (short lines inside inner ring)
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(C - 8, C); ctx.lineTo(C + 8, C);
      ctx.moveTo(C, C - 8); ctx.lineTo(C, C + 8);
      ctx.stroke();
      // 4 axis ticks at outer ring
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * 19, C + Math.sin(a) * 19);
        ctx.lineTo(C + Math.cos(a) * 24, C + Math.sin(a) * 24);
        ctx.stroke();
      }
      // Centre dot
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(C, C, 2.5, 0, Math.PI * 2); ctx.fill();
    });

  } else if (kind === 'active') {
    // ── Sky-blue target reticle (dashed outer + 4 arms) ──
    const col = '#60a5fa';
    glow(col, 8, () => {
      // Dashed outer ring
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.arc(C, C, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 4 spoke arms pointing inward
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 - Math.PI / 4;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * 10, C + Math.sin(a) * 10);
        ctx.lineTo(C + Math.cos(a) * 16, C + Math.sin(a) * 16);
        ctx.stroke();
      }
      // Solid inner fill dot
      ctx.beginPath(); ctx.arc(C, C, 4, 0, Math.PI * 2); ctx.fill();
    });

  } else if (kind === 'debris') {
    // ── Rose warning diamond with inner X ──
    const col = '#f87171';
    glow(col, 10, () => {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(C,      C - 22);
      ctx.lineTo(C + 16, C);
      ctx.lineTo(C,      C + 22);
      ctx.lineTo(C - 16, C);
      ctx.closePath();
      ctx.stroke();
      // Inner X
      const d = 7;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(C - d, C - d); ctx.lineTo(C + d, C + d);
      ctx.moveTo(C + d, C - d); ctx.lineTo(C - d, C + d);
      ctx.stroke();
    });

  } else {
    // ── Indigo hexagon with centre dot (NASA) ──
    const col = '#818cf8';
    glow(col, 8, () => {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI / 3) - Math.PI / 6;
        const x = C + Math.cos(a) * 20, y = C + Math.sin(a) * 20;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      // Centre
      ctx.beginPath(); ctx.arc(C, C, 3, 0, Math.PI * 2); ctx.fill();
    });
  }

  return new THREE.CanvasTexture(cvs);
};

const makePointsSystem = (
  texture: THREE.CanvasTexture,
  size: number
): { pts: THREE.Points; geo: THREE.BufferGeometry } => {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_PER_CAT * 3).fill(0);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.PointsMaterial({
    size,
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,
  });
  return { pts: new THREE.Points(geo, mat), geo };
};

// ── Determine hologram kind from a satellite object ──────────────────────────
const satKind = (sat: TleSatellite): HologramKind => {
  if (sat.type === 'station' || sat.group === 'stations') return 'station';
  if (sat.type === 'debris'  || sat.group?.includes('debris') || sat.group === '1999-025') return 'debris';
  if (sat.group === 'nasa')   return 'nasa';
  return 'active';
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export const Globe: React.FC<GlobeProps> = ({
  satellites,
  selectedSatellite,
  onSelectSatellite,
  drawOrbitPath,
  simulationTime,
  nasaPoints,
  useNasaData,
  cameraLock,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hoveredSatName, setHoveredSatName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Three.js core refs
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animIdRef   = useRef<number>(0);
  const initializedRef = useRef(false);

  // Per-category Points refs
  const stationPtsRef = useRef<THREE.Points | null>(null);
  const activePtsRef  = useRef<THREE.Points | null>(null);
  const debrisPtsRef  = useRef<THREE.Points | null>(null);
  const nasaPtsRef_   = useRef<THREE.Points | null>(null);

  // Per-category active satellite arrays for raycasting
  const stationSatsRef = useRef<TleSatellite[]>([]);
  const activeSatsRef  = useRef<TleSatellite[]>([]);
  const debrisSatsRef  = useRef<TleSatellite[]>([]);
  const nasaSatsRef_   = useRef<TleSatellite[]>([]);

  // Orbit & selection refs
  const orbitLineRef    = useRef<THREE.Line | null>(null);
  const selectedRingRef = useRef<THREE.Mesh | null>(null);

  // ─── INIT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return;

    const rafId = requestAnimationFrame(() => {
      if (!wrapperRef.current) return;
      initializedRef.current = true;

      const W = wrapperRef.current.offsetWidth  || window.innerWidth;
      const H = wrapperRef.current.offsetHeight || window.innerHeight;

      try {
        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x030210);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
        camera.position.set(0, 0, 16);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.domElement.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;display:block;`;
        wrapperRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.minDistance = 6.5;
        controls.maxDistance = 80;
        controlsRef.current = controls;

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
        sun.position.set(10, 5, 10);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0x7060ff, 0.18);
        fill.position.set(-10, -5, -10);
        scene.add(fill);

        // Stars
        const starGeo = new THREE.BufferGeometry();
        const sp = new Float32Array(10000 * 3);
        for (let i = 0; i < 10000 * 3; i += 3) {
          const u = Math.random(), v = Math.random();
          const t = u * 2 * Math.PI, p = Math.acos(2 * v - 1);
          const r = 300 + Math.random() * 500;
          sp[i]   = r * Math.sin(p) * Math.cos(t);
          sp[i+1] = r * Math.sin(p) * Math.sin(t);
          sp[i+2] = r * Math.cos(p);
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
          color: 0xffffff, size: 0.45, sizeAttenuation: true, transparent: true, opacity: 0.9,
        })));

        // Earth
        const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
        const earthMat = new THREE.MeshPhongMaterial({ color: 0x1a2060, specular: 0x3344aa, shininess: 20 });
        const earth = new THREE.Mesh(earthGeo, earthMat);
        scene.add(earth);

        // Clouds
        const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS + 0.07, 64, 64);
        const cloudMat = new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.28, depthWrite: false });
        const clouds = new THREE.Mesh(cloudGeo, cloudMat);
        scene.add(clouds);

        // Atmosphere
        const atmMat = new THREE.MeshBasicMaterial({ color: 0x6040ff, transparent: true, opacity: 0.07, side: THREE.BackSide });
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS + 0.38, 32, 32), atmMat));
        const atmMat2 = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.04, side: THREE.BackSide });
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS + 0.18, 32, 32), atmMat2));

        // Textures
        const loader = new THREE.TextureLoader();
        loader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', (tex) => {
          earthMat.map = tex; earthMat.color.set(0xffffff); earthMat.needsUpdate = true;
        }, undefined, () => {
          loader.load('https://unpkg.com/three-globe/example/img/earth-day.jpg', (tex) => {
            earthMat.map = tex; earthMat.color.set(0xffffff); earthMat.needsUpdate = true;
          });
        });
        loader.load('https://unpkg.com/three-globe/example/img/earth-clouds.png', (tex) => {
          cloudMat.map = tex; cloudMat.needsUpdate = true;
        });

        // ── Holographic satellite systems (one per category) ──
        const { pts: sPts } = makePointsSystem(makeHologramTexture('station'), 22);
        const { pts: aPts } = makePointsSystem(makeHologramTexture('active'),  16);
        const { pts: dPts } = makePointsSystem(makeHologramTexture('debris'),  15);
        const { pts: nPts } = makePointsSystem(makeHologramTexture('nasa'),    19);

        scene.add(sPts); scene.add(aPts); scene.add(dPts); scene.add(nPts);
        stationPtsRef.current = sPts;
        activePtsRef.current  = aPts;
        debrisPtsRef.current  = dPts;
        nasaPtsRef_.current   = nPts;

        // ── Selection ring ──
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.22, 28), ringMat);
        ring.visible = false;
        scene.add(ring);
        selectedRingRef.current = ring;

        // ── Raycaster ──
        const raycaster = new THREE.Raycaster();
        raycaster.params.Points!.threshold = 0.4;
        const mouse = new THREE.Vector2();

        const allPtsRefs = [stationPtsRef, activePtsRef, debrisPtsRef, nasaPtsRef_];
        const allSatsRefs = [stationSatsRef, activeSatsRef, debrisSatsRef, nasaSatsRef_];

        const onClick = (e: MouseEvent) => {
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
          mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          for (let i = 0; i < allPtsRefs.length; i++) {
            const pts = allPtsRefs[i].current;
            if (!pts) continue;
            const hits = raycaster.intersectObject(pts);
            if (hits.length > 0 && hits[0].index !== undefined && hits[0].index < allSatsRefs[i].current.length) {
              onSelectSatellite(allSatsRefs[i].current[hits[0].index]);
              return;
            }
          }
        };

        const onMove = (e: MouseEvent) => {
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
          mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          let found = false;
          for (let i = 0; i < allPtsRefs.length; i++) {
            const pts = allPtsRefs[i].current;
            if (!pts) continue;
            const hits = raycaster.intersectObject(pts);
            if (hits.length > 0 && hits[0].index !== undefined && hits[0].index < allSatsRefs[i].current.length) {
              setHoveredSatName(allSatsRefs[i].current[hits[0].index].name);
              renderer.domElement.style.cursor = 'crosshair';
              found = true;
              break;
            }
          }
          if (!found) {
            setHoveredSatName(null);
            renderer.domElement.style.cursor = 'grab';
          }
        };

        renderer.domElement.addEventListener('click', onClick);
        renderer.domElement.addEventListener('mousemove', onMove);

        // ── Render loop ──
        const animate = () => {
          animIdRef.current = requestAnimationFrame(animate);
          earth.rotation.y  += 0.00022;
          clouds.rotation.y += 0.00038;
          if (ring.visible) {
            ring.lookAt(camera.position);
            const s = 1 + Math.sin(Date.now() * 0.005) * 0.14;
            ring.scale.set(s, s, s);
          }
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        // ── ResizeObserver ──
        const ro = new ResizeObserver(() => {
          if (!wrapperRef.current || !rendererRef.current || !cameraRef.current) return;
          const w = wrapperRef.current.offsetWidth, h = wrapperRef.current.offsetHeight;
          if (!w || !h) return;
          rendererRef.current.setSize(w, h);
          cameraRef.current.aspect = w / h;
          cameraRef.current.updateProjectionMatrix();
        });
        ro.observe(wrapperRef.current);

        (wrapperRef.current as any).__cleanup = () => {
          cancelAnimationFrame(animIdRef.current);
          ro.disconnect();
          renderer.domElement.removeEventListener('click', onClick);
          renderer.domElement.removeEventListener('mousemove', onMove);
          if (wrapperRef.current?.contains(renderer.domElement)) wrapperRef.current.removeChild(renderer.domElement);
          renderer.dispose();
          sceneRef.current = rendererRef.current = cameraRef.current = controlsRef.current = null;
          stationPtsRef.current = activePtsRef.current = debrisPtsRef.current = nasaPtsRef_.current = null;
          selectedRingRef.current = null;
          initializedRef.current = false;
        };

      } catch (err: any) {
        console.error('[Globe] Three.js init error:', err);
        setErrorMsg(err?.message ?? String(err));
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      const cleanup = (wrapperRef.current as any)?.__cleanup;
      if (cleanup) cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── UPDATE SATELLITE POSITIONS ───────────────────────────────────────────
  useEffect(() => {
    const ptsMap: Record<HologramKind, THREE.Points | null> = {
      station: stationPtsRef.current,
      active:  activePtsRef.current,
      debris:  debrisPtsRef.current,
      nasa:    nasaPtsRef_.current,
    };

    // Verify all 4 systems initialized
    if (Object.values(ptsMap).some(p => !p)) return;

    // Separate buffers per category
    const catData: Record<HologramKind, { positions: Float32Array; count: number; sats: TleSatellite[] }> = {
      station: { positions: (ptsMap.station!.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array, count: 0, sats: [] },
      active:  { positions: (ptsMap.active!.geometry.getAttribute('position')  as THREE.BufferAttribute).array as Float32Array, count: 0, sats: [] },
      debris:  { positions: (ptsMap.debris!.geometry.getAttribute('position')  as THREE.BufferAttribute).array as Float32Array, count: 0, sats: [] },
      nasa:    { positions: (ptsMap.nasa!.geometry.getAttribute('position')    as THREE.BufferAttribute).array as Float32Array, count: 0, sats: [] },
    };

    // Add all current trajectory points if NASA data is active
    if (useNasaData && nasaPoints.length > 0) {
      const cat = catData.nasa;
      for (const pt of nasaPoints) {
        if (cat.count >= MAX_PER_CAT) break;
        const v = latLonToVec3(pt.lat, pt.lon, pt.alt);
        if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) continue;
        
        const c = cat.count;
        cat.positions[c * 3]     = v.x;
        cat.positions[c * 3 + 1] = v.y;
        cat.positions[c * 3 + 2] = v.z;
        cat.count++;
      }
    }

    for (const sat of satellites) {
      const isNasa = sat.group === 'nasa';
      if (!isNasa && (!sat.line1 || !sat.line2)) continue;
      const kind = satKind(sat);
      const cat = catData[kind];
      if (cat.count >= MAX_PER_CAT) continue;

      try {
        let lat = 0;
        let lon = 0;
        let alt = 800;
        let velocity = 7.6;
        let inclination = 45;
        let period = 120;

        if (isNasa) {
          if (useNasaData && selectedSatellite?.noradId === sat.noradId && nasaPoints.length > 0) {
            const p = nasaPoints[nasaPoints.length - 1];
            lat = p.lat;
            lon = p.lon;
            alt = p.alt;
            velocity = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z) / 1000 || 7.6;
          } else {
            // Deterministic orbital projection based on name/ID hash
            const hash = sat.noradId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            inclination = (hash % 75) * (Math.PI / 180);
            period = 95 + (hash % 150);
            const phase = (hash % 360) * (Math.PI / 180);
            
            const angle = (simulationTime.getTime() / (period * 60 * 1000)) * 2 * Math.PI + phase;
            const x = Math.cos(angle);
            const y = Math.sin(angle) * Math.cos(inclination);
            const z = Math.sin(angle) * Math.sin(inclination);
            
            const r = Math.sqrt(x*x + y*y + z*z);
            lat = Math.asin(y / r) * (180 / Math.PI);
            lon = Math.atan2(x, z) * (180 / Math.PI);
            alt = 900 + (hash % 2400);
            inclination = inclination * (180 / Math.PI);
          }
        } else {
          let satrec = (sat as any)._satrec;
          if (!satrec) {
            satrec = satellite.twoline2satrec(sat.line1, sat.line2);
            (sat as any)._satrec = satrec;
          }
          const pv = satellite.propagate(satrec, simulationTime);
          const posEci = pv?.position;
          if (!posEci || typeof posEci === 'boolean') continue;

          const gmst = satellite.gstime(simulationTime);
          const gd   = satellite.eciToGeodetic(posEci, gmst);
          lat   = satellite.degreesLat(gd.latitude);
          lon   = satellite.degreesLong(gd.longitude);
          alt   = gd.height;

          if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt) || alt < -100) continue;

          const vel = pv?.velocity;
          velocity = vel && typeof vel !== 'boolean'
            ? Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2) : 7.6;
          inclination = satrec.inclo * (180 / Math.PI);
          const mmRpd = (satrec as any).no_kozai * 1440 / (2 * Math.PI);
          period = 1440 / mmRpd;
        }

        const v = latLonToVec3(lat, lon, Math.max(0, alt));
        if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) continue;

        const c = cat.count;
        cat.positions[c * 3]     = v.x;
        cat.positions[c * 3 + 1] = v.y;
        cat.positions[c * 3 + 2] = v.z;

        // Cache telemetry on sat object
        (sat as any).lastLat = lat;
        (sat as any).lastLon = lon;
        (sat as any).lastAlt = alt;
        (sat as any).lastVelocity = velocity;
        (sat as any).lastInclination = inclination;
        (sat as any).lastPeriod = period;

        cat.sats.push(sat);
        cat.count++;
      } catch { /* skip bad TLEs */ }
    }

    // Upload to GPU
    (Object.keys(catData) as HologramKind[]).forEach(kind => {
      const pts = ptsMap[kind]!;
      const cat = catData[kind];
      pts.geometry.setDrawRange(0, cat.count);
      (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      pts.geometry.computeBoundingSphere();
    });

    stationSatsRef.current = catData.station.sats;
    activeSatsRef.current  = catData.active.sats;
    debrisSatsRef.current  = catData.debris.sats;
    nasaSatsRef_.current   = catData.nasa.sats;

    // Update selection ring
    const allActive = [...catData.station.sats, ...catData.active.sats, ...catData.debris.sats, ...catData.nasa.sats];
    const ring = selectedRingRef.current;
    if (ring) {
      const found = allActive.find(s => s.noradId === selectedSatellite?.noradId);
      if (found && !useNasaData) {
        ring.position.copy(latLonToVec3((found as any).lastLat, (found as any).lastLon, (found as any).lastAlt));
        ring.visible = true;
      } else if (useNasaData && nasaPoints.length > 0) {
        const p = nasaPoints[nasaPoints.length - 1];
        ring.position.copy(latLonToVec3(p.lat, p.lon, p.alt));
        ring.visible = true;
      } else {
        ring.visible = false;
      }
    }
  }, [satellites, simulationTime, selectedSatellite, nasaPoints, useNasaData]);

  // ─── ORBIT PATH ───────────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (orbitLineRef.current) {
      scene.remove(orbitLineRef.current);
      orbitLineRef.current.geometry.dispose();
      (orbitLineRef.current.material as THREE.Material).dispose();
      orbitLineRef.current = null;
    }

    if (!selectedSatellite || !drawOrbitPath) return;

    let pts: THREE.Vector3[] = [];

    if (useNasaData && nasaPoints.length > 0) {
      pts = nasaPoints.map(p => latLonToVec3(p.lat, p.lon, p.alt));
    } else {
      try {
        let satrec = (selectedSatellite as any)._satrec;
        if (!satrec) {
          satrec = satellite.twoline2satrec(selectedSatellite.line1, selectedSatellite.line2);
          (selectedSatellite as any)._satrec = satrec;
        }
        const mmRpd  = (satrec as any).no_kozai * 1440 / (2 * Math.PI);
        const period = 1440 / (mmRpd || 15);
        const step   = period / 120;
        for (let i = 0; i <= 120; i++) {
          const t   = new Date(simulationTime.getTime() + i * step * 60000);
          const pv  = satellite.propagate(satrec, t);
          const pos = pv?.position;
          if (!pos || typeof pos === 'boolean') continue;
          const gd  = satellite.eciToGeodetic(pos, satellite.gstime(t));
          pts.push(latLonToVec3(satellite.degreesLat(gd.latitude), satellite.degreesLong(gd.longitude), gd.height));
        }
      } catch { /* skip */ }
    }

    if (pts.length > 1) {
      const colorMap: Record<HologramKind, number> = { station: 0x34d399, active: 0x60a5fa, debris: 0xf87171, nasa: 0x818cf8 };
      const color = colorMap[satKind(selectedSatellite)];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })
      );
      scene.add(line);
      orbitLineRef.current = line;
    }
  }, [selectedSatellite, drawOrbitPath, simulationTime, nasaPoints, useNasaData]);

  // ─── CAMERA LOCK ──────────────────────────────────────────────────────────
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !cameraLock || !selectedSatellite) return;
    if (useNasaData && nasaPoints.length > 0) {
      const p = nasaPoints[nasaPoints.length - 1];
      controls.target.copy(latLonToVec3(p.lat, p.lon, p.alt));
    } else {
      const allSats = [...stationSatsRef.current, ...activeSatsRef.current, ...debrisSatsRef.current, ...nasaSatsRef_.current];
      const found = allSats.find(s => s.noradId === selectedSatellite.noradId);
      if (found) controls.target.copy(latLonToVec3((found as any).lastLat, (found as any).lastLon, (found as any).lastAlt));
    }
  }, [simulationTime, selectedSatellite, nasaPoints, useNasaData, cameraLock]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        background: '#030210',
        overflow: 'hidden',
      }}
    >
      {errorMsg && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(30,0,50,0.94)', color: '#fca5a5',
          fontFamily: "'Share Tech Mono', monospace", fontSize: '14px',
          padding: '2rem', backdropFilter: 'blur(8px)',
        }}>
          <div style={{ maxWidth: 480 }}>
            <div style={{ color: '#c084fc', fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem', fontFamily: 'Orbitron, sans-serif' }}>
              [WEBGL INITIALIZATION ERROR]
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>{errorMsg}</div>
            <div style={{ color: '#7c6fac', fontSize: '12px' }}>
              Ensure WebGL is enabled in your browser settings and GPU drivers are updated.
            </div>
          </div>
        </div>
      )}
      {hoveredSatName && (
        <div style={{
          position: 'absolute', bottom: 28, left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(10,5,30,0.92)',
          border: '1px solid rgba(167,139,250,0.5)',
          borderRadius: 4, padding: '5px 16px',
          color: '#a78bfa',
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: '11px', fontWeight: 700,
          boxShadow: '0 0 14px rgba(139,92,246,0.35)',
          pointerEvents: 'none', zIndex: 10,
          letterSpacing: '0.08em',
        }}>
          ◈ {hoveredSatName.toUpperCase()}
        </div>
      )}
    </div>
  );
};
