const fs = require('fs');
const readline = require('readline');
const https = require('https');
const zlib = require('zlib');
const path = require('path');
require('dotenv').config();

const CHARGES_FILE = path.join(__dirname, 'data', 'charges.jsonl');
const API_BASE_URL = process.env.API_BASE_URL;
const API_TOKEN = process.env.API_TOKEN;
const TEAM_ID = process.env.TEAM_ID;

const DEFAULT_FROM_DATE = '2025-12-01T08:00:00.000Z';
const DEFAULT_TO_DATE = '2026-01-01T08:00:00.000Z';

let FROM_DATE = DEFAULT_FROM_DATE;
let TO_DATE = DEFAULT_TO_DATE;
let SHOULD_REFRESH = false;

function parseArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      FROM_DATE = args[i + 1];
    } else if (args[i] === '--to' && args[i + 1]) {
      TO_DATE = args[i + 1];
    } else if (args[i] === '--refresh') {
      SHOULD_REFRESH = true;
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function refreshCharges() {
  return new Promise((resolve, reject) => {
    console.log('\n[1/2] REFRESHING DATA FROM API');
    console.log('===========================================');
    console.log(`Team: ${TEAM_ID}`);
    console.log(`From: ${FROM_DATE}`);
    console.log(`To:   ${TO_DATE}`);
    console.log('');

    const url = new URL(API_BASE_URL);
    url.searchParams.set('from', FROM_DATE);
    url.searchParams.set('to', TO_DATE);
    url.searchParams.set('teamId', TEAM_ID);

    console.log(`Connecting to ${url.hostname}...`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate'
      }
    };

    const req = https.request(options, (res) => {
      const encoding = res.headers['content-encoding'];
      console.log(`Connected! Status: ${res.statusCode}${encoding ? ` (${encoding})` : ''}`);
      console.log('Downloading data...');

      const chunks = [];
      let bytesReceived = 0;

      // Decompress if needed
      let stream = res;
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on('data', (chunk) => {
        chunks.push(chunk);
        bytesReceived += chunk.length;
        process.stdout.write(`\r  Received: ${formatBytes(bytesReceived)}`);
      });

      stream.on('end', () => {
        process.stdout.write('\n');
        const data = Buffer.concat(chunks);
        console.log(`Download complete: ${formatBytes(data.length)}`);
        console.log(`Saving to ${CHARGES_FILE}...`);
        fs.writeFileSync(CHARGES_FILE, data);
        console.log('Saved!\n');
        resolve();
      });

      stream.on('error', (err) => {
        console.error(`\nDecompression error: ${err.message}`);
        reject(err);
      });
    });

    req.on('error', (err) => {
      console.error(`\nError: ${err.message}`);
      reject(err);
    });
    req.end();
  });
}

async function analyze(stepLabel = 'ANALYZING CHARGES') {
  console.log(`\n${stepLabel}`);
  console.log('===========================================');
  console.log(`Reading from ${CHARGES_FILE}...`);

  const rl = readline.createInterface({
    input: fs.createReadStream(CHARGES_FILE),
    crlfDelay: Infinity
  });

  // Track by day -> service
  const dailyUsage = new Map();
  let lineCount = 0;

  // Track by service name (totals)
  const services = new Map();

  // Grand totals
  let grandMius = 0;
  let grandEffective = 0;
  let grandBilled = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const charge = JSON.parse(line);
    lineCount++;
    if (lineCount % 500 === 0) {
      process.stdout.write(`\r  Processed ${lineCount} charges...`);
    }

    const serviceName = charge.ServiceName || 'Unknown';
    const mius = charge.PricingQuantity || 0;
    const effective = charge.EffectiveCost || 0;
    const billed = charge.BilledCost || 0;

    // Extract date (try common field names)
    const dateStr = charge.ChargePeriodStart || charge.BillingPeriodStartDate || charge.ChargeDate || charge.Date || '';
    const day = dateStr ? dateStr.substring(0, 10) : 'Unknown';

    // Accumulate grand totals
    grandMius += mius;
    grandEffective += effective;
    grandBilled += billed;

    // Accumulate per service (totals)
    if (!services.has(serviceName)) {
      services.set(serviceName, { mius: 0, effective: 0, billed: 0 });
    }
    const svc = services.get(serviceName);
    svc.mius += mius;
    svc.effective += effective;
    svc.billed += billed;

    // Accumulate per day per service
    if (!dailyUsage.has(day)) {
      dailyUsage.set(day, new Map());
    }
    const dayServices = dailyUsage.get(day);
    if (!dayServices.has(serviceName)) {
      dayServices.set(serviceName, { mius: 0, effective: 0, billed: 0 });
    }
    const daySvc = dayServices.get(serviceName);
    daySvc.mius += mius;
    daySvc.effective += effective;
    daySvc.billed += billed;
  }

  // Sort days chronologically
  const sortedDays = [...dailyUsage.keys()].sort();

  process.stdout.write(`\r  Processed ${lineCount} charges.    \n`);
  console.log(`Found ${sortedDays.length} days, ${services.size} services`);
  console.log('Generating report...\n');

  // Output per day breakdown
  console.log('DAILY USAGE BREAKDOWN');
  console.log('===========================================');
  for (const day of sortedDays) {
    const dayServices = dailyUsage.get(day);
    const sortedServices = [...dayServices.entries()].sort((a, b) => b[1].mius - a[1].mius);

    // Calculate day totals
    let dayMius = 0;
    for (const [, data] of sortedServices) {
      dayMius += data.mius;
    }

    console.log(`\n${day} (Total MIUs: ${dayMius.toFixed(4)})`);
    console.log('-------------------------------------------');
    for (const [name, data] of sortedServices) {
      console.log(`  ${name}: ${data.mius.toFixed(4)} MIUs ($${data.billed.toFixed(4)})`);
    }
  }

  // Sort services by MIUs descending
  const sorted = [...services.entries()].sort((a, b) => b[1].mius - a[1].mius);

  // Output per service totals
  console.log('\n\n===========================================');
  console.log('PER-SERVICE TOTALS');
  console.log('===========================================');
  for (const [name, data] of sorted) {
    console.log(`${name}`);
    console.log(`  Total MIUs:     ${data.mius.toFixed(4)}`);
    console.log(`  EffectiveCost:  $${data.effective.toFixed(4)}`);
    console.log(`  BilledCost:     $${data.billed.toFixed(4)}`);
    console.log('');
  }

  // Grand totals
  console.log('===========================================');
  console.log('GRAND TOTALS');
  console.log('===========================================');
  console.log(`  Total MIUs:        ${grandMius.toFixed(4)}`);
  console.log(`  Total Effective:   $${grandEffective.toFixed(4)}`);
  console.log(`  Total Billed:      $${grandBilled.toFixed(4)}`);
  console.log('');
  console.log(`  Amount Due:        $${grandBilled.toFixed(4)}`);
}

async function main() {
  const args = process.argv.slice(2);
  parseArgs(args);

  console.log('===========================================');
  console.log('       VERCEL CHARGES ANALYZER');
  console.log('===========================================');

  if (SHOULD_REFRESH) {
    await refreshCharges();
    await analyze('[2/2] ANALYZING CHARGES');
  } else {
    console.log('\nUsing cached data (run with --refresh to fetch new data)');
    await analyze('[1/1] ANALYZING CHARGES');
  }

  console.log('\n===========================================');
  console.log('Done!');
}

main();
