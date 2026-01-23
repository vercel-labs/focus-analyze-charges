# Vercel Charges Analyzer

Fetches and analyzes billing charges from the Vercel API. Generates reports showing daily usage breakdown and per-service totals with MIUs (Metered Infrastructure Units) and costs.

This is an example on how clients would use this API, with decompression, streaming, and aggregation.

## Prerequisites

- Node.js v18 or higher

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the project root with:
   ```
   API_BASE_URL=https://api.vercel.com/v1/billing/charges
   API_TOKEN=your_vercel_api_token
   TEAM_ID=your_team_id
   ```

3. Create a `data/` directory:
   ```bash
   mkdir -p data
   ```

## Usage

Analyze cached data:
```bash
node analyze-charges.js
```

Fetch fresh data from the API and analyze:
```bash
node analyze-charges.js --refresh
```

Specify custom date range (ISO 8601 format):
```bash
node analyze-charges.js --refresh --from 2025-12-01T08:00:00.000Z --to 2026-01-01T08:00:00.000Z
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--refresh` | Fetch fresh data from the API | Use cached data |
| `--from` | Start date (ISO 8601) | `2025-12-01T08:00:00.000Z` |
| `--to` | End date (ISO 8601) | `2026-01-01T08:00:00.000Z` |

## Output

The report includes:
- Daily usage breakdown by service
- Per-service totals (MIUs, effective cost, billed cost)
- Grand totals and amount due
