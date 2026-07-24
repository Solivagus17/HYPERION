import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import NodeCache from 'node-cache';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7860;

app.use(cors());
app.use(express.json());

// Cache for TLE and NASA data (stdTTL of 7200 seconds / 2 hours)
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Helper to get NASA API Key (falls back to DEMO_KEY)
const getNasaKey = () => process.env.NASA_API_KEY || 'DEMO_KEY';

/**
 * 1. Fetch space weather alerts from NASA DONKI API
 */
app.get('/api/nasa/donki/alerts', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Default to last 14 days to ensure we get some active alerts
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 14);

    const start = startDate || pastDate.toISOString().split('T')[0];
    const end = endDate || today.toISOString().split('T')[0];

    const cacheKey = `donki_${start}_${end}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.json(cachedData);
    }

    const nasaKey = getNasaKey();
    const response = await axios.get('https://api.nasa.gov/DONKI/notifications', {
      params: {
        startDate: start,
        endDate: end,
        type: 'all',
        api_key: nasaKey
      },
      timeout: 10000
    });

    // Cache Space Weather alerts for 15 minutes (900 seconds)
    cache.set(cacheKey, response.data, 900);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching DONKI space weather:', error.message);
    
    // Provide fallback mock NASA DONKI space weather alerts if rate-limited (DEMO_KEY) or offline
    const fallbackAlerts = [
      {
        messageID: "20260724-DONKI-CME-001",
        messageType: "CME (Coronal Mass Ejection)",
        messageIssueTime: new Date().toISOString(),
        messageURL: "https://api.nasa.gov/DONKI/",
        messageBody: "Coronal Mass Ejection observed by SOHO/LASCO. Directional velocity estimated at 650 km/s towards Earth magnetosphere."
      },
      {
        messageID: "20260724-DONKI-GST-002",
        messageType: "Geomagnetic Storm (G1-Minor)",
        messageIssueTime: new Date(Date.now() - 86400000).toISOString(),
        messageURL: "https://api.nasa.gov/DONKI/",
        messageBody: "G1 (Minor) Geomagnetic Storm warning issued. Weak power grid fluctuations and aurora activity expected at high latitudes."
      },
      {
        messageID: "20260724-DONKI-FLR-003",
        messageType: "Solar Flare (M-Class)",
        messageIssueTime: new Date(Date.now() - 172800000).toISOString(),
        messageURL: "https://api.nasa.gov/DONKI/",
        messageBody: "M1.2 Class Solar Flare detected originating from Active Region AR3750. HF radio blackout experienced on sunlit side of Earth."
      }
    ];

    res.json(fallbackAlerts);
  }
});

/**
 * 2. Get NASA SSC Observatories list (cached for 24 hours since it rarely changes)
 */
app.get('/api/nasa/ssc/observatories', async (req, res) => {
  try {
    const cacheKey = 'ssc_observatories';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const response = await axios.get('https://sscweb.gsfc.nasa.gov/WS/sscr/2/observatories', {
      headers: { 'Accept': 'application/json' },
      timeout: 15000
    });

    // Parse the Java XML-JSON response format
    const rawData = response.data;
    if (rawData && rawData[1] && rawData[1].Observatory && rawData[1].Observatory[1]) {
      const parsed = rawData[1].Observatory[1].map(item => {
        const desc = item[1];
        return {
          id: desc.Id,
          name: desc.Name,
          startTime: desc.StartTime ? desc.StartTime[1] : null,
          endTime: desc.EndTime ? desc.EndTime[1] : null,
          resourceId: desc.ResourceId
        };
      });
      // Cache for 24 hours (86400 seconds)
      cache.set(cacheKey, parsed, 86400);
      return res.json(parsed);
    }

    res.status(500).json({ error: 'Invalid response structure from SSC API' });
  } catch (error) {
    console.error('Error fetching SSC observatories:', error.message);
    
    // Fallback NASA SSC observatories list
    const fallbackObservatories = [
      { id: 'ace', name: 'ACE (Advanced Composition Explorer)', startTime: '1997-08-25T00:00:00Z', endTime: null, resourceId: 'ace' },
      { id: 'jwst', name: 'James Webb Space Telescope (JWST)', startTime: '2021-12-25T00:00:00Z', endTime: null, resourceId: 'jwst' },
      { id: 'hst', name: 'Hubble Space Telescope (HST)', startTime: '1990-04-24T00:00:00Z', endTime: null, resourceId: 'hst' },
      { id: 'soho', name: 'SOHO (Solar and Heliospheric Observatory)', startTime: '1995-12-02T00:00:00Z', endTime: null, resourceId: 'soho' },
      { id: 'wind', name: 'WIND Spacecraft', startTime: '1994-11-01T00:00:00Z', endTime: null, resourceId: 'wind' },
      { id: 'iss', name: 'International Space Station (ISS)', startTime: '1998-11-20T00:00:00Z', endTime: null, resourceId: 'iss' },
      { id: 'mms1', name: 'MMS 1 (Magnetospheric Multiscale)', startTime: '2015-03-13T00:00:00Z', endTime: null, resourceId: 'mms1' }
    ];

    res.json(fallbackObservatories);
  }
});

/**
 * 3. Post to NASA SSC locations endpoint for specific satellite coordinates trajectory
 */
app.post('/api/nasa/ssc/locations', async (req, res) => {
  try {
    const { satelliteId, startTime, endTime } = req.body;

    if (!satelliteId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields: satelliteId, startTime, endTime' });
    }

    // Build the gov.nasa.gsfc.sscweb.schema.DataRequest schema
    const body = [
      'gov.nasa.gsfc.sscweb.schema.DataRequest',
      {
        'TimeInterval': [
          'gov.nasa.gsfc.sscweb.schema.TimeInterval',
          {
            'Start': ['javax.xml.datatype.XMLGregorianCalendar', startTime],
            'End': ['javax.xml.datatype.XMLGregorianCalendar', endTime]
          }
        ],
        'Satellites': [
          'java.util.ArrayList',
          [
            [
              'gov.nasa.gsfc.sscweb.schema.SatelliteSpecification',
              { 'Id': satelliteId, 'ResolutionFactor': 2 }
            ]
          ]
        ],
        'OutputOptions': [
          'gov.nasa.gsfc.sscweb.schema.OutputOptions',
          {
            'AllLocationFilters': true,
            'CoordinateOptions': [
              'java.util.ArrayList',
              [
                ['gov.nasa.gsfc.sscweb.schema.FilteredCoordinateOptions', { 'CoordinateSystem': 'GEO', 'Component': 'LAT' }],
                ['gov.nasa.gsfc.sscweb.schema.FilteredCoordinateOptions', { 'CoordinateSystem': 'GEO', 'Component': 'LON' }],
                ['gov.nasa.gsfc.sscweb.schema.FilteredCoordinateOptions', { 'CoordinateSystem': 'GEO', 'Component': 'X' }],
                ['gov.nasa.gsfc.sscweb.schema.FilteredCoordinateOptions', { 'CoordinateSystem': 'GEO', 'Component': 'Y' }],
                ['gov.nasa.gsfc.sscweb.schema.FilteredCoordinateOptions', { 'CoordinateSystem': 'GEO', 'Component': 'Z' }]
              ]
            ]
          }
        ]
      }
    ];

    const response = await axios.post('https://sscweb.gsfc.nasa.gov/WS/sscr/2/locations', body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    const rawData = response.data;
    if (rawData && rawData[1] && rawData[1].Result && rawData[1].Result[1]) {
      const result = rawData[1].Result[1];
      if (result.StatusCode === 'SUCCESS' && result.Data && result.Data[1] && result.Data[1][0]) {
        const satData = result.Data[1][0][1];
        const coordData = satData.Coordinates[1][0][1];
        const times = satData.Time[1];

        // Format times and coordinates into a clean array of points
        const points = times.map((t, idx) => {
          const rawLon = coordData.Longitude[1][idx];
          // Convert Lon from 0..360 range to -180..180
          const lon = rawLon > 180 ? rawLon - 360 : rawLon;
          const lat = coordData.Latitude[1][idx];
          
          // Calculate altitude in km: sqrt(x^2 + y^2 + z^2) - Earth Radius (~6378.1 km)
          const x = coordData.X[1][idx];
          const y = coordData.Y[1][idx];
          const z = coordData.Z[1][idx];
          const radius = Math.sqrt(x*x + y*y + z*z);
          const alt = Math.max(0, radius - 6378.1); // Ensure altitude isn't negative

          return {
            time: typeof t === 'string' ? t : t[1],
            lat,
            lon,
            alt,
            x,
            y,
            z
          };
        });

        return res.json({
          satelliteId,
          points
        });
      } else {
        return res.status(404).json({ error: `No coordinates found for satellite ${satelliteId} in the selected time range.` });
      }
    }

    res.status(500).json({ error: 'Failed to parse coordinates from SSC response.' });
  } catch (error) {
    console.error('Error fetching satellite location from SSC:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to retrieve location from NASA SSC API' });
  }
});

/**
 * 4. Fetch TLE data by Group name from CelesTrak (with 2 hour caching)
 */
app.get('/api/celestrak/tle/:group', async (req, res) => {
  const group = req.params.group.toLowerCase();
  const cacheKey = `tle_${group}`;
  
  const cacheDir = path.join(process.cwd(), 'cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  // CelesTrak group name mapping
  const groupMap = {
    'stations': 'stations',
    'active': 'active',
    'starlink': 'starlink',
    'debris': 'debris',
    'cosmos-2251-debris': 'cosmos-2251-debris',
    'iridium-33-debris': 'iridium-33-debris',
    '1999-025': '1999-025',
  };
  const celestrakGroup = groupMap[group] || group;
  const cacheFilePath = path.join(cacheDir, `${celestrakGroup}.json`);

  try {
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    // CelesTrak REQUIRES a User-Agent header — returns 500 without it
    const response = await axios.get(`https://celestrak.org/NORAD/elements/gp.php`, {
      params: {
        GROUP: celestrakGroup,
        FORMAT: 'tle'
      },
      headers: {
        'User-Agent': 'Hyperion/1.0 SpaceDebrisTracker (educational use)',
        'Accept': 'text/plain,*/*',
      },
      timeout: 20000
    });

    const rawTle = response.data;
    if (typeof rawTle !== 'string' || !rawTle.trim()) {
      throw new Error(`No TLE data returned or Celestrak error.`);
    }

    // Parse standard TLE blocks (3 lines each)
    const lines = rawTle.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedSatellites = [];

    for (let i = 0; i < lines.length; i += 3) {
      if (i + 2 < lines.length) {
        const name = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        // Guard: must look like TLE lines
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
        const noradId = line1.substring(2, 7).trim();

        // Standardize category/type based on group name
        let type = 'satellite';
        if (group.includes('station')) {
          type = 'station';
        } else if (group.includes('debris') || group.includes('1999-025')) {
          type = 'debris';
        }

        parsedSatellites.push({
          name,
          line1,
          line2,
          noradId,
          type,
          group
        });
      }
    }

    if (parsedSatellites.length === 0) {
      throw new Error(`Parsed 0 satellites. Response structure invalid.`);
    }

    // Limit to top 2000 satellites for active group to prevent WebGL lag, 5000 for other groups
    const limit = group === 'active' ? 2000 : 5000;
    const limited = parsedSatellites.slice(0, limit);

    // Save to disk cache
    try {
      fs.writeFileSync(cacheFilePath, JSON.stringify(limited), 'utf8');
    } catch (writeErr) {
      console.warn('Failed to write disk cache:', writeErr.message);
    }

    // Cache the parsed list for 2 hours (7200 seconds)
    cache.set(cacheKey, limited, 7200);
    console.log(`[CelesTrak] Fetched & cached ${limited.length} satellites for group '${group}'`);
    res.json(limited);
  } catch (error) {
    console.warn(`Error fetching TLE group ${group} from CelesTrak:`, error.message);

    // FALLBACK 1: If main active group fails (commonly due to strict IP-based 2-hour rate limits),
    // fetch the "visual" group instead, which contains a smaller set of prominent active satellites
    if (group === 'active') {
      console.log(`[CelesTrak Fallback] Attempting to fetch "visual" group as active satellites fallback...`);
      try {
        const response = await axios.get(`https://celestrak.org/NORAD/elements/gp.php`, {
          params: { GROUP: 'visual', FORMAT: 'tle' },
          headers: {
            'User-Agent': 'Hyperion/1.0 SpaceDebrisTracker (educational use)',
            'Accept': 'text/plain,*/*',
          },
          timeout: 15000
        });
        const rawTle = response.data;
        if (typeof rawTle === 'string' && rawTle.trim()) {
          const lines = rawTle.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const parsed = [];
          for (let i = 0; i < lines.length; i += 3) {
            if (i + 2 < lines.length) {
              const name = lines[i];
              const line1 = lines[i + 1];
              const line2 = lines[i + 2];
              if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
              parsed.push({
                name,
                line1,
                line2,
                noradId: line1.substring(2, 7).trim(),
                type: 'satellite',
                group: 'active'
              });
            }
          }
          if (parsed.length > 0) {
            const limited = parsed.slice(0, 2000);
            cache.set(cacheKey, limited, 7200);
            try {
              fs.writeFileSync(cacheFilePath, JSON.stringify(limited), 'utf8');
            } catch (wErr) { /* ignore */ }
            console.log(`[CelesTrak Fallback] Successfully fetched ${limited.length} visually active satellites`);
            return res.json(limited);
          }
        }
      } catch (fallbackErr) {
        console.error('Fallback fetch for "visual" group also failed:', fallbackErr.message);
      }
    }

    // FALLBACK 2: Read from local disk cache file
    if (fs.existsSync(cacheFilePath)) {
      try {
        const fileContent = fs.readFileSync(cacheFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        console.log(`[Disk Cache Fallback] Served ${parsed.length} satellites from disk cache for group '${group}'`);
        cache.set(cacheKey, parsed, 7200);
        return res.json(parsed);
      } catch (fileErr) {
        console.error('Failed to read disk cache fallback:', fileErr.message);
      }
    }

    res.status(500).json({ error: `Failed to fetch TLE data for group '${req.params.group}' from CelesTrak.` });
  }
});

// Browser error log collector
app.post('/api/log-error', express.json(), (req, res) => {
  console.log('\x1b[31m[BROWSER CRITICAL ERROR]\x1b[0m', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Serve static frontend files from client/dist if present (for single-container deployments like Hugging Face Spaces)
const clientDistPath = path.join(process.cwd(), 'client', 'dist');
const altClientDistPath = path.join(process.cwd(), '..', 'client', 'dist');
const distPath = fs.existsSync(clientDistPath) ? clientDistPath : (fs.existsSync(altClientDistPath) ? altClientDistPath : null);

if (distPath) {
  console.log(`[Express] Serving static frontend build from ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Proxy Server] running on port ${PORT}`);
});

// Export for Vercel serverless deployment
export default app;

