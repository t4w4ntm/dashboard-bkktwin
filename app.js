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
      plugins: {
        legend: { 
          labels: { 
            color: colorVar('--fg','#e8f1ff'),
            filter: function(item, chart) {
              // Show only 3 items in legend to save space
              return item.datasetIndex < 3;
            }
          } 
        },
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
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'PM2.5 (μg/m³)', color: colorVar('--muted','#95b0d1') },
          ticks: { color: colorVar('--muted','#95b0d1') },
          grid: { color: 'rgba(79, 168, 232, 0.12)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Temperature (°C)', color: colorVar('--muted','#95b0d1') },
          ticks: { color: colorVar('--muted','#95b0d1') },
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
    Klong: aqiFromPM25(dataState.klong.pm25 || 0),
    Thon:  aqiFromPM25(dataState.thon.pm25 || 0),
    Bang:  aqiFromPM25(dataState.bang.pm25 || 0)
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
  if(bestEl) bestEl.textContent = best[0] + ' • ' + String(best[1]).padStart(3,'0');
  if(worstEl) worstEl.textContent = worst[0] + ' • ' + String(worst[1]).padStart(3,'0');
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
