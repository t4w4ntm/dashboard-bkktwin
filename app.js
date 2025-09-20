// ===== helper: live clock =====
var clockEl = document.getElementById('clock');
function pad(n){ return (n<10?'0':'')+n; }
function tickClock(){
  var d = new Date();
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var s = days[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  clockEl.textContent = s;
}
setInterval(tickClock, 1000); tickClock();

// ambient temp (optional separate sensor) — element may not exist
var ambientTempEl = document.getElementById('ambientTemp');
if (ambientTempEl) ambientTempEl.textContent = '00.0°C';

// ===== Simple gauge driver (stroke dashoffset from value 0..100) =====
function setGauge(fillId, value){
  var maxLen = 126; // length of the arc path
  var clamped = Math.max(0, Math.min(100, value));
  var offset = maxLen - (clamped/100)*maxLen;
  var el = document.getElementById(fillId);
  if (el) el.style.strokeDashoffset = offset;
}

// ======== DATA STATE ========
// default demo values (will be replaced by ThingSpeak if configured)
var dataState = {
  klong: { pm25: 12, aqi: 40, temp: 29.4 },
  thon:  { pm25: 18, aqi: 55, temp: 30.2 },
  bang:  { pm25: 25, aqi: 70, temp: 31.1 }
};

// ======== THINGSPEAK CONFIG ========
// ใส่ค่าให้ตรงช่องของคุณ (channelId, readKey, field)
// คุณสามารถใช้ Channel เดียวหลายฟิลด์หรือคนละ Channel ก็ได้
var THINGSPEAK = {
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
var TREND = {
  liveRefreshMs: 5 * 60 * 1000 // refresh charts every 5 minutes in live mode
};
var trendTimerPM = null;
var trendTimerTemp = null;

// ======== Chart holders ========
var pmChart = null;
var tempChart = null;
var combinedChart = null;

function colorVar(name, fallback){
  var s = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return s || fallback;
}

function buildLineChart(ctx, title, datasets, timeRange = null){
  var chartOptions = {
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
  };
  
  // Set time range if provided
  if (timeRange && timeRange.start && timeRange.end) {
    chartOptions.scales.x.min = timeRange.start;
    chartOptions.scales.x.max = timeRange.end;
  }
  
  return new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: chartOptions
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
  var end = new Date();
  var start = new Date(end.getTime() - 24*60*60*1000);
  return { start: start, end: end };
}

function rangeForDate(dateStr){
  var d = new Date(dateStr + 'T00:00:00');
  var start = new Date(d);
  var end = new Date(d.getTime() + 24*60*60*1000);
  return { start: start, end: end };
}

function fetchSeries(config, start, end){
  var channelId = config.channelId;
  var readKey = config.readKey;
  var field = config.field;
  var base = 'https://api.thingspeak.com/channels/' + channelId + '/feeds.json';
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  var params = new URLSearchParams({
    start: toLocalTS(start),
    end: toLocalTS(end),
    timezone: tz
  });
  if(readKey) params.set('api_key', readKey);
  var url = base + '?' + params.toString();
  return fetch(url, { cache: 'no-store' }).then(function(r) {
    if(!r.ok) throw new Error('ThingSpeak series fetch failed');
    return r.json();
  }).then(function(j) {
    var out = [];
    if(j && Array.isArray(j.feeds)){
      for(var i = 0; i < j.feeds.length; i++){
        var f = j.feeds[i];
        var t = f.created_at;
        var v = toNumberOrNull(f['field' + field]);
        if(v !== null && t) out.push({ x: new Date(t), y: v });
      }
    }
    return out.sort(function(a, b){ return a.x - b.x; });
  });
}

function loadPMTrend(start, end){
  Promise.all([
    fetchSeries(THINGSPEAK.klong_pm25, start, end),
    fetchSeries(THINGSPEAK.thon_pm25, start, end),
    fetchSeries(THINGSPEAK.bang_pm25, start, end)
  ]).then(function(results) {
    var kl = results[0];
    var th = results[1];
    var ba = results[2];
    var timeRange = { start: start, end: end };
    ensurePMChart(timeRange);
    pmChart.data.datasets[0].data = kl;
    pmChart.data.datasets[1].data = th;
    pmChart.data.datasets[2].data = ba;
    pmChart.update();
  }).catch(function(e){ 
    console.warn('loadPMTrend error', e); 
  });
}

function loadTempTrend(start, end){
  Promise.all([
    fetchSeries(THINGSPEAK.klong_temp, start, end),
    fetchSeries(THINGSPEAK.thon_temp, start, end),
    fetchSeries(THINGSPEAK.bang_temp, start, end)
  ]).then(function(results) {
    var kl = results[0];
    var th = results[1];
    var ba = results[2];
    var timeRange = { start: start, end: end };
    ensureTempChart(timeRange);
    tempChart.data.datasets[0].data = kl;
    tempChart.data.datasets[1].data = th;
    tempChart.data.datasets[2].data = ba;
    tempChart.update();
  }).catch(function(e){ 
    console.warn('loadTempTrend error', e); 
  });
}

function loadCombinedTrend(){
  // Combined trend จะใช้ข้อมูล realtime เสมอ (24 ชั่วโมงล่าสุด)
  var range = rangeLast24h();
  var start = range.start;
  var end = range.end;
  
  Promise.all([
    // PM2.5 data
    fetchSeries(THINGSPEAK.klong_pm25, start, end),
    fetchSeries(THINGSPEAK.thon_pm25, start, end),
    fetchSeries(THINGSPEAK.bang_pm25, start, end),
    // Temperature data
    fetchSeries(THINGSPEAK.klong_temp, start, end),
    fetchSeries(THINGSPEAK.thon_temp, start, end),
    fetchSeries(THINGSPEAK.bang_temp, start, end)
  ]).then(function(results) {
    ensureCombinedChart();
    
    // PM2.5 data (datasets 0, 1, 2)
    combinedChart.data.datasets[0].data = results[0]; // Klong PM2.5
    combinedChart.data.datasets[1].data = results[1]; // Thon PM2.5
    combinedChart.data.datasets[2].data = results[2]; // Bang PM2.5
    
    // Temperature data (datasets 3, 4, 5)
    combinedChart.data.datasets[3].data = results[3]; // Klong Temp
    combinedChart.data.datasets[4].data = results[4]; // Thon Temp
    combinedChart.data.datasets[5].data = results[5]; // Bang Temp
    
    combinedChart.update();
  }).catch(function(e){ 
    console.warn('loadCombinedTrend error', e); 
  });
}

function ensurePMChart(timeRange = null){
  if(pmChart) {
    pmChart.destroy();
    pmChart = null;
  }
  var el = document.getElementById('pmTrend');
  if(!el) return;
  var c1 = '#4fa8e8';
  var c2 = '#1dd196';  
  var c3 = '#f4c742';
  pmChart = buildLineChart(el.getContext('2d'), 'PM2.5 24H', [
    ds('Klong San', c1),
    ds('Thon Buri', c2),
    ds('Bang Rak', c3)
  ], timeRange);
}function ensureTempChart(timeRange = null){
  if(tempChart) {
    tempChart.destroy();
    tempChart = null;
  }
  var el = document.getElementById('tempTrend');
  if(!el) return;
  var c1 = '#4fa8e8';
  var c2 = '#1dd196';
  var c3 = '#f4c742';
  tempChart = buildLineChart(el.getContext('2d'), 'Temperature 24H', [
    ds('Klong San', c1),
    ds('Thon Buri', c2),
    ds('Bang Rak', c3)
  ], timeRange);
}

function ensureCombinedChart(){
  if(combinedChart) return;
  var el = document.getElementById('combinedTrend');
  if(!el) return;
  
  combinedChart = new Chart(el, {
    type: 'line',
    data: {
      datasets: [
        // PM2.5 datasets (left axis)
        { label: 'Klong San PM2.5', data: [], parsing: false, borderColor: '#4fa8e8', backgroundColor: '#4fa8e8', fill: false, yAxisID: 'y' },
        { label: 'Thon Buri PM2.5', data: [], parsing: false, borderColor: '#1dd196', backgroundColor: '#1dd196', fill: false, yAxisID: 'y' },
        { label: 'Bang Rak PM2.5', data: [], parsing: false, borderColor: '#f4c742', backgroundColor: '#f4c742', fill: false, yAxisID: 'y' },
        // Temperature datasets (right axis)
        { label: 'Klong San Temp', data: [], parsing: false, borderColor: '#4fa8e8', backgroundColor: '#4fa8e8', fill: false, yAxisID: 'y1', borderDash: [5, 5] },
        { label: 'Thon Buri Temp', data: [], parsing: false, borderColor: '#1dd196', backgroundColor: '#1dd196', fill: false, yAxisID: 'y1', borderDash: [5, 5] },
        { label: 'Bang Rak Temp', data: [], parsing: false, borderColor: '#f4c742', backgroundColor: '#f4c742', fill: false, yAxisID: 'y1', borderDash: [5, 5] }
      ]
    },
options: {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  layout: { padding: { left: 0, right: 0, top: 0, bottom: 0 } }, // ลด padding รอบ ๆ
  plugins: {
    legend: {
      labels: {
        color: colorVar('--fg','#e8f1ff'),
        filter: (item)=> item.datasetIndex < 3
      }
    },
    title: { display: false }
  },
  scales: {
    x: {
      type: 'time',
      time: { unit: 'hour', displayFormats: { hour: 'ha' } },
      ticks: { color: colorVar('--muted','#95b0d1'), maxTicksLimit: 6 },
      grid: { color: 'rgba(255,255,255,.08)' }
    },
    y: {
      title: { display: false },             // << ปิดชื่อแกนซ้าย
      ticks: { color: colorVar('--muted','#95b0d1'), maxTicksLimit: 5 },
      grid: { color: 'rgba(255,255,255,.06)' }
    },
    y1: {
      type: 'linear',
      display: true,
      position: 'right',
      title: { display: false },             // << ปิดชื่อแกนขวา
      ticks: { color: colorVar('--muted','#95b0d1'), maxTicksLimit: 5 },
      grid: { drawOnChartArea: false }
    }
  },
  elements: { line: { tension: 0.25, borderWidth: 2 }, point: { radius: 0 } }
}

  });
}

function scheduleTrendTimers(){
  if(trendTimerPM){ clearInterval(trendTimerPM); trendTimerPM=null; }
  if(trendTimerTemp){ clearInterval(trendTimerTemp); trendTimerTemp=null; }
  if(!isViewingPM){
    // live mode for PM chart
    trendTimerPM = setInterval(function(){
      var range = rangeLast24h();
      var start = range.start;
      var end = range.end;
      loadPMTrend(start, end);
    }, TREND.liveRefreshMs);
  }
  if(!isViewingTemp){
    // live mode for Temperature chart
    trendTimerTemp = setInterval(function(){
      var range = rangeLast24h();
      var start = range.start;
      var end = range.end;
      loadTempTrend(start, end);
    }, TREND.liveRefreshMs);
  }
}

// ===== Time Range Functions =====
function populateTimeOptions(selectElement, selectedDate) {
  if (!selectElement) return;
  
  selectElement.innerHTML = '';
  
  // Generate 24 hour options (00:00 to 23:00)
  for (let hour = 0; hour < 24; hour++) {
    const option = document.createElement('option');
    const timeStr = String(hour).padStart(2, '0') + ':00';
    option.value = hour;
    option.textContent = timeStr;
    selectElement.appendChild(option);
  }
}

function getTimeRangeFromSelects(startSelect, endSelect, dateStr) {
  if (!startSelect || !endSelect || !dateStr) return null;
  
  const startHour = parseInt(startSelect.value || '0');
  const endHour = parseInt(endSelect.value || '23');
  
  const baseDate = new Date(dateStr + 'T00:00:00');
  const startTime = new Date(baseDate);
  const endTime = new Date(baseDate);
  
  startTime.setHours(startHour, 0, 0, 0);
  endTime.setHours(endHour, 59, 59, 999);
  
  // If end time is before start time, assume next day
  if (endTime <= startTime) {
    endTime.setDate(endTime.getDate() + 1);
  }
  
  return { start: startTime, end: endTime };
}

function getDisplayTimeRange(startSelect, endSelect, dateStr) {
  if (!startSelect || !endSelect || !dateStr) return null;
  
  const startHour = parseInt(startSelect.value || '0');
  const endHour = parseInt(endSelect.value || '23');
  
  const baseDate = new Date(dateStr + 'T00:00:00');
  const startTime = new Date(baseDate);
  const endTime = new Date(baseDate);
  
  startTime.setHours(startHour, 0, 0, 0);
  endTime.setHours(endHour, 0, 0, 0);
  
  // If end time is before start time, assume next day
  if (endTime <= startTime) {
    endTime.setDate(endTime.getDate() + 1);
  }
  
  return { start: startTime, end: endTime };
}

function initializeTimeRangeControls() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentHour = now.getHours();
  const nextHour = (currentHour + 1) % 24;
  
  // Initialize PM time controls
  if (pmStartTimeSelect && pmEndTimeSelect) {
    populateTimeOptions(pmStartTimeSelect, today);
    populateTimeOptions(pmEndTimeSelect, today);
    
    // Set default values: current hour and next hour
    pmStartTimeSelect.value = currentHour.toString();
    pmEndTimeSelect.value = nextHour.toString();
    
    // Add automatic update listeners
    pmStartTimeSelect.addEventListener('change', function() {
      updateEndTimeOptions(pmStartTimeSelect, pmEndTimeSelect);
      updatePMTrendWithTimeRange();
    });
    pmEndTimeSelect.addEventListener('change', updatePMTrendWithTimeRange);
  }
  
  // Initialize Temperature time controls
  if (tempStartTimeSelect && tempEndTimeSelect) {
    populateTimeOptions(tempStartTimeSelect, today);
    populateTimeOptions(tempEndTimeSelect, today);
    
    // Set default values: current hour and next hour
    tempStartTimeSelect.value = currentHour.toString();
    tempEndTimeSelect.value = nextHour.toString();
    
    // Add automatic update listeners
    tempStartTimeSelect.addEventListener('change', function() {
      updateEndTimeOptions(tempStartTimeSelect, tempEndTimeSelect);
      updateTempTrendWithTimeRange();
    });
    tempEndTimeSelect.addEventListener('change', updateTempTrendWithTimeRange);
  }
}

function updatePMTrendWithTimeRange() {
  const dateStr = dateInputPM ? dateInputPM.value : new Date().toISOString().slice(0, 10);
  const dataTimeRange = getTimeRangeFromSelects(pmStartTimeSelect, pmEndTimeSelect, dateStr);
  const displayTimeRange = getDisplayTimeRange(pmStartTimeSelect, pmEndTimeSelect, dateStr);
  
  if (dataTimeRange && displayTimeRange) {
    // Fetch data with full time range, but display with exact hour boundaries
    Promise.all([
      fetchSeries(THINGSPEAK.klong_pm25, dataTimeRange.start, dataTimeRange.end),
      fetchSeries(THINGSPEAK.thon_pm25, dataTimeRange.start, dataTimeRange.end),
      fetchSeries(THINGSPEAK.bang_pm25, dataTimeRange.start, dataTimeRange.end)
    ]).then(function(results) {
      var kl = results[0];
      var th = results[1];
      var ba = results[2];
      ensurePMChart(displayTimeRange);
      pmChart.data.datasets[0].data = kl;
      pmChart.data.datasets[1].data = th;
      pmChart.data.datasets[2].data = ba;
      pmChart.update();
    }).catch(function(e){ 
      console.warn('updatePMTrendWithTimeRange error', e); 
    });
  }
}

function updateTempTrendWithTimeRange() {
  const dateStr = dateInputTemp ? dateInputTemp.value : new Date().toISOString().slice(0, 10);
  const dataTimeRange = getTimeRangeFromSelects(tempStartTimeSelect, tempEndTimeSelect, dateStr);
  const displayTimeRange = getDisplayTimeRange(tempStartTimeSelect, tempEndTimeSelect, dateStr);
  
  if (dataTimeRange && displayTimeRange) {
    // Fetch data with full time range, but display with exact hour boundaries
    Promise.all([
      fetchSeries(THINGSPEAK.klong_temp, dataTimeRange.start, dataTimeRange.end),
      fetchSeries(THINGSPEAK.thon_temp, dataTimeRange.start, dataTimeRange.end),
      fetchSeries(THINGSPEAK.bang_temp, dataTimeRange.start, dataTimeRange.end)
    ]).then(function(results) {
      var kl = results[0];
      var th = results[1];
      var ba = results[2];
      ensureTempChart(displayTimeRange);
      tempChart.data.datasets[0].data = kl;
      tempChart.data.datasets[1].data = th;
      tempChart.data.datasets[2].data = ba;
      tempChart.update();
    }).catch(function(e){ 
      console.warn('updateTempTrendWithTimeRange error', e); 
    });
  }
}

// Update time options when date changes
function updateTimeOptionsForDate(startSelect, endSelect, dateStr) {
  if (startSelect && endSelect && dateStr) {
    const currentStart = startSelect.value;
    const currentEnd = endSelect.value;
    
    populateTimeOptions(startSelect, dateStr);
    populateTimeOptions(endSelect, dateStr);
    
    // Restore previous selections if they were valid
    if (currentStart !== null && currentStart !== '') {
      startSelect.value = currentStart;
    }
    if (currentEnd !== null && currentEnd !== '') {
      endSelect.value = currentEnd;
    }
    
    // Ensure End Time is greater than Start Time
    updateEndTimeOptions(startSelect, endSelect);
    
    // Auto-trigger update after date change
    if (startSelect === pmStartTimeSelect) {
      setTimeout(updatePMTrendWithTimeRange, 100);
    } else if (startSelect === tempStartTimeSelect) {
      setTimeout(updateTempTrendWithTimeRange, 100);
    }
  }
}

// Function to update End Time options based on Start Time selection
function updateEndTimeOptions(startSelect, endSelect) {
  if (!startSelect || !endSelect) return;
  
  const startTime = startSelect.value;
  if (!startTime) return;
  
  const startHour = parseInt(startTime.split(':')[0]);
  const currentEndValue = endSelect.value;
  
  // Clear and repopulate end time options
  Array.from(endSelect.options).forEach((option, index) => {
    if (index === 0) return; // Skip the first "Select End Time" option
    
    const optionHour = parseInt(option.value.split(':')[0]);
    option.disabled = optionHour <= startHour;
  });
  
  // If current end time is invalid (not greater than start time), clear it
  if (currentEndValue) {
    const currentEndHour = parseInt(currentEndValue.split(':')[0]);
    if (currentEndHour <= startHour) {
      endSelect.value = '';
    }
  }
}

// ===== Date viewing state (separate PM and Temp) =====
var liveIntervalPM = null;
var liveIntervalTemp = null;
var isViewingPM = false;   // viewing historical date for PM section
var isViewingTemp = false; // viewing historical date for Temp section

// PM controls
var viewingTagPM = document.getElementById('viewingTagPM');
var dateInputPM = document.getElementById('viewDatePM');
// removed Load button for PM
var btnTodayPM = document.getElementById('btnTodayPM');

// Temp controls
var viewingTagTemp = document.getElementById('viewingTagTemp');
var dateInputTemp = document.getElementById('viewDateTemp');
// removed Load button for Temp
var btnTodayTemp = document.getElementById('btnTodayTemp');

// Time range controls for PM
var pmStartTimeSelect = document.getElementById('pmStartTime');
var pmEndTimeSelect = document.getElementById('pmEndTime');

// Time range controls for Temperature
var tempStartTimeSelect = document.getElementById('tempStartTime');
var tempEndTimeSelect = document.getElementById('tempEndTime');

function setViewingModePM(live){
  isViewingPM = !live;
  if(live){
    if(viewingTagPM){ viewingTagPM.textContent = 'live'; viewingTagPM.style.color = '#9ad0ff'; }
    if(liveIntervalPM==null){ liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000); }
    pollThingSpeakPM();
    // Load trend with current time range selection
    setTimeout(updatePMTrendWithTimeRange, 100);
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
    // Load trend with current time range selection
    setTimeout(updateTempTrendWithTimeRange, 100);
    scheduleTrendTimers();
  }else{
    if(viewingTagTemp){ viewingTagTemp.textContent = 'history'; viewingTagTemp.style.color = '#ffd166'; }
    if(liveIntervalTemp){ clearInterval(liveIntervalTemp); liveIntervalTemp=null; }
    if(trendTimerTemp){ clearInterval(trendTimerTemp); trendTimerTemp=null; }
  }
}

function toTS(date){
  // Return ISO string accepted by ThingSpeak, UTC
  var d = new Date(date);
  var yyyy = d.getUTCFullYear();
  var mm = String(d.getUTCMonth()+1).padStart(2,'0');
  var dd = String(d.getUTCDate()).padStart(2,'0');
  var hh = String(d.getUTCHours()).padStart(2,'0');
  var mi = String(d.getUTCMinutes()).padStart(2,'0');
  var ss = String(d.getUTCSeconds()).padStart(2,'0');
  // IMPORTANT: return with a literal space, let URLSearchParams encode to %20 once
  return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi + ':' + ss;
}

// Local timezone formatter for ThingSpeak queries
function toLocalTS(date){
  var d = new Date(date);
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var dd = String(d.getDate()).padStart(2,'0');
  var hh = String(d.getHours()).padStart(2,'0');
  var mi = String(d.getMinutes()).padStart(2,'0');
  var ss = String(d.getSeconds()).padStart(2,'0');
  return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi + ':' + ss;
}

function fetchFieldForDate(config, dateStr){
  var channelId = config.channelId;
  var readKey = config.readKey;
  var field = config.field;
  // Load all entries within [start,end) for that day then compute average of field
  var base = 'https://api.thingspeak.com/channels/' + channelId + '/feeds.json';
  var day = new Date(dateStr);
  // Build a local midnight window and ask ThingSpeak to interpret using local tz
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0,0,0);
  var end   = new Date(day.getFullYear(), day.getMonth(), day.getDate()+1, 0,0,0);
  var params = new URLSearchParams({
    start: toLocalTS(start),
    end: toLocalTS(end),
    timezone: tz
  });
  if(readKey) params.set('api_key', readKey);
  var url = base + '?' + params.toString();
  return fetch(url, { cache:'no-store' }).then(function(r) {
    if(!r.ok) throw new Error('ThingSpeak history fetch failed');
    return r.json();
  }).then(function(j) {
    var sum=0, count=0;
    if(j && Array.isArray(j.feeds)){
      for(var i = 0; i < j.feeds.length; i++){
        var f = j.feeds[i];
        var v = toNumberOrNull(f['field' + field]);
        if(v!==null){ sum+=v; count++; }
      }
    }
    if(count===0) return null;
    return sum / count;
  });
}

function loadDayPM(dateStr){
  if(!dateStr) return;
  setViewingModePM(false); // history mode
  
  var promises = [];
  
  if(THINGSPEAK.klong_pm25.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.klong_pm25, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  if(THINGSPEAK.thon_pm25.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.thon_pm25, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  if(THINGSPEAK.bang_pm25.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.bang_pm25, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  Promise.all(promises).then(function(results) {
    var klongValue = results[0];
    var thonValue = results[1];
    var bangValue = results[2];
    
    if(klongValue !== null) dataState.klong.pm25 = klongValue;
    if(thonValue !== null) dataState.thon.pm25 = thonValue;
    if(bangValue !== null) dataState.bang.pm25 = bangValue;
    
    render();
    // Load trend for that date window
    var range = rangeForDate(dateStr);
    var start = range.start;
    var end = range.end;
    loadPMTrend(start, end);
    // Combined trend ไม่เปลี่ยนตามวันที่ - ใช้ realtime เสมอ
  }).catch(function(e) {
    console.warn('loadDayPM error', e);
    render();
    var range = rangeForDate(dateStr);
    var start = range.start;
    var end = range.end;
    loadPMTrend(start, end);
    // Combined trend ไม่เปลี่ยนตามวันที่ - ใช้ realtime เสมอ
  });
}

function loadDayTemp(dateStr){
  if(!dateStr) return;
  setViewingModeTemp(false);
  
  var promises = [];
  
  if(THINGSPEAK.klong_temp.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.klong_temp, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  if(THINGSPEAK.thon_temp.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.thon_temp, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  if(THINGSPEAK.bang_temp.channelId){
    promises.push(fetchFieldForDate(THINGSPEAK.bang_temp, dateStr));
  } else {
    promises.push(Promise.resolve(null));
  }
  
  Promise.all(promises).then(function(results) {
    var klongValue = results[0];
    var thonValue = results[1];
    var bangValue = results[2];
    
    if(klongValue !== null) dataState.klong.temp = klongValue;
    if(thonValue !== null) dataState.thon.temp = thonValue;
    if(bangValue !== null) dataState.bang.temp = bangValue;
    
    render();
    var range = rangeForDate(dateStr);
    var start = range.start;
    var end = range.end;
    loadTempTrend(start, end);
  }).catch(function(e) {
    console.warn('loadDayTemp error', e);
    render();
    var range = rangeForDate(dateStr);
    var start = range.start;
    var end = range.end;
    loadTempTrend(start, end);
  });
}

// ====== AQI Calculator (US EPA PM2.5) ======
function aqiFromPM25(pm){
  // Breakpoints: [PM_low, PM_high, AQI_low, AQI_high]
  var bp = [
    [0.0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];
  for(var i = 0; i < bp.length; i++){
    var range = bp[i];
    var Pl = range[0];
    var Ph = range[1]; 
    var Al = range[2];
    var Ah = range[3];
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
  dataState.klong.aqi = aqiFromPM25(dataState.klong.pm25 || 0);
  dataState.thon.aqi  = aqiFromPM25(dataState.thon.pm25 || 0);
  dataState.bang.aqi  = aqiFromPM25(dataState.bang.pm25 || 0);

  setGauge('fillKlong', Math.min(100, dataState.klong.aqi/2));
  setGauge('fillThon',  Math.min(100, dataState.thon.aqi/2));
  setGauge('fillBang',  Math.min(100, dataState.bang.aqi/2));

  // AQI numbers on gauges
  var aqiK = document.getElementById('aqiKlong');
  var aqiT = document.getElementById('aqiThon');
  var aqiB = document.getElementById('aqiBang');
  if(aqiK) aqiK.textContent = String(dataState.klong.aqi).padStart(3,'0');
  if(aqiT) aqiT.textContent = String(dataState.thon.aqi).padStart(3,'0');
  if(aqiB) aqiB.textContent = String(dataState.bang.aqi).padStart(3,'0');

  // Temperatures
  document.getElementById('tKlong').textContent = (Number.isFinite(dataState.klong.temp)?dataState.klong.temp:0).toFixed(1) + '°C';
  document.getElementById('tThon').textContent  = (Number.isFinite(dataState.thon.temp)?dataState.thon.temp:0).toFixed(1) + '°C';
  document.getElementById('tBang').textContent  = (Number.isFinite(dataState.bang.temp)?dataState.bang.temp:0).toFixed(1) + '°C';

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

function fetchLastField(config){
  var channelId = config.channelId;
  var readKey = config.readKey;
  var field = config.field;
  // Try feeds.json first (most consistent structure)
  var base = 'https://api.thingspeak.com/channels/' + channelId;
  var params = new URLSearchParams({ results: '1' });
  if(readKey) params.set('api_key', readKey);

  // 1) feeds.json
  return new Promise(function(resolve, reject) {
    var url1 = base + '/feeds.json?' + params.toString();
    fetch(url1, { cache: 'no-store' }).then(function(r1) {
      if(r1.ok){
        return r1.json();
      }
      throw new Error('feeds.json failed');
    }).then(function(j) {
      if(j && j.feeds && j.feeds.length){
        var val = j.feeds[0]['field' + field];
        var n = toNumberOrNull(val);
        if(n !== null) {
          resolve(n);
          return;
        }
      }
      throw new Error('No valid data in feeds.json');
    }).catch(function() {
      // 2) fields/{n}/last.json
      var u2 = new URL(base + '/fields/' + field + '/last.json');
      if(readKey) u2.searchParams.set('api_key', readKey);
      return fetch(u2.toString(), { cache: 'no-store' });
    }).then(function(r2) {
      if(r2 && r2.ok){
        return r2.text();
      }
      throw new Error('last.json failed');
    }).then(function(t) {
      try{
        var j2 = JSON.parse(t);
        var n = toNumberOrNull(j2.field || j2['field' + field] || j2.value || j2);
        if(n !== null) {
          resolve(n);
          return;
        }
      }catch(_){
        var n = toNumberOrNull(t);
        if(n !== null) {
          resolve(n);
          return;
        }
      }
      throw new Error('Could not parse last.json');
    }).catch(function() {
      // 3) last.txt
      var u3 = new URL(base + '/fields/' + field + '/last.txt');
      if(readKey) u3.searchParams.set('api_key', readKey);
      return fetch(u3.toString(), { cache: 'no-store' });
    }).then(function(r3) {
      if(r3 && r3.ok){
        return r3.text();
      }
      throw new Error('last.txt failed');
    }).then(function(t3) {
      var n = toNumberOrNull(t3);
      if(n !== null) {
        resolve(n);
        return;
      }
      throw new Error('Could not parse last.txt');
    }).catch(function() {
      reject(new Error('Unable to parse ThingSpeak value for field ' + field));
    });
  });
}


function pollThingSpeak(){
  var promises = [];
  
  // PM2.5 - เฉพาะที่มี channelId เท่านั้น
  if(THINGSPEAK.klong_pm25.channelId && THINGSPEAK.klong_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.klong_pm25).then(function(value) {
        dataState.klong.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.thon_pm25.channelId && THINGSPEAK.thon_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.thon_pm25).then(function(value) {
        dataState.thon.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.bang_pm25.channelId && THINGSPEAK.bang_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.bang_pm25).then(function(value) {
        dataState.bang.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }

  // Temperature - เฉพาะที่มี channelId เท่านั้น
  if(THINGSPEAK.klong_temp.channelId && THINGSPEAK.klong_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.klong_temp).then(function(value) {
        dataState.klong.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.thon_temp.channelId && THINGSPEAK.thon_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.thon_temp).then(function(value) {
        dataState.thon.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.bang_temp.channelId && THINGSPEAK.bang_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.bang_temp).then(function(value) {
        dataState.bang.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  Promise.all(promises).then(function() {
    render();
  }).catch(function(err) {
    console.warn('ThingSpeak fetch error:', err);
    render();
  });
}

// Split pollers for separate control
function pollThingSpeakPM(){
  var promises = [];
  
  if(THINGSPEAK.klong_pm25.channelId && THINGSPEAK.klong_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.klong_pm25).then(function(value) {
        dataState.klong.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.thon_pm25.channelId && THINGSPEAK.thon_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.thon_pm25).then(function(value) {
        dataState.thon.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.bang_pm25.channelId && THINGSPEAK.bang_pm25.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.bang_pm25).then(function(value) {
        dataState.bang.pm25 = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  Promise.all(promises).then(function() {
    render();
  }).catch(function(err) {
    console.warn('ThingSpeak PM fetch error:', err);
    render();
  });
}

function pollThingSpeakTemp(){
  var promises = [];
  
  if(THINGSPEAK.klong_temp.channelId && THINGSPEAK.klong_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.klong_temp).then(function(value) {
        dataState.klong.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.thon_temp.channelId && THINGSPEAK.thon_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.thon_temp).then(function(value) {
        dataState.thon.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  if(THINGSPEAK.bang_temp.channelId && THINGSPEAK.bang_temp.channelId !== "YOUR_CHANNEL_ID"){
    promises.push(
      fetchLastField(THINGSPEAK.bang_temp).then(function(value) {
        dataState.bang.temp = value;
      }).catch(function() {
        // ignore individual errors
      })
    );
  }
  
  Promise.all(promises).then(function() {
    render();
  }).catch(function(err) {
    console.warn('ThingSpeak Temp fetch error:', err);
    render();
  });
}

// เริ่ม Pooling อัตโนมัติ
pollThingSpeak();
// separate timers for PM and Temp live polling
liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000);
liveIntervalTemp = setInterval(pollThingSpeakTemp, THINGSPEAK.intervalMs || 15000);

// initialize charts after DOM ready
document.addEventListener('DOMContentLoaded', function(){
  ensurePMChart();
  ensureTempChart();
  ensureCombinedChart();
  var range = rangeLast24h();
  var start = range.start;
  var end = range.end;
  loadPMTrend(start, end);
  loadTempTrend(start, end);
  loadCombinedTrend(); // Combined trend ไม่รับ parameter - ใช้ realtime เสมอ
  scheduleTrendTimers();
  
  // Initialize time range controls and load with current time defaults
  initializeTimeRangeControls();
  
  // Load initial data with current time range after a short delay
  setTimeout(function() {
    updatePMTrendWithTimeRange();
    updateTempTrendWithTimeRange();
  }, 500);
  
  // เริ่ม timer สำหรับ Combined Trend (realtime)
  setInterval(function(){
    loadCombinedTrend();
  }, TREND.liveRefreshMs || 30000);
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
  var overallEl = document.getElementById('overallAQI');
  var bestEl = document.getElementById('bestDistrict');
  var worstEl = document.getElementById('worstDistrict');
  var badgeEl = document.getElementById('aqiLevelBadge');
  var adviceEl = document.getElementById('adviceText');
  var updatedEl = document.getElementById('insightsUpdated');
  if(!overallEl || !badgeEl) return; // insights not on page

  var aqi = {
    'Klong San': aqiFromPM25(dataState.klong.pm25 || 0),
    'Thon Buri':  aqiFromPM25(dataState.thon.pm25 || 0),
    'Bang Rak':  aqiFromPM25(dataState.bang.pm25 || 0)
  };
  var entries = Object.keys(aqi).map(function(key) {
    return [key, aqi[key]];
  });
  var values = entries.map(function(entry) { return entry[1]; });
  var overall = Math.max.apply(Math, values);
  var best = entries.reduce(function(min, cur) { 
    return cur[1] < min[1] ? cur : min; 
  });
  var worst = entries.reduce(function(max, cur) { 
    return cur[1] > max[1] ? cur : max; 
  });

  overallEl.textContent = String(overall).padStart(3,'0');
  if(bestEl) bestEl.textContent = best[0]; // แสดงเฉพาะชื่อเขต
  if(worstEl) worstEl.textContent = worst[0]; // แสดงเฉพาะชื่อเขต
  var adv = computeAQIAdvice(overall);
  badgeEl.className = 'badge ' + adv.className;
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
window.updateAQ = function(key, obj){
  Object.assign(dataState[key], obj);
  render();
};// Initialize
document.addEventListener('DOMContentLoaded', function() {
  // Default date values to today
  var todayStr = new Date().toISOString().slice(0,10);
  if(dateInputPM) dateInputPM.value = todayStr;
  if(dateInputTemp) dateInputTemp.value = todayStr;

  // PM controls
  // Auto-load when PM date changes
  if(dateInputPM){
    dateInputPM.addEventListener('change', function(){
      var val = dateInputPM.value;
      if(val){
        if(liveIntervalPM){ clearInterval(liveIntervalPM); liveIntervalPM=null; }
        updateTimeOptionsForDate(pmStartTimeSelect, pmEndTimeSelect, val);
        // Use time-range-aware function instead of loadDayPM
        setTimeout(function() {
          updatePMTrendWithTimeRange();
        }, 100);
      }
    });
  }
  if(btnTodayPM){
    btnTodayPM.addEventListener('click', function(){
      // Set date to today
      var today = new Date();
      var todayStr = today.getFullYear() + '-' + 
                     String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(today.getDate()).padStart(2, '0');
      if(dateInputPM) dateInputPM.value = todayStr;
      
      // Update time options for today
      updateTimeOptionsForDate(pmStartTimeSelect, pmEndTimeSelect, todayStr);
      
      // Set live mode and start interval
      setViewingModePM(true);
      if(!liveIntervalPM){ liveIntervalPM = setInterval(pollThingSpeakPM, THINGSPEAK.intervalMs || 15000); }
      
      // Update chart with time range
      setTimeout(function() {
        updatePMTrendWithTimeRange();
      }, 100);
    });
  }

  // Temp controls
  // Auto-load when Temp date changes
  if(dateInputTemp){
    dateInputTemp.addEventListener('change', function(){
      var val = dateInputTemp.value;
      if(val){
        if(liveIntervalTemp){ clearInterval(liveIntervalTemp); liveIntervalTemp=null; }
        updateTimeOptionsForDate(tempStartTimeSelect, tempEndTimeSelect, val);
        // Use time-range-aware function instead of loadDayTemp
        setTimeout(function() {
          updateTempTrendWithTimeRange();
        }, 100);
      }
    });
  }
  if(btnTodayTemp){
    btnTodayTemp.addEventListener('click', function(){
      // Set date to today
      var today = new Date();
      var todayStr = today.getFullYear() + '-' + 
                     String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(today.getDate()).padStart(2, '0');
      if(dateInputTemp) dateInputTemp.value = todayStr;
      
      // Update time options for today
      updateTimeOptionsForDate(tempStartTimeSelect, tempEndTimeSelect, todayStr);
      
      // Set live mode and start interval
      setViewingModeTemp(true);
      if(!liveIntervalTemp){ liveIntervalTemp = setInterval(pollThingSpeakTemp, THINGSPEAK.intervalMs || 15000); }
      
      // Update chart with time range
      setTimeout(function() {
        updateTempTrendWithTimeRange();
      }, 100);
    });
  }
});

// ===== WHO GOAL TRACKER MODULE =====

var whoTrackerState = {
  currentMetric: 'pm25', // pm25, aqi, temp
  currentStandard: 'who', // who, th, custom
  customThreshold: 25,
  dailyGoal: 20,
  hourlyData: new Array(24).fill(null),
  isInitialized: false
};

// Threshold definitions
var THRESHOLDS = {
  pm25: {
    who: 15,    // WHO 2021 guideline
    th: 37.5,   // Thailand standard (24h average)
    custom: 25  // Default custom value
  },
  aqi: {
    who: 50,    // Equivalent to PM2.5 15
    th: 100,    // Equivalent to PM2.5 37.5
    custom: 75  // Default custom value
  },
  temp: {
    who: 35,    // Heat warning threshold
    th: 40,     // Thailand heat warning
    custom: 32  // Default custom value
  }
};

function initWhoTracker() {
  console.log('Initializing WHO Goal Tracker...');
  
  // Hook DOM elements and event listeners
  var metricButtons = document.querySelectorAll('.who-metric');
  var standardButtons = document.querySelectorAll('.who-standard');
  var customThresholdInput = document.getElementById('customThreshold');
  var goalSlider = document.getElementById('goalHours');
  var goalDisplay = document.getElementById('goalValue');
  
  // Metric selection
  metricButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var metric = btn.getAttribute('data-metric');
      if (metric !== whoTrackerState.currentMetric) {
        metricButtons.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        whoTrackerState.currentMetric = metric;
        updateCustomThreshold();
        loadTodayDataAndUpdate();
      }
    });
  });
  
  // Standard selection
  standardButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var standard = btn.getAttribute('data-standard');
      if (standard !== whoTrackerState.currentStandard) {
        standardButtons.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        whoTrackerState.currentStandard = standard;
        
        // Show/hide custom input
        var customGroup = document.querySelector('.custom-threshold');
        if (customGroup) {
          customGroup.style.display = standard === 'custom' ? 'flex' : 'none';
        }
        
        updateSummary();
        updateComplianceBar();
      }
    });
  });
  
  // Custom threshold input
  if (customThresholdInput) {
    customThresholdInput.addEventListener('input', function() {
      var value = parseFloat(customThresholdInput.value);
      if (!isNaN(value) && value > 0) {
        whoTrackerState.customThreshold = value;
        updateSummary();
        updateComplianceBar();
      }
    });
  }
  
  // Goal slider
  if (goalSlider && goalDisplay) {
    goalSlider.addEventListener('input', function() {
      var value = parseInt(goalSlider.value);
      whoTrackerState.dailyGoal = value;
      goalDisplay.textContent = value + 'h';
      updateSummary();
    });
  }
  
  // Initialize hours grid
  createHoursGrid();
  
  // Update custom threshold input
  updateCustomThreshold();
  
  // Load today's data
  loadTodayDataAndUpdate();
  
  // Update data periodically
  setInterval(loadTodayDataAndUpdate, 5 * 60 * 1000); // Every 5 minutes
  
  whoTrackerState.isInitialized = true;
}

function createHoursGrid() {
  var grid = document.getElementById('hoursGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  for (var hour = 0; hour < 24; hour++) {
    var hourBar = document.createElement('div');
    hourBar.className = 'hour-bar no-data';
    hourBar.setAttribute('data-hour', hour);
    
    var hourFill = document.createElement('div');
    hourFill.className = 'hour-fill';
    hourFill.style.height = '20%'; // Default height
    
    var hourLabel = document.createElement('div');
    hourLabel.className = 'hour-label';
    hourLabel.textContent = String(hour).padStart(2, '0');
    
    hourBar.appendChild(hourFill);
    hourBar.appendChild(hourLabel);
    
    // Add click handler to focus charts above
    hourBar.addEventListener('click', function() {
      var clickedHour = parseInt(this.getAttribute('data-hour'));
      focusChartsOnHour(clickedHour);
    });
    
    grid.appendChild(hourBar);
  }
}

function updateCustomThreshold() {
  var input = document.getElementById('customThreshold');
  if (input) {
    var metric = whoTrackerState.currentMetric;
    input.placeholder = THRESHOLDS[metric].custom.toString();
    if (whoTrackerState.currentStandard === 'custom') {
      whoTrackerState.customThreshold = THRESHOLDS[metric].custom;
      input.value = whoTrackerState.customThreshold;
    }
  }
}

function loadTodayDataAndUpdate() {
  // Get today's hourly data for the current metric
  var today = new Date();
  var startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  var endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);
  
  // Use existing ThingSpeak configuration
  var configMap = {
    'pm25': [THINGSPEAK.klong_pm25, THINGSPEAK.thon_pm25, THINGSPEAK.bang_pm25],
    'temp': [THINGSPEAK.klong_temp, THINGSPEAK.thon_temp, THINGSPEAK.bang_temp]
  };
  
  var configs = configMap[whoTrackerState.currentMetric] || configMap['pm25'];
  
  Promise.all([
    fetchSeries(configs[0], startOfDay, endOfDay),
    fetchSeries(configs[1], startOfDay, endOfDay),
    fetchSeries(configs[2], startOfDay, endOfDay)
  ]).then(function(results) {
    // Combine all districts and bin by hour
    var allData = [];
    results.forEach(function(districtData) {
      allData = allData.concat(districtData);
    });
    
    // Bin into 24 hours and average
    var hourlyData = new Array(24).fill(null);
    var hourlyCounts = new Array(24).fill(0);
    
    allData.forEach(function(point) {
      var hour = point.x.getHours();
      if (point.y !== null && !isNaN(point.y)) {
        if (hourlyData[hour] === null) hourlyData[hour] = 0;
        hourlyData[hour] += point.y;
        hourlyCounts[hour]++;
      }
    });
    
    // Calculate averages and convert to AQI if needed
    for (var h = 0; h < 24; h++) {
      if (hourlyCounts[h] > 0) {
        hourlyData[h] /= hourlyCounts[h];
        if (whoTrackerState.currentMetric === 'aqi') {
          hourlyData[h] = computeAQIFromPM25(hourlyData[h]);
        }
      }
    }
    
    whoTrackerState.hourlyData = hourlyData;
    updateComplianceBar();
    updateSummary();
    
  }).catch(function(error) {
    console.error('WHO Tracker data loading error:', error);
    // Generate mock data as fallback
    generateMockHourlyData();
    updateComplianceBar();
    updateSummary();
  });
}

function generateMockHourlyData() {
  var metric = whoTrackerState.currentMetric;
  var hourlyData = new Array(24);
  
  for (var h = 0; h < 24; h++) {
    var baseValue, value;
    
    switch (metric) {
      case 'pm25':
        baseValue = 20 + 15 * Math.sin((h - 6) * Math.PI / 12);
        value = Math.max(5, baseValue + (Math.random() - 0.5) * 20);
        break;
      case 'aqi':
        baseValue = 60 + 30 * Math.sin((h - 6) * Math.PI / 12);
        value = Math.max(20, baseValue + (Math.random() - 0.5) * 40);
        break;
      case 'temp':
        baseValue = 30 + 6 * Math.sin((h - 14) * Math.PI / 12);
        value = baseValue + (Math.random() - 0.5) * 4;
        break;
      default:
        value = Math.random() * 50 + 25;
    }
    
    hourlyData[h] = parseFloat(value.toFixed(1));
    
    // Randomly make some hours null (no data)
    if (Math.random() < 0.1) {
      hourlyData[h] = null;
    }
  }
  
  whoTrackerState.hourlyData = hourlyData;
}

function getCurrentThreshold() {
  var metric = whoTrackerState.currentMetric;
  var standard = whoTrackerState.currentStandard;
  
  if (standard === 'custom') {
    return whoTrackerState.customThreshold;
  }
  
  return THRESHOLDS[metric][standard];
}

function getComplianceStatus(value, threshold) {
  if (value === null) return 'no-data';
  
  var metric = whoTrackerState.currentMetric;
  
  // For PM2.5 and AQI, lower is better
  if (metric === 'pm25' || metric === 'aqi') {
    if (value <= threshold) return 'good';
    if (value <= threshold * 1.5) return 'moderate';
    return 'unhealthy';
  }
  
  // For temperature, higher is worse
  if (metric === 'temp') {
    if (value < threshold) return 'good';
    if (value < threshold + 5) return 'moderate';
    return 'unhealthy';
  }
  
  return 'no-data';
}

function updateComplianceBar() {
  var grid = document.getElementById('hoursGrid');
  if (!grid) return;
  
  var threshold = getCurrentThreshold();
  var bars = grid.querySelectorAll('.hour-bar');
  
  bars.forEach(function(bar, hour) {
    var value = whoTrackerState.hourlyData[hour];
    var status = getComplianceStatus(value, threshold);
    
    // Remove all status classes
    bar.classList.remove('good', 'moderate', 'unhealthy', 'no-data');
    bar.classList.add(status);
    
    // Set height based on value (normalized)
    var fill = bar.querySelector('.hour-fill');
    if (fill) {
      var height = 20; // Default height for no-data
      if (value !== null) {
        // Normalize height based on metric
        var maxValue = threshold * 3; // Show relative to threshold
        height = Math.min(90, Math.max(10, (value / maxValue) * 80 + 10));
      }
      fill.style.height = height + '%';
    }
    
    // Add tooltip
    var tooltip = value !== null ? 
      value.toFixed(1) + getUnitSuffix() : 'No data';
    bar.title = String(hour).padStart(2, '0') + ':00 - ' + tooltip;
  });
}

function getUnitSuffix() {
  switch (whoTrackerState.currentMetric) {
    case 'pm25': return ' μg/m³';
    case 'aqi': return ' AQI';
    case 'temp': return ' °C';
    default: return '';
  }
}

function updateSummary() {
  var threshold = getCurrentThreshold();
  var data = whoTrackerState.hourlyData;
  
  var withinCount = 0;
  var exceedCount = 0;
  var currentStreak = 0;
  var tempStreak = 0;
  
  // Count compliance and calculate streak
  for (var h = 0; h < 24; h++) {
    var value = data[h];
    if (value !== null) {
      var isWithin = getComplianceStatus(value, threshold) === 'good';
      if (isWithin) {
        withinCount++;
        tempStreak++;
        currentStreak = Math.max(currentStreak, tempStreak);
      } else {
        exceedCount++;
        tempStreak = 0;
      }
    }
  }
  
  // Update DOM elements
  var elements = {
    withinHours: document.getElementById('withinHours'),
    exceedHours: document.getElementById('exceedHours'),
    currentStreak: document.getElementById('currentStreak'),
    personalGoal: document.getElementById('personalGoal')
  };
  
  if (elements.withinHours) {
    elements.withinHours.textContent = withinCount + 'h';
    elements.withinHours.className = 'summary-value';
    if (withinCount >= 20) {
      elements.withinHours.style.color = colorVar('--green', '#1dd196');
    } else if (withinCount >= 12) {
      elements.withinHours.style.color = colorVar('--yellow', '#f4c742');
    } else {
      elements.withinHours.style.color = colorVar('--red', '#ff4757');
    }
  }
  
  if (elements.exceedHours) {
    elements.exceedHours.textContent = exceedCount + 'h';
    elements.exceedHours.className = 'summary-value';
    if (exceedCount <= 2) {
      elements.exceedHours.style.color = colorVar('--green', '#1dd196');
    } else if (exceedCount <= 6) {
      elements.exceedHours.style.color = colorVar('--yellow', '#f4c742');
    } else {
      elements.exceedHours.style.color = colorVar('--red', '#ff4757');
    }
  }
  
  if (elements.currentStreak) {
    elements.currentStreak.textContent = currentStreak + 'h';
    elements.currentStreak.className = 'summary-value';
    if (currentStreak >= 8) {
      elements.currentStreak.style.color = colorVar('--green', '#1dd196');
    } else if (currentStreak >= 4) {
      elements.currentStreak.style.color = colorVar('--yellow', '#f4c742');
    } else {
      elements.currentStreak.style.color = colorVar('--red', '#ff4757');
    }
  }
  
  if (elements.personalGoal) {
    var goalAchieved = withinCount >= whoTrackerState.dailyGoal;
    var goalText = whoTrackerState.dailyGoal + 'h ' + (goalAchieved ? '✓' : '•');
    elements.personalGoal.textContent = goalText;
    elements.personalGoal.className = 'summary-value';
    elements.personalGoal.style.color = goalAchieved ? 
      colorVar('--green', '#1dd196') : colorVar('--muted', '#8fb0cf');
  }
}

function focusChartsOnHour(hour) {
  console.log('Focusing charts on hour:', hour);
  
  // Set time range for PM chart if exists
  var pmStartSelect = document.getElementById('pmStartTime');
  var pmEndSelect = document.getElementById('pmEndTime');
  var pmDateInput = document.getElementById('viewDatePM');
  
  if (pmStartSelect && pmEndSelect) {
    pmStartSelect.value = hour.toString();
    pmEndSelect.value = ((hour + 1) % 24).toString();
    
    // Set date to today if not already set
    if (pmDateInput && !pmDateInput.value) {
      var today = new Date();
      var dateStr = today.getFullYear() + '-' + 
                   String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(today.getDate()).padStart(2, '0');
      pmDateInput.value = dateStr;
    }
    
    // Trigger update if function exists
    if (typeof updatePMTrendWithTimeRange === 'function') {
      updatePMTrendWithTimeRange();
    }
  }
  
  // Set time range for Temperature chart if exists
  var tempStartSelect = document.getElementById('tempStartTime');
  var tempEndSelect = document.getElementById('tempEndTime');
  var tempDateInput = document.getElementById('viewDateTemp');
  
  if (tempStartSelect && tempEndSelect) {
    tempStartSelect.value = hour.toString();
    tempEndSelect.value = ((hour + 1) % 24).toString();
    
    // Set date to today if not already set
    if (tempDateInput && !tempDateInput.value) {
      var today = new Date();
      var dateStr = today.getFullYear() + '-' + 
                   String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(today.getDate()).padStart(2, '0');
      tempDateInput.value = dateStr;
    }
    
    // Trigger update if function exists
    if (typeof updateTempTrendWithTimeRange === 'function') {
      updateTempTrendWithTimeRange();
    }
  }
  
  // Visual feedback
  var allBars = document.querySelectorAll('.hour-bar');
  allBars.forEach(function(bar, index) {
    if (index === hour) {
      bar.style.transform = 'scale(1.1)';
      bar.style.zIndex = '20';
      setTimeout(function() {
        bar.style.transform = '';
        bar.style.zIndex = '';
      }, 1000);
    }
  });
}

// Initialize WHO Tracker when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Add delay to ensure other components are initialized first
  setTimeout(function() {
    if (document.getElementById('bottom-card')) {
      initWhoTracker();
    }
  }, 1000);
});
