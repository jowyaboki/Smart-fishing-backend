export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  preferredRegion?: string;
  createdAt: string;
}

export interface FishingSession {
  id: string;
  userId: string;
  title: string;
  spotName: string;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime?: string;
  waterTemperature?: number;
  notes?: string;
  createdAt: string;
}

export interface CatchRecord {
  id: string;
  sessionId: string;
  userId: string;
  speciesName: string;
  weightKg?: number;
  lengthCm?: number;
  baitUsed?: string;
  depthMeters?: number;
  caughtAt: string;
  notes?: string;
  photoUrl?: string;
  createdAt: string;
}

export interface FishSpecies {
  id: string;
  commonName: string;
  scientificName: string;
  moroccanName?: string;
  category: 'rock' | 'beach' | 'pelagic' | 'deep_sea';
  preferredBait: string[];
  optimalTide: string;
  optimalWaterTempMin: number;
  optimalWaterTempMax: number;
  optimalWindMaxKmh: number;
  description: string;
  minLegalSizeCm?: number;
}

export interface FishingKnot {
  id: string;
  name: string;
  purpose: string;
  difficulty: 'easy' | 'medium' | 'hard';
  strengthPercentage: number;
  instructions: string[];
}
