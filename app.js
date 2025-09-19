// ===== helper: live clock =====
const clockEl = document.getElementById('clock');
function pad(n){ return (n<10?'0':'')+n; }
function tickClock(){
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const s = `${days[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  clockEl.textContent = s;
}
setInterval(tickClock, 1000); tickClock();

// ambient temp (optional separate sensor) — element may not exist
const ambientTempEl = document.getElementById('ambientTemp');
if (ambientTempEl) ambientTempEl.textContent = '00.0°C';

// ===== Simple gauge driver (stroke dashoffset from value 0..100) =====
function setGauge(fillId, value){
  const maxLen = 126; // length of the arc path
  const clamped = Math.max(0, Math.min(100, value));
  const offset = maxLen - (clamped/100)*maxLen;
  const el = document.getElementById(fillId);
  if (el) el.style.strokeDashoffset = offset;
}

// ======== DATA STATE ========
// default demo values (will be replaced by ThingSpeak if configured)
const dataState = {
  klong: { pm25: 12, aqi: 40, temp: 29.4 },
  thon:  { pm25: 18, aqi: 55, temp: 30.2 },
  bang:  { pm25: 25, aqi: 70, temp: 31.1 }
};

// ======== THINGSPEAK CONFIG ========
// ใส่ค่าให้ตรงช่องของคุณ (channelId, readKey, field)
// คุณสามารถใช้ Channel เดียวหลายฟิลด์หรือคนละ Channel ก็ได้
const THINGSPEAK = {
  // PM2.5 per district - ตาม ThingSpeak Channel ที่มี Field 1, 2, 3 เป็น PM2.5
  klong_pm25: { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 1 },
  thon_pm25:  { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 2 },
  bang_pm25:  { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 3 },

  // Temperature per district (°C) - ใช้ channelId 3027679 เช่นกัน
  klong_temp: { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 4 },
  thon_temp:  { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 4 },
  bang_temp:  { channelId: "3027679", readKey: "4M306YRQZ87072KV", field: 4 },

  // refresh period (ms)
  intervalMs: 15000 // 15 วินาที
};

// ======== Trend (24H) config ========
const TREND = {
  liveRefreshMs: 5 * 60 * 1000 // refresh charts every 5 minutes in live mode
};
let trendTimerPM = null;
let trendTimerTemp = null;

// ======== Chart holders ========
let pmChart = null;
let tempChart = null;

function colorVar(name, fallback){
  const s = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return s || fallback;
}

function buildLineChart(ctx, title, datasets){
  return new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: colorVar('--fg','#e8f1ff') } },
        title: { display: false }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', tooltipFormat: 'MMM d HH:mm' },
          ticks: { color: colorVar('--muted','#95b0d1') },
          grid: { color: 'rgba(79, 168, 232, 0.12)' }
        },
        y: {
          ticks: { color: colorVar('--muted','#95b0d1') },
          grid: { color: 'rgba(79, 168, 232, 0.12)' }
        }
      },
      elements: { line: { tension: 0.25, borderWidth: 2 }, point: { radius: 0 } }
    }
  });
}

function ds(label, color){
  return {
    label,
    data: [],
    parsing: false,
    borderColor: color,
    backgroundColor: color,
    fill: false
  };
}

function nowUtc(){ return new Date(); }

function rangeLast24h(){
  const end = new Date();
  const start = new Date(end.getTime() - 24*60*60*1000);
  return { start, end };
}

function rangeForDate(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d);
  const end = new Date(d.getTime() + 24*60*60*1000);
  return { start, end };
}

async function fetchSeries({ channelId, readKey, field }, start, end){
  const base = `https://api.thingspeak.com/channels/${channelId}/feeds.json`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const params = new URLSearchParams({
    start: toLocalTS(start),
    end: toLocalTS(end),
    timezone: tz
  });
  if(readKey) params.set('api_key', readKey);
  const url = `${base}?${params.toString()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if(!r.ok) throw new Error('ThingSpeak series fetch failed');
  const j = await r.json();
  const out = [];
  if(j && Array.isArray(j.feeds)){
    for(const f of j.feeds){
      const t = f.created_at;
      const v = toNumberOrNull(f[`field${field}`]);
      if(v !== null && t) out.push({ x: new Date(t), y: v });
    }
  }
  return out.sort((a,b)=>a.x-b.x);
}

async function loadPMTrend(start, end){
  try{
    const [kl, th, ba] = await Promise.all([
      fetchSeries(THINGSPEAK.klong_pm25, start, end),
      fetchSeries(THINGSPEAK.thon_pm25, start, end),
      fetchSeries(THINGSPEAK.bang_pm25, start, end)
    ]);
    ensurePMChart();
    const c1 = '#4fa8e8';
    const c2 = '#1dd196';
    const c3 = '#f4c742';
    pmChart.data.datasets[0].data = kl;
    pmChart.data.datasets[1].data = th;
    pmChart.data.datasets[2].data = ba;
    pmChart.update();
  }catch(e){ console.warn('loadPMTrend error', e); }
}

async function loadTempTrend(start, end){
  try{
    const [kl, th, ba] = await Promise.all([
      fetchSeries(THINGSPEAK.klong_temp, start, end),
      fetchSeries(THINGSPEAK.thon_temp, start, end),
      fetchSeries(THINGSPEAK.bang_temp, start, end)
    ]);
    ensureTempChart();
    tempChart.data.datasets[0].data = kl;
    tempChart.data.datasets[1].data = th;
    tempChart.data.datasets[2].data = ba;
    tempChart.update();
  }catch(e){ console.warn('loadTempTrend error', e); }
}

function ensurePMChart(){
  if(pmChart) return;
  const el = document.getElementById('pmTrend');
  if(!el) return;
  const c1 = '#4fa8e8';
  const c2 = '#1dd196';
  const c3 = '#f4c742';
  pmChart = buildLineChart(el.getContext('2d'), 'PM2.5 24H', [
    ds('Klong San', c1),
    ds('Thon Buri', c2),
    ds('Bang Rak', c3)
  ]);
}

function ensureTempChart(){
  if(tempChart) return;
  const el = document.getElementById('tempTrend');
  if(!el) return;
  const c1 = '#4fa8e8';
  const c2 = '#1dd196';
  const c3 = '#f4c742';
  tempChart = buildLineChart(el.getContext('2d'), 'Temperature 24H', [
    ds('Klong San', c1),
    ds('Thon Buri', c2),
    ds('Bang Rak', c3)
  ]);
}

function scheduleTrendTimers(){
  if(trendTimerPM){ clearInterval(trendTimerPM); trendTimerPM=null; }
  if(trendTimerTemp){ clearInterval(trendTimerTemp); trendTimerTemp=null; }
  if(!isViewingPM){
    // live mode for PM
    trendTimerPM = setInterval(()=>{
      const { start, end } = rangeLast24h();
      loadPMTrend(start, end);
    }, TREND.liveRefreshMs);
  }
  if(!isViewingTemp){
    trendTimerTemp = setInterval(()=>{
      const { start, end } = rangeLast24h();
      loadTempTrend(start, end);
    }, TREND.liveRefreshMs);
  }
}

// ===== Date viewing state (separate PM and Temp) =====
let liveIntervalPM = null;
let liveIntervalTemp = null;
let isViewingPM = false;   // viewing historical date for PM section
let isViewingTemp = false; // viewing historical date for Temp section

// PM controls
const viewingTagPM = document.getElementById('viewingTagPM');
const dateInputPM = document.getElementById('viewDatePM');
// removed Load button for PM
const btnTodayPM = document.getElementById('btnTodayPM');

// Temp controls
const viewingTagTemp = document.getElementById('viewingTagTemp');
const dateInputTemp = document.getElementById('viewDateTemp');
// removed Load button for Temp
const btnTodayTemp = document.getElementById('btnTodayTemp');

function setViewingModePM(live){
  isViewingPM = !live;
  if(live){
    if(viewingTagPM){ viewingTagPM.textContent = 'live'; viewingTagPM.style.color = '#9ad0ff'; }
    if(liveIntervalPM==null){ liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000); }
    pollThingSpeakPM();
    // Load live 24h trend
    const { start, end } = rangeLast24h();
    loadPMTrend(start, end);
    scheduleTrendTimers();
  }else{
    if(viewingTagPM){ viewingTagPM.textContent = 'history'; viewingTagPM.style.color = '#ffd166'; }
    if(liveIntervalPM){ clearInterval(liveIntervalPM); liveIntervalPM=null; }
    if(trendTimerPM){ clearInterval(trendTimerPM); trendTimerPM=null; }
  }
}

function setViewingModeTemp(live){
  isViewingTemp = !live;
  if(live){
    if(viewingTagTemp){ viewingTagTemp.textContent = 'live'; viewingTagTemp.style.color = '#9ad0ff'; }
    if(liveIntervalTemp==null){ liveIntervalTemp = setInterval(pollThingSpeakTemp, THINGSPEAK.intervalMs || 15000); }
    pollThingSpeakTemp();
    const { start, end } = rangeLast24h();
    loadTempTrend(start, end);
    scheduleTrendTimers();
  }else{
    if(viewingTagTemp){ viewingTagTemp.textContent = 'history'; viewingTagTemp.style.color = '#ffd166'; }
    if(liveIntervalTemp){ clearInterval(liveIntervalTemp); liveIntervalTemp=null; }
    if(trendTimerTemp){ clearInterval(trendTimerTemp); trendTimerTemp=null; }
  }
}

function toTS(date){
  // Return ISO string accepted by ThingSpeak, UTC
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  const hh = String(d.getUTCHours()).padStart(2,'0');
  const mi = String(d.getUTCMinutes()).padStart(2,'0');
  const ss = String(d.getUTCSeconds()).padStart(2,'0');
  // IMPORTANT: return with a literal space, let URLSearchParams encode to %20 once
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// Local timezone formatter for ThingSpeak queries
function toLocalTS(date){
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function fetchFieldForDate({channelId, readKey, field}, dateStr){
  // Load all entries within [start,end) for that day then compute average of field
  const base = `https://api.thingspeak.com/channels/${channelId}/feeds.json`;
  const day = new Date(dateStr);
  // Build a local midnight window and ask ThingSpeak to interpret using local tz
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0,0,0);
  const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate()+1, 0,0,0);
  const params = new URLSearchParams({
    start: toLocalTS(start),
    end: toLocalTS(end),
    timezone: tz
  });
  if(readKey) params.set('api_key', readKey);
  const url = `${base}?${params.toString()}`;
  const r = await fetch(url, { cache:'no-store' });
  if(!r.ok) throw new Error('ThingSpeak history fetch failed');
  const j = await r.json();
  let sum=0, count=0;
  if(j && Array.isArray(j.feeds)){
    for(const f of j.feeds){
      const v = toNumberOrNull(f[`field${field}`]);
      if(v!==null){ sum+=v; count++; }
    }
  }
  if(count===0) return null;
  return sum / count;
}

async function loadDayPM(dateStr){
  if(!dateStr) return;
  setViewingModePM(false); // history mode
  try{
    // PM2.5 averages
    if(THINGSPEAK.klong_pm25.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.klong_pm25, dateStr);
      if(v!==null) dataState.klong.pm25 = v;
    }
    if(THINGSPEAK.thon_pm25.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.thon_pm25, dateStr);
      if(v!==null) dataState.thon.pm25 = v;
    }
    if(THINGSPEAK.bang_pm25.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.bang_pm25, dateStr);
      if(v!==null) dataState.bang.pm25 = v;
    }
  }catch(e){
    console.warn('loadDayPM error', e);
  }finally{
    render();
    // Load trend for that date window
    const { start, end } = rangeForDate(dateStr);
    await loadPMTrend(start, end);
  }
}

async function loadDayTemp(dateStr){
  if(!dateStr) return;
  setViewingModeTemp(false);
  try{
    if(THINGSPEAK.klong_temp.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.klong_temp, dateStr);
      if(v!==null) dataState.klong.temp = v;
    }
    if(THINGSPEAK.thon_temp.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.thon_temp, dateStr);
      if(v!==null) dataState.thon.temp = v;
    }
    if(THINGSPEAK.bang_temp.channelId){
      const v = await fetchFieldForDate(THINGSPEAK.bang_temp, dateStr);
      if(v!==null) dataState.bang.temp = v;
    }
  }catch(e){
    console.warn('loadDayTemp error', e);
  }finally{
    render();
    const { start, end } = rangeForDate(dateStr);
    await loadTempTrend(start, end);
  }
}

// ====== AQI Calculator (US EPA PM2.5) ======
function aqiFromPM25(pm){
  // Breakpoints: [PM_low, PM_high, AQI_low, AQI_high]
  const bp = [
    [0.0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];
  for(const [Pl, Ph, Al, Ah] of bp){
    if(pm <= Ph){
      return Math.round(((Ah-Al)/(Ph-Pl))*(pm-Pl)+Al);
    }
  }
  return 500;
}
function statusWord(aqi){
  return aqi<=50 ? 'Good' : aqi<=100 ? 'Moderate' : aqi<=150 ? 'Unhealthy(SG)' :
         aqi<=200 ? 'Unhealthy' : aqi<=300 ? 'Very Unhealthy' : 'Hazardous';
}

// ===== Render to UI =====
function render(){
  // PM2.5 text
  document.getElementById('pmKlong').textContent = (Number.isFinite(dataState.klong.pm25)?dataState.klong.pm25:0).toFixed(1);
  document.getElementById('pmThon').textContent  = (Number.isFinite(dataState.thon.pm25)?dataState.thon.pm25:0).toFixed(1);
  document.getElementById('pmBang').textContent  = (Number.isFinite(dataState.bang.pm25)?dataState.bang.pm25:0).toFixed(1);

  // AQI
  dataState.klong.aqi = aqiFromPM25(dataState.klong.pm25 ?? 0);
  dataState.thon.aqi  = aqiFromPM25(dataState.thon.pm25 ?? 0);
  dataState.bang.aqi  = aqiFromPM25(dataState.bang.pm25 ?? 0);

  setGauge('fillKlong', Math.min(100, dataState.klong.aqi/2));
  setGauge('fillThon',  Math.min(100, dataState.thon.aqi/2));
  setGauge('fillBang',  Math.min(100, dataState.bang.aqi/2));

  // AQI numbers on gauges
  const aqiK = document.getElementById('aqiKlong');
  const aqiT = document.getElementById('aqiThon');
  const aqiB = document.getElementById('aqiBang');
  if(aqiK) aqiK.textContent = String(dataState.klong.aqi).padStart(3,'0');
  if(aqiT) aqiT.textContent = String(dataState.thon.aqi).padStart(3,'0');
  if(aqiB) aqiB.textContent = String(dataState.bang.aqi).padStart(3,'0');

  // Temperatures
  document.getElementById('tKlong').textContent = `${(Number.isFinite(dataState.klong.temp)?dataState.klong.temp:0).toFixed(1)}°C`;
  document.getElementById('tThon').textContent  = `${(Number.isFinite(dataState.thon.temp)?dataState.thon.temp:0).toFixed(1)}°C`;
  document.getElementById('tBang').textContent  = `${(Number.isFinite(dataState.bang.temp)?dataState.bang.temp:0).toFixed(1)}°C`;

  // Status word
  document.getElementById('statusKlong').textContent = statusWord(dataState.klong.aqi);
  document.getElementById('statusThon').textContent  = statusWord(dataState.thon.aqi);
  document.getElementById('statusBang').textContent  = statusWord(dataState.bang.aqi);
}
render();


// ===== ThingSpeak fetchers (robust) =====
function toNumberOrNull(v){
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchLastField({channelId, readKey, field}){
  // Try feeds.json first (most consistent structure)
  const base = `https://api.thingspeak.com/channels/${channelId}`;
  const params = new URLSearchParams({ results: '1' });
  if(readKey) params.set('api_key', readKey);

  // 1) feeds.json
  try{
    const url1 = `${base}/feeds.json?${params.toString()}`;
    const r1 = await fetch(url1, { cache: 'no-store' });
    if(r1.ok){
      const j = await r1.json();
      if(j && j.feeds && j.feeds.length){
        const val = j.feeds[0][`field${field}`];
        const n = toNumberOrNull(val);
        if(n !== null) return n;
      }
    }
  }catch(e){ /* fall through */ }

  // 2) fields/{n}/last.json (some deployments return {"field":"..."} or plain text)
  try{
    const u2 = new URL(`${base}/fields/${field}/last.json`);
    if(readKey) u2.searchParams.set('api_key', readKey);
    const r2 = await fetch(u2.toString(), { cache: 'no-store' });
    if(r2.ok){
      const t = await r2.text();
      try{
        const j2 = JSON.parse(t);
        const n = toNumberOrNull(j2.field ?? j2[`field${field}`] ?? j2.value ?? j2);
        if(n !== null) return n;
      }catch(_){
        const n = toNumberOrNull(t);
        if(n !== null) return n;
      }
    }
  }catch(e){ /* fall through */ }

  // 3) last.txt (plain text)
  try{
    const u3 = new URL(`${base}/fields/${field}/last.txt`);
    if(readKey) u3.searchParams.set('api_key', readKey);
    const r3 = await fetch(u3.toString(), { cache: 'no-store' });
    if(r3.ok){
      const t3 = await r3.text();
      const n = toNumberOrNull(t3);
      if(n !== null) return n;
    }
  }catch(e){ /* fall through */ }

  throw new Error('Unable to parse ThingSpeak value for field ' + field);
}


async function pollThingSpeak(){
  try{
    // PM2.5 - เฉพาะที่มี channelId เท่านั้น
    if(THINGSPEAK.klong_pm25.channelId && THINGSPEAK.klong_pm25.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.klong_pm25);
      dataState.klong.pm25 = value;
    }
    
    if(THINGSPEAK.thon_pm25.channelId && THINGSPEAK.thon_pm25.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.thon_pm25);
      dataState.thon.pm25 = value;
    }
    
    if(THINGSPEAK.bang_pm25.channelId && THINGSPEAK.bang_pm25.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.bang_pm25);
      dataState.bang.pm25 = value;
    }

    // Temperature - เฉพาะที่มี channelId เท่านั้น
    if(THINGSPEAK.klong_temp.channelId && THINGSPEAK.klong_temp.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.klong_temp);
      dataState.klong.temp = value;
    }
    
    if(THINGSPEAK.thon_temp.channelId && THINGSPEAK.thon_temp.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.thon_temp);
      dataState.thon.temp = value;
    }
    
    if(THINGSPEAK.bang_temp.channelId && THINGSPEAK.bang_temp.channelId !== "YOUR_CHANNEL_ID"){
      const value = await fetchLastField(THINGSPEAK.bang_temp);
      dataState.bang.temp = value;
    }
    
  }catch(err){
    console.warn('ThingSpeak fetch error:', err);
  }finally{
    render();
  }
}

// Split pollers for separate control
async function pollThingSpeakPM(){
  try{
    if(THINGSPEAK.klong_pm25.channelId && THINGSPEAK.klong_pm25.channelId !== "YOUR_CHANNEL_ID"){
      dataState.klong.pm25 = await fetchLastField(THINGSPEAK.klong_pm25);
    }
    if(THINGSPEAK.thon_pm25.channelId && THINGSPEAK.thon_pm25.channelId !== "YOUR_CHANNEL_ID"){
      dataState.thon.pm25 = await fetchLastField(THINGSPEAK.thon_pm25);
    }
    if(THINGSPEAK.bang_pm25.channelId && THINGSPEAK.bang_pm25.channelId !== "YOUR_CHANNEL_ID"){
      dataState.bang.pm25 = await fetchLastField(THINGSPEAK.bang_pm25);
    }
  }catch(err){
    console.warn('ThingSpeak PM fetch error:', err);
  }finally{
    render();
  }
}

async function pollThingSpeakTemp(){
  try{
    if(THINGSPEAK.klong_temp.channelId && THINGSPEAK.klong_temp.channelId !== "YOUR_CHANNEL_ID"){
      dataState.klong.temp = await fetchLastField(THINGSPEAK.klong_temp);
    }
    if(THINGSPEAK.thon_temp.channelId && THINGSPEAK.thon_temp.channelId !== "YOUR_CHANNEL_ID"){
      dataState.thon.temp = await fetchLastField(THINGSPEAK.thon_temp);
    }
    if(THINGSPEAK.bang_temp.channelId && THINGSPEAK.bang_temp.channelId !== "YOUR_CHANNEL_ID"){
      dataState.bang.temp = await fetchLastField(THINGSPEAK.bang_temp);
    }
  }catch(err){
    console.warn('ThingSpeak Temp fetch error:', err);
  }finally{
    render();
  }
}

// เริ่ม Pooling อัตโนมัติ
pollThingSpeak();
// separate timers for PM and Temp live polling
liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000);
liveIntervalTemp = setInterval(pollThingSpeakTemp, THINGSPEAK.intervalMs || 15000);

// initialize charts after DOM ready
document.addEventListener('DOMContentLoaded', ()=>{
  ensurePMChart();
  ensureTempChart();
  const { start, end } = rangeLast24h();
  loadPMTrend(start, end);
  loadTempTrend(start, end);
  scheduleTrendTimers();
});

// ===== Insights & Advisory (center card) =====
function computeAQIAdvice(aqi){
  if(aqi<=50) return { label:'Good', className:'good', text:'อากาศดี ปลอดภัยต่อกิจกรรมกลางแจ้ง' };
  if(aqi<=100) return { label:'Moderate', className:'moderate', text:'ผู้ที่แพ้ง่ายควรระวัง หากระคายเคืองให้สวมหน้ากาก' };
  if(aqi<=150) return { label:'USG', className:'usg', text:'กลุ่มเสี่ยงควรลดเวลานอกอาคารและสวมหน้ากากเมื่อต้องออกนอกบ้าน' };
  if(aqi<=200) return { label:'Unhealthy', className:'unhealthy', text:'หลีกเลี่ยงกิจกรรมนอกอาคาร และสวมหน้ากากคุณภาพสูง' };
  if(aqi<=300) return { label:'Very Unhealthy', className:'vu', text:'หลีกเลี่ยงกิจกรรมนอกอาคารให้มากที่สุด' };
  return { label:'Hazardous', className:'haz', text:'อันตรายสูง ควรอยู่ภายในอาคารและใช้เครื่องกรองอากาศ' };
}

function updateInsightsCard(){
  const overallEl = document.getElementById('overallAQI');
  const bestEl = document.getElementById('bestDistrict');
  const worstEl = document.getElementById('worstDistrict');
  const badgeEl = document.getElementById('aqiLevelBadge');
  const adviceEl = document.getElementById('adviceText');
  const updatedEl = document.getElementById('insightsUpdated');
  if(!overallEl || !badgeEl) return; // insights not on page

  const aqi = {
    Klong: aqiFromPM25(dataState.klong.pm25 ?? 0),
    Thon:  aqiFromPM25(dataState.thon.pm25 ?? 0),
    Bang:  aqiFromPM25(dataState.bang.pm25 ?? 0)
  };
  const entries = Object.entries(aqi);
  const overall = Math.max(...entries.map(([,v])=>v));
  const best = entries.reduce((min,cur)=> cur[1] < min[1] ? cur : min);
  const worst = entries.reduce((max,cur)=> cur[1] > max[1] ? cur : max);

  overallEl.textContent = String(overall).padStart(3,'0');
  if(bestEl) bestEl.textContent = `${best[0]} • ${String(best[1]).padStart(3,'0')}`;
  if(worstEl) worstEl.textContent = `${worst[0]} • ${String(worst[1]).padStart(3,'0')}`;
  const adv = computeAQIAdvice(overall);
  badgeEl.className = `badge ${adv.className}`;
  badgeEl.textContent = adv.label;
  if(adviceEl) adviceEl.textContent = adv.text;
  if(updatedEl) updatedEl.textContent = new Date().toLocaleString('th-TH', { hour:'2-digit', minute:'2-digit' });
}

// Hook into existing render to refresh insights when data changes
const oldRender = render;
render = function(){
  oldRender();
  updateInsightsCard();
};

// Initial populate
updateInsightsCard();

// Back button (placeholder)
// back button removed per requirement

// Manual update API for testing
window.updateAQ = (key, obj)=>{
  Object.assign(dataState[key], obj);
  render();
};

// ===== Interactive Background System =====
class InteractiveBackground {
  constructor() {
    this.canvas = document.getElementById('mouseTrail');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouse = { x: 0, y: 0 };
    this.bgLayers = [
      document.getElementById('bgLayer1'),
      document.getElementById('bgLayer2'),
      document.getElementById('bgLayer3')
    ];
    
    this.setupCanvas();
    this.setupEventListeners();
    this.animate();
  }
  
  setupCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });
  }
  
  setupEventListeners() {
    // Mouse movement for parallax effect
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      
      // Parallax effect on background layers
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const moveX = (e.clientX - centerX) * 0.01;
      const moveY = (e.clientY - centerY) * 0.01;
      
      this.bgLayers.forEach((layer, index) => {
        const depth = (index + 1) * 0.5;
        if (layer) {
          layer.style.transform = `translate(${moveX * depth}px, ${moveY * depth}px)`;
        }
      });
      
      // Add mouse trail streaks
      this.addTrailParticle(e.clientX, e.clientY);
    });
    
    // Click ripple effect
    document.addEventListener('click', (e) => {
      this.createClickRipple(e.clientX, e.clientY);
    });
    
    // Touch events for mobile
    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.addTrailParticle(touch.clientX, touch.clientY);
    }, { passive: false });
    
    document.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      this.createClickRipple(touch.clientX, touch.clientY);
    });
    
    // Scroll effects
    let ticking = false;
    document.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const scrollProgress = scrollY / (document.body.scrollHeight - window.innerHeight);
          
          // Move background layers based on scroll
          this.bgLayers.forEach((layer, index) => {
            if (layer) {
              const speed = (index + 1) * 0.3;
              layer.style.transform += ` translateY(${scrollY * speed}px)`;
            }
          });
          
          // Add scroll particles
          if (Math.random() < 0.3) {
            this.addTrailParticle(
              Math.random() * window.innerWidth,
              Math.random() * window.innerHeight
            );
          }
          
          ticking = false;
        });
        ticking = true;
      }
    });
  }
  
  addTrailParticle(x, y) {
    // Limit particles for performance
    if (this.particles.length > 120) {
      this.particles.splice(0, this.particles.length - 120);
    }

    // Compute direction based on last mouse position for streak effect
    if (!this.lastPoint) this.lastPoint = { x, y };
    const dx = x - this.lastPoint.x;
    const dy = y - this.lastPoint.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const len = Math.min(80, Math.max(12, dist * 1.2));

    // Push a neon line segment (streak)
    const baseWidth = 1.2 + Math.min(3, dist * 0.05);
    const color = this.getRandomColor();
    this.particles.push({
      x,
      y,
      px: x - nx * len,
      py: y - ny * len,
      life: 1,
      decay: 0.035,
      width: baseWidth,
      color
    });

    // Occasionally add a secondary offset streak for a "cyber" look
    if (dist > 6 && Math.random() < 0.4) {
      const off = 6 * (Math.random() > 0.5 ? 1 : -1);
      this.particles.push({
        x: x + -ny * off,
        y: y + nx * off,
        px: x - nx * len + -ny * off,
        py: y - ny * len + nx * off,
        life: 0.9,
        decay: 0.04,
        width: baseWidth * 0.8,
        color
      });
    }

    this.lastPoint = { x, y };
  }
  
  getRandomColor() {
    // Stronger neon palette (opaque; we'll control alpha separately)
    const colors = [
      'rgba(79, 168, 232, 1)',   // neon blue
      'rgba(29, 209, 150, 1)',   // neon green
      'rgba(244, 199, 66, 1)'    // amber
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
  
  createClickRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.width = '20px';
    ripple.style.height = '20px';
    ripple.style.marginLeft = '-10px';
    ripple.style.marginTop = '-10px';
    
    document.body.appendChild(ripple);
    
    setTimeout(() => {
      document.body.removeChild(ripple);
    }, 1000);
  }
  
  animate() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Additive blending for neon streaks
    ctx.globalCompositeOperation = 'lighter';

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Fade/decay
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Slight trailing shift for a dynamic look
      const lerp = 0.06;
      p.px += (p.x - p.px) * lerp;
      p.py += (p.y - p.py) * lerp;

      // Draw neon streak (line from px,py to x,y)
      ctx.save();
      ctx.lineWidth = p.width * (0.5 + 0.5 * p.life);
      ctx.lineCap = 'round';
      ctx.shadowBlur = 20;
      ctx.shadowColor = p.color;
      ctx.globalAlpha = Math.max(0, p.life);

      // Gradient along the line
      const grad = ctx.createLinearGradient(p.px, p.py, p.x, p.y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, p.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;

      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }

    // Reset composite mode
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(() => this.animate());
  }
}

// Initialize (background effects without mouse-follow)
document.addEventListener('DOMContentLoaded', () => {
  // Disable continuous mouse-follow/parallax by not instantiating InteractiveBackground
  // Keep only click ripple on demand
  document.addEventListener('click', (e)=>{
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.style.width = '20px';
    ripple.style.height = '20px';
    ripple.style.marginLeft = '-10px';
    ripple.style.marginTop = '-10px';
    document.body.appendChild(ripple);
    setTimeout(()=> document.body.removeChild(ripple), 1000);
  });
  // Default date values to today
  const todayStr = new Date().toISOString().slice(0,10);
  if(dateInputPM) dateInputPM.value = todayStr;
  if(dateInputTemp) dateInputTemp.value = todayStr;

  // PM controls
  // Auto-load when PM date changes
  if(dateInputPM){
    dateInputPM.addEventListener('change', ()=>{
      const val = dateInputPM.value;
      if(val){
        if(liveIntervalPM){ clearInterval(liveIntervalPM); liveIntervalPM=null; }
        loadDayPM(val);
      }
    });
  }
  if(btnTodayPM){
    btnTodayPM.addEventListener('click', ()=>{
      setViewingModePM(true);
      if(!liveIntervalPM){ liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000); }
    });
  }

  // Temp controls
  // Auto-load when Temp date changes
  if(dateInputTemp){
    dateInputTemp.addEventListener('change', ()=>{
      const val = dateInputTemp.value;
      if(val){
        if(liveIntervalTemp){ clearInterval(liveIntervalTemp); liveIntervalTemp=null; }
        loadDayTemp(val);
      }
    });
  }
  if(btnTodayTemp){
    btnTodayTemp.addEventListener('click', ()=>{
      setViewingModeTemp(true);
      if(!liveIntervalTemp){ liveIntervalTemp = setInterval(pollThingSpeakTemp, THINGSPEAK.intervalMs || 15000); }
    });
  }
});
