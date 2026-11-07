# Smart Fishing Morocco - Backend Service

A high-performance TypeScript backend service providing API parity with the Smart Fishing Morocco application based on the system audit specification.

## Features

- **Authentication & User Management (P0)**: Secure JWT-based authentication, user registration, login, and profile fetching.
- **Marine Weather & Tides (P0)**: Open-Meteo proxy with in-memory caching and resilient offline simulation for Moroccan Atlantic and Mediterranean coasts.
- **Smart Fishing Score Engine (P0/P1)**: Mathematical weighted formula:
  $$\text{Final Score} = (\text{Wave} \times 0.25) + (\text{Wind} \times 0.20) + (\text{Tide} \times 0.20) + (\text{Solunar} \times 0.20) + (\text{Species} \times 0.15)$$
  Includes automatic safety and risk assessment (Safe, Moderate, High, Severe).
- **Fishing Journal & Catch Logging (P0/P1)**: Session tracking, catch logs, target spots, and photo associations with user isolation.
- **AI Fishing Assistant (P1)**: Google Gemini API integration with rule-based fallback expert system trained on Moroccan surfcasting and rock fishing techniques.
- **Encyclopedia & Knots (P2)**: Moroccan coastal fish species (Loubina, Dorade, Sar, Meagre, etc.) and essential fishing knots.

## Architecture

- **Runtime & Language**: Node.js & TypeScript
- **Web Framework**: Express, Helmet, CORS, Morgan
- **Validation**: Zod schema validation
- **Persistence**: SQLite (via `better-sqlite3`) with WAL mode, foreign keys, indices, and in-memory test support
- **Testing**: Vitest, Supertest

## API Endpoints

### Health Check
- `GET /health`

### Authentication (`/api/v1/auth`)
- `POST /register`: Register a new user
- `POST /login`: Log in and receive JWT token
- `GET /me`: Get authenticated user profile (Requires `Authorization: Bearer <token>`)

### Marine & Tides (`/api/v1/marine`)
- `GET /forecast?latitude={lat}&longitude={lon}&days={1-7}`: Weather, swell, and wind forecast
- `GET /tides?latitude={lat}&longitude={lon}&date={YYYY-MM-DD}`: Tide levels, moon phase, and solunar ratings

### Fishing Score Engine (`/api/v1/fishing`)
- `POST /score`: Compute score breakdown and safety assessment from wave, wind, tide, solunar, and target species factors

### Journal & Catches (`/api/v1/journal`) *(Requires Auth)*
- `POST /sessions`: Create a new fishing session
- `GET /sessions`: List all user fishing sessions
- `GET /sessions/:id`: Get session details with associated catches
- `POST /catches`: Log a new catch
- `GET /catches`: List all catches for user

### AI Assistant (`/api/v1/ai`)
- `POST /fishing-assistant`: Ask questions regarding tactics, bait, spots, or gear

### Encyclopedia (`/api/v1/encyclopedia`)
- `GET /species`: List fish species (optional query `?category=beach|rock|pelagic|deep_sea`)
- `GET /species/:id`: Retrieve specific species details
- `GET /knots`: List fishing knots with instructions
- `GET /knots/:id`: Retrieve knot details

## Getting Started

### Installation
```bash
npm install
```

### Build & Run
```bash
# Build TypeScript
npm run build

# Start production server
npm start

# Development with hot-reload
npm run dev
```

### Running Tests
```bash
npm test
```
