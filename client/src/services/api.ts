import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

export interface SpaceWeatherAlert {
  messageID: string;
  messageType: string;
  messageIssueTime: string;
  messageURL: string;
  messageBody: string;
}

export interface Observatory {
  id: string;
  name: string;
  startTime: string | null;
  endTime: string | null;
  resourceId: string;
}

export interface SscLocationPoint {
  time: string;
  lat: number;
  lon: number;
  alt: number;
  x: number;
  y: number;
  z: number;
}

export interface SscLocationResponse {
  satelliteId: string;
  points: SscLocationPoint[];
}

export interface TleSatellite {
  name: string;
  line1: string;
  line2: string;
  noradId: string;
  type: 'satellite' | 'station' | 'debris';
  group: string;
}

export const api = {
  /**
   * Fetch space weather alerts from NASA DONKI
   */
  async getSpaceWeatherAlerts(): Promise<SpaceWeatherAlert[]> {
    try {
      const response = await apiClient.get<SpaceWeatherAlert[]>('/api/nasa/donki/alerts');
      return response.data;
    } catch (error) {
      console.error('API Error: getSpaceWeatherAlerts', error);
      throw error;
    }
  },

  /**
   * Fetch list of observatories from NASA SSC
   */
  async getSscObservatories(): Promise<Observatory[]> {
    try {
      const response = await apiClient.get<Observatory[]>('/api/nasa/ssc/observatories');
      return response.data;
    } catch (error) {
      console.error('API Error: getSscObservatories', error);
      throw error;
    }
  },

  /**
   * Fetch coordinate trajectory of an observatory from NASA SSC
   */
  async getSscLocations(satelliteId: string, startTime: string, endTime: string): Promise<SscLocationResponse> {
    try {
      const response = await apiClient.post<SscLocationResponse>('/api/nasa/ssc/locations', {
        satelliteId,
        startTime,
        endTime
      });
      return response.data;
    } catch (error) {
      console.error('API Error: getSscLocations', error);
      throw error;
    }
  },

  /**
   * Fetch TLE satellites for a group from CelesTrak (via backend proxy cache)
   */
  async getTleData(group: string): Promise<TleSatellite[]> {
    try {
      const response = await apiClient.get<TleSatellite[]>(`/api/celestrak/tle/${group}`);
      return response.data;
    } catch (error) {
      console.error(`API Error: getTleData (${group})`, error);
      throw error;
    }
  }
};
