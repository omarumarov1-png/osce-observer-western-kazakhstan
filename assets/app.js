const AC = '#1d4ed8';
const GROUP_PALETTE = ['#1d4ed8', '#c2410c', '#059669', '#7c3aed', '#db2777', '#0891b2'];
let MANIFEST = null;
let mapState = null; // holds Leaflet map + markers etc. for the currently open region
let activeLocate = null; // holds the live "you are here" watch for the currently open region, if on
let activeRoute = null; // holds the drawn route line + info panel for the currently displayed route, if any

function fmtOblastLabel(o){ return o; }

/* ================= ROUTE TO A STATION ================= */
// Distance + ETA + an actual road-following route, from wherever the
// "you are here" dot currently is to a chosen polling station. Straight-
// line distance is trivial (both points are known already); a real route
// and travel time need an actual road network, which the map's tiles
// don't provide -- routing goes through OSRM's free public demo server
// (no API key, but a shared instance with no uptime guarantee, and
// driving directions only -- it doesn't serve a walking/cycling profile).
function fmtRouteDistance(meters){
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters/1000).toFixed(meters<10000?1:0)} km`;
}
function fmtRouteDuration(seconds){
  const min = Math.round(seconds/60);
  if(min < 60) return `${min} min`;
  return `${Math.floor(min/60)} h ${min%60} min`;
}
function stopRoute(){
  if(!activeRoute) return;
  if(activeRoute.layer) activeRoute.map.removeLayer(activeRoute.layer);
  if(activeRoute.info) activeRoute.map.removeControl(activeRoute.info);
  activeRoute = null;
}
function showRouteInfo(map, html, isErr){
  stopRoute();
  const ctl = L.control({position:'bottomright'});
  ctl.onAdd = function(){
    const d = L.DomUtil.create('div', 'routeinfo' + (isErr ? ' err' : ''));
    d.innerHTML = html;
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  ctl.addTo(map);
  activeRoute = {map, layer:null, info:ctl};
}
async function routeToStation(n){
  if(!mapState || !mapState.map || !mapState.markers) return;
  const map = mapState.map;
  const pec = mapState.markers[n] && mapState.markers[n]._pec;
  if(!pec) return;
  if(!activeLocate || !activeLocate.marker){
    showRouteInfo(map, `<div class="ri-row">Waiting for your location — allow location access, then try again.</div>`, true);
    return;
  }
  map.closePopup();
  const from = activeLocate.marker.getLatLng();
  showRouteInfo(map, `<div class="ri-row">Routing to station #${n}…</div>`);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${pec.lng},${pec.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('routing service returned ' + res.status);
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if(!route) throw new Error('no route found');
    stopRoute();
    const layer = L.geoJSON(route.geometry, {style:{color:'#1d4ed8', weight:5, opacity:.72}}).addTo(map);
    map.fitBounds(layer.getBounds(), {padding:[50,50]});
    const ctl = L.control({position:'bottomright'});
    ctl.onAdd = function(){
      const d = L.DomUtil.create('div', 'routeinfo');
      d.innerHTML = `<div class="ri-row"><b>Station #${n}</b> · ${fmtRouteDistance(route.distance)} · ${fmtRouteDuration(route.duration)} drive</div>
        <button class="mbtn" id="clearRouteBtn">✕ Clear route</button>`;
      L.DomEvent.disableClickPropagation(d);
      setTimeout(()=>{ const b=document.getElementById('clearRouteBtn'); if(b) b.onclick = stopRoute; }, 0);
      return d;
    };
    ctl.addTo(map);
    activeRoute = {map, layer, info:ctl};
  } catch(err){
    console.warn('Routing failed:', err.message);
    showRouteInfo(map, `<div class="ri-row">Couldn't get a route right now — the free routing server may be busy. Try again in a moment.</div>`, true);
  }
}

/* ================= TRANSLITERATION (Cyrillic -> Latin) ================= */
// Practical BGN/PCGN-style scheme covering Russian + Kazakh-specific letters.
// Longer digraphs (ё, ж, ц, ч, ш, щ, ю, я, kazakh letters) must be listed before
// any single-letter entries that could partially match, so we sort keys by length.
const TRANSLIT_MAP = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
  'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
  'ь':'','э':'e','ю':'yu','я':'ya',
  // Kazakh-specific
  'ә':'a','ғ':'gh','қ':'q','ң':'ng','ө':'o','ұ':'u','ү':'u','һ':'h','і':'i',
};
const TRANSLIT_KEYS = Object.keys(TRANSLIT_MAP).sort((a,b)=>b.length-a.length);
function transliterate(text){
  if(!text) return '';
  let out = '';
  for(const ch of text){
    const lower = ch.toLowerCase();
    if(TRANSLIT_MAP.hasOwnProperty(lower)){
      let t = TRANSLIT_MAP[lower];
      if(ch !== lower && t) t = t[0].toUpperCase() + t.slice(1);
      out += t;
    } else {
      out += ch;
    }
  }
  // tidy up: capitalize after separators for readability, collapse doubled spaces
  return out.replace(/\s+/g,' ').trim();
}
function hasCyrillic(text){ return /[а-яёәғқңөұүһіА-ЯЁӘҒҚҢӨҰҮҺІ]/.test(text || ''); }
// small span with the transliteration, only rendered when the source text actually has Cyrillic
function tl(text){
  if(!hasCyrillic(text)) return '';
  return `<span class="tl">${transliterate(text)}</span>`;
}

async function boot(){
  const res = await fetch('data/manifest.json');
  MANIFEST = await res.json();
  renderHome();
  window.addEventListener('hashchange', route);
  route();
}

function route(){
  const h = window.location.hash;
  const m = h.match(/^#\/region\/([a-z0-9\-]+)/);
  if(m){
    openRegion(m[1]);
  } else {
    document.getElementById('home').style.display = 'block';
    document.getElementById('region').classList.remove('active');
  }
}

function renderHome(){
  const totalPecincts = MANIFEST.reduce((s,r)=>s+r.count,0);
  const oblasts = [...new Set(MANIFEST.map(r=>r.oblast))];
  document.getElementById('statTotal').textContent = totalPecincts;
  document.getElementById('statRegions').textContent = MANIFEST.length;
  document.getElementById('statOblasts').textContent = oblasts.length;

  const container = document.getElementById('oblastSections');
  container.innerHTML = '';
  oblasts.forEach(ob=>{
    const regions = MANIFEST.filter(r=>r.oblast===ob);
    const section = document.createElement('div');
    section.className = 'oblast-section';
    const totalLow = regions.reduce((s,r)=> s + (r.conf.low||0), 0);
    section.innerHTML = `<h2 class="oblast-title">${fmtOblastLabel(ob)} — ${regions.reduce((s,r)=>s+r.count,0)} stations</h2>
      <div class="card-grid">${regions.map(r=>cardHtml(r)).join('')}</div>`;
    container.appendChild(section);
  });
}

function cardHtml(r){
  const lowN = r.conf.low||0;
  const highN = r.conf.high||0;
  return `<a class="card" href="#/region/${r.id}">
    <h3>${r.title}</h3>
    <div class="sub">${r.subtitle}</div>
    <div class="meta">
      <span class="chip">${r.count} stations</span>
      <span class="chip">${r.groupCount} districts</span>
      ${lowN ? `<span class="chip warn">${lowN} ≈ approximate</span>` : (highN===r.count ? `<span class="chip">all verified</span>` : '')}
    </div>
  </a>`;
}

/* ================= REGION MAP VIEW ================= */

async function openRegion(id){
  const meta = MANIFEST.find(r=>r.id===id);
  if(!meta){ window.location.hash = ''; return; }
  document.getElementById('home').style.display = 'none';
  document.getElementById('region').classList.add('active');
  setMobileView('list'); // always open on the list on phones, same starting point every time

  if(mapState && mapState.id === id){ return; } // already loaded
  document.getElementById('side').querySelector('#head h1').textContent = meta.title + ' · Polling Stations';
  document.getElementById('head-sub').textContent = `${meta.count} polling stations — ${meta.subtitle}. Click a station in the list or on the map.`;
  document.getElementById('cTot').textContent = meta.count;

  const res = await fetch('data/' + meta.file);
  const PECS = await res.json();
  mountMap(id, meta, PECS);
}

/* ================= "YOU ARE HERE" LOCATION ================= */
// Google-Maps-style blue dot + heading arrow. The arrow is drawn from
// whichever of two real (never guessed) heading sources is currently
// available:
//   1. Compass (webkitCompassHeading on iOS, or an explicitly `absolute`
//      deviceorientation event elsewhere) -- true heading, updates even
//      while standing still. Plain relative-orientation alpha is relative
//      to wherever the phone happened to be pointed when the page loaded,
//      not true north, so it's never used -- that would silently mislead
//      a field observer about which way they're actually facing.
//   2. GPS course-over-ground (Coords.heading from watchPosition) -- the
//      direction of actual travel, only reported while moving. This needs
//      no permission prompt at all, so it's what gives iOS users an arrow
//      in practice: iOS gates DeviceOrientationEvent behind a permission
//      call that only works from inside a user gesture, and there's no
//      button left to hang that off since location now starts
//      automatically on map mount (see startLocate below). Once a real
//      compass reading does arrive it takes over permanently -- it's more
//      precise and works standing still, GPS heading is just the fallback
//      for whenever compass isn't available.
// No reading from either source yet just means no arrow, same as Google
// Maps itself.
function locIcon(heading){
  const arrow = (heading==null) ? '' : `<div class="locrot" style="transform:rotate(${heading}deg)"><div class="locarrow"></div></div>`;
  return L.divIcon({html:`<div class="locwrap"><div class="locpulse"></div>${arrow}<div class="locdot"></div></div>`,
    className:'', iconSize:[32,32], iconAnchor:[16,16]});
}
function stopLocate(){
  if(!activeLocate) return;
  if(activeLocate.watchId!=null) navigator.geolocation.clearWatch(activeLocate.watchId);
  if(activeLocate.onOrient){
    window.removeEventListener('deviceorientationabsolute', activeLocate.onOrient);
    window.removeEventListener('deviceorientation', activeLocate.onOrient);
  }
  if(activeLocate.marker) activeLocate.map.removeLayer(activeLocate.marker);
  if(activeLocate.circle) activeLocate.map.removeLayer(activeLocate.circle);
  activeLocate = null;
}
// Starts automatically whenever a region's map mounts (see the end of
// mountMap()) rather than behind a button tap -- the browser's own native
// permission prompt is what actually gates this, so there's no need for
// an extra in-app affordance on top of it. The one real cost of no longer
// requiring a tap: iOS gates DeviceOrientationEvent (the compass heading)
// behind a permission call that ONLY works from inside a user gesture, so
// without a click to hang that call off, iOS users never get a compass
// reading -- the GPS-course fallback in place() below is what covers that
// gap in practice, since it needs no permission at all.
function startLocate(map){
  if(!navigator.geolocation) return;
  let heading = null, centered = false, usingCompass = false;

  function place(lat, lng, accuracy, gpsHeading){
    const ll = [lat, lng];
    // Only fall back to GPS course-over-ground while no compass reading
    // has ever arrived -- once the compass is live it's strictly better
    // (works standing still, doesn't need movement) and should win for
    // good rather than fight with GPS updates for the same arrow.
    if(!usingCompass && typeof gpsHeading === 'number' && !Number.isNaN(gpsHeading)){
      heading = gpsHeading;
    }
    if(!activeLocate.marker){
      activeLocate.marker = L.marker(ll, {icon:locIcon(heading), zIndexOffset:1000}).addTo(map);
      activeLocate.circle = L.circle(ll, {radius:accuracy, color:'#1d4ed8', weight:1, opacity:.35, fillColor:'#1d4ed8', fillOpacity:.08}).addTo(map);
    } else {
      activeLocate.marker.setLatLng(ll);
      activeLocate.marker.setIcon(locIcon(heading));
      activeLocate.circle.setLatLng(ll).setRadius(accuracy);
    }
    if(!centered){
      centered = true;
      map.setView(ll, Math.max(map.getZoom(), 15), {animate:true});
    }
  }

  function onOrient(e){
    let h = null;
    if(typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS: already true heading
    else if(e.absolute===true && typeof e.alpha === 'number') h = (360 - e.alpha) % 360; // spec-compliant absolute orientation
    if(h==null) return;
    usingCompass = true;
    heading = h;
    if(activeLocate && activeLocate.marker) activeLocate.marker.setIcon(locIcon(heading));
  }

  function afterOrientPermission(){
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('deviceorientation', onOrient);
  }

  const watchId = navigator.geolocation.watchPosition(
    pos => place(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 30, pos.coords.heading),
    err => { console.warn('Geolocation unavailable:', err.message); stopLocate(); },
    {enableHighAccuracy:true, maximumAge:5000, timeout:15000}
  );
  activeLocate = {map, watchId, marker:null, circle:null, onOrient};

  // No user gesture available here (this runs on map mount, not a click),
  // so on iOS this permission call will simply never resolve -- everywhere
  // else it's a no-op requirement and the listener attaches immediately.
  if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(state => { if(state==='granted') afterOrientPermission(); }).catch(()=>{});
  } else {
    afterOrientPermission();
  }
}

function mountMap(id, meta, PECS){
  // tear down any previous map instance
  stopLocate();
  stopRoute();
  if(mapState && mapState.map){ mapState.map.remove(); mapState = null; }
  document.getElementById('loading').style.display = 'flex';

  const map = L.map('map', {zoomControl:true, minZoom:3, maxZoom:19}).setView(meta.center, meta.count > 60 ? 12 : 9);

  const allGroups = [...new Set(PECS.map(p=>p.group))].sort((a,b)=>a.localeCompare(b,'ru'));
  const multiColor = allGroups.length > 1 && allGroups.length <= GROUP_PALETTE.length;
  const groupColor = {};
  if(multiColor){ allGroups.forEach((g,i)=> groupColor[g] = GROUP_PALETTE[i % GROUP_PALETTE.length]); }
  const colorFor = (group) => multiColor ? groupColor[group] : AC;

  const bases = {
    'Streets': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'}),
    'Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'}),
    'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {subdomains:'abc', maxZoom:19, attribution:'© OpenStreetMap'}),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'© Esri'}),
  };
  const activeBase = bases['Streets'];
  activeBase.addTo(map);
  activeBase.on('load', () => { const l=document.getElementById('loading'); if(l) l.style.display='none'; });
  setTimeout(()=>{ const l=document.getElementById('loading'); if(l) l.style.display='none'; }, 2500);
  L.control.layers(bases, null, {position:'topright', collapsed:true}).addTo(map);
  L.control.scale({imperial:false, position:'bottomleft'}).addTo(map);

  function pinIcon(p, hl){
    const approx = p.c==='low', big = String(p.n).length>2, sz = approx?26:25;
    const c = colorFor(p.group);
    const bg = approx ? '#fff' : c;
    const style = `width:${sz}px;height:${sz}px;font-size:${big?10:11.5}px;background:${bg};` + (approx ? `border-color:${c};` : '');
    return L.divIcon({html:`<div class="pecpin ${approx?'approx':''}${hl?' hl':''}" style="${style}">${p.n}</div>`,
      className:'', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], popupAnchor:[0,-sz/2-1]});
  }
  function popHtml(p){
    let h = `<div class="pop"><b class="t">Station #${p.n}</b><span class="chip2" style="background:${colorFor(p.group)}">${p.group}</span>${tl(p.group)}`;
    if(p.b) h += `<div class="bd">${p.b}${tl(p.b)}</div>`;
    if(p.a) h += `<div class="ad">${p.a}${tl(p.a)}</div>`;
    h += `<div class="co" title="Copy coordinates" onclick="navigator.clipboard&&navigator.clipboard.writeText('${p.lat}, ${p.lng}')">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} ⧉</div>`;
    if(p.c==='low') h += `<div class="w">≈ Approximate location — verify on the ground${p.note?': '+p.note:''}</div>`;
    else if(p.c==='med') h += `<div class="w">Address not independently verified${p.note?' ("'+p.note+'")':''}</div>`;
    const g = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    const y = `https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=16&l=map`;
    h += `<div class="links"><a href="${g}" target="_blank" rel="noopener">Google&nbsp;Maps</a><a href="${y}" target="_blank" rel="noopener">Yandex&nbsp;Maps</a></div></div>`;
    return h;
  }

  const markers = {};
  let cluster = null, plainLayer = L.layerGroup();
  const hasCluster = (typeof L.markerClusterGroup === 'function');
  if(hasCluster){
    cluster = L.markerClusterGroup({maxClusterRadius:36, spiderfyOnMaxZoom:true, showCoverageOnHover:false,
      iconCreateFunction:c=>{ const n=c.getChildCount(); const sz=n<10?34:n<40?42:50;
        return L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45)">${n}</div>`, className:'', iconSize:[sz,sz]});}});
  }
  PECS.forEach(p=>{
    const m = L.marker([p.lat, p.lng], {icon:pinIcon(p,false)});
    m.bindPopup(popHtml(p)); m._pec = p; markers[p.n] = m;
    (hasCluster?cluster:plainLayer).addLayer(m);
  });
  let clustered = hasCluster;
  map.addLayer(clustered?cluster:plainLayer);

  const allBounds = L.latLngBounds(PECS.map(p=>[p.lat,p.lng]));
  map.fitBounds(allBounds, {padding:[40,40]});
  setTimeout(()=>map.invalidateSize(), 300);
  setTimeout(()=>map.invalidateSize(), 1200);

  const lg = L.control({position:'bottomright'});
  lg.onAdd = function(){ const d=L.DomUtil.create('div','legend');
    const districtRows = multiColor
      ? allGroups.map(g=>`<div class="li"><span class="lm" style="background:${groupColor[g]};color:#fff;border:2px solid #fff">№</span> ${g}</div>`).join('')
      : `<div class="li"><span class="lm" style="background:${AC};color:#fff;border:2px solid #fff">№</span> polling station</div>`;
    d.innerHTML = `<h4>General info</h4>
      ${districtRows}
      <div class="li"><span class="lm" style="background:#fff;border:2px dashed ${AC};color:${AC}">≈</span> approximate — verify</div>
      <div class="li"><span class="lm" style="background:#0f172a;color:#fff">15</span> cluster (click to expand)</div>`;
    L.DomEvent.disableClickPropagation(d); return d; };
  lg.addTo(map);

  const ctl = L.control({position:'topleft'});
  ctl.onAdd = function(){ const d=L.DomUtil.create('div','mapbtns');
    d.innerHTML = `<button class="mbtn" id="resetBtn" title="Show whole region">⤢ Whole region</button>
      <button class="mbtn ${clustered?'on':''}" id="clusterBtn" title="Cluster nearby stations">◉ Cluster</button>`;
    L.DomEvent.disableClickPropagation(d);
    setTimeout(()=>{
      document.getElementById('resetBtn').onclick = () => map.fitBounds(allBounds, {padding:[40,40]});
      document.getElementById('clusterBtn').onclick = function(){
        if(!hasCluster) return;
        clustered = !clustered; this.classList.toggle('on', clustered);
        if(clustered){ map.removeLayer(plainLayer); map.addLayer(cluster); }
        else { map.removeLayer(cluster); plainLayer = L.layerGroup(); PECS.forEach(p=>plainLayer.addLayer(markers[p.n])); map.addLayer(plainLayer); }
      };
    }, 0);
    return d; };
  ctl.addTo(map);
  startLocate(map);

  const groups = [...new Set(PECS.map(p=>p.group))].sort((a,b)=>a.localeCompare(b,'ru'));
  document.getElementById('cGrp').textContent = groups.length;
  document.getElementById('cApx').textContent = PECS.filter(p=>p.c==='low').length;
  const groupSel = document.getElementById('groupSel');
  groupSel.innerHTML = '<option value="all">All districts</option>';
  groups.forEach(g=>{ const opt=document.createElement('option'); opt.value=g; opt.textContent=g; groupSel.appendChild(opt); });

  const listEl = document.getElementById('list'), emptyEl = document.getElementById('empty'), qEl = document.getElementById('q');
  const shownCount = document.getElementById('shownCount'), clrBtn = document.getElementById('clr');
  let fGroup = 'all', fC = 'all', selNum = null, sortMode = 'num';
  function passesConf(p){ return fC==='all' || (fC==='approx' && p.c==='low') || (fC==='ok' && p.c!=='low'); }
  function currentList(){
    const q = qEl.value.trim().toLowerCase();
    let arr = PECS.filter(p=>{
      if(fGroup!=='all' && p.group!==fGroup) return false;
      if(!passesConf(p)) return false;
      if(q){ const hay = (p.n+' '+p.b+' '+p.a+' '+p.group).toLowerCase(); if(!hay.includes(q)) return false; }
      return true;
    });
    if(sortMode==='num') arr.sort((a,b)=>a.n-b.n);
    else arr.sort((a,b)=>(a.b||'').localeCompare(b.b||'','ru'));
    return arr;
  }
  function render(){
    const arr = currentList();
    listEl.innerHTML = '';
    arr.forEach(p=>{
      const approx = p.c==='low';
      const c = colorFor(p.group);
      const numStyle = approx ? `border-color:${c};color:${c}` : `background:${c}`;
      const row = document.createElement('div');
      row.className = 'row' + (p.n===selNum ? ' sel' : '');
      row.innerHTML = `<div class="num${approx?' approx':''}" style="${numStyle}">${p.n}</div>
        <div class="meta"><div class="bldg">${p.b||'—'}${tl(p.b)}</div><div class="addr">${p.a}${tl(p.a)}</div><div class="grp">${p.group}${tl(p.group)}</div>${approx?'<span class="flag">≈ verify on site</span>':(p.c==='med'?'<span class="flag med">unverified address</span>':'')}</div>`;
      row.onmouseenter = () => highlight(p.n, true);
      row.onmouseleave = () => highlight(p.n, false);
      row.onclick = () => { selNum = p.n; focusPec(p.n); render(); if(window.innerWidth<=820) setMobileView('map'); };
      listEl.appendChild(row);
    });
    emptyEl.style.display = arr.length ? 'none' : 'block';
    shownCount.textContent = 'Showing ' + arr.length + ' of ' + PECS.length;
    clrBtn.style.display = qEl.value ? 'block' : 'none';
  }
  function highlight(n, on){ const m = markers[n]; if(!m) return; m.setIcon(pinIcon(m._pec, on)); }
  function focusPec(n){
    const m = markers[n]; if(!m) return;
    const go = () => m.openPopup();
    if(clustered && hasCluster && cluster.zoomToShowLayer){
      cluster.zoomToShowLayer(m, go);
    } else {
      map.setView(m.getLatLng(), 15, {animate:true});
      setTimeout(go, 300);
    }
  }
  qEl.oninput = render;
  clrBtn.onclick = () => { qEl.value=''; render(); qEl.focus(); };
  qEl.value = '';
  document.onkeydown = (e) => { if(e.key==='Escape' && document.getElementById('region').classList.contains('active')){ qEl.value=''; render(); } };
  groupSel.onchange = () => { fGroup = groupSel.value; render(); };
  document.querySelectorAll('[data-c]').forEach(s=>s.onclick = () => {
    document.querySelectorAll('[data-c]').forEach(x=>x.className='seg');
    s.className = 'seg on' + (s.dataset.c==='approx' ? ' warn' : '');
    fC = s.dataset.c; render();
  });
  document.getElementById('sortBtn').onclick = function(){
    sortMode = sortMode==='num' ? 'name' : 'num';
    this.textContent = 'Sort: ' + (sortMode==='num' ? '# ▲' : 'by name');
    render();
  };
  // Selecting a station -- clicking its marker directly, or clicking its
  // list row (which calls focusPec -> openPopup) -- fires this same event
  // either way, so it's the one place that needs to trigger routing
  // automatically instead of requiring a separate "Route here" tap.
  map.on('popupopen', e => {
    if(e.popup._source && e.popup._source._pec){
      selNum = e.popup._source._pec.n;
      render();
      routeToStation(selNum);
    }
  });
  render();

  mapState = {id, map, markers};
}

// Phones get a full-height Map/List toggle instead of a cramped vertical
// split (see the media query in app.css) -- this just flips which one is
// visible and keeps the pill buttons in sync. Below the 820px breakpoint
// the CSS for #app.show-map/:not(.show-map) does nothing, so calling this
// on desktop is harmless (no toggle button is even shown there to trigger it).
function setMobileView(mode){
  const app = document.getElementById('app');
  if(!app) return;
  app.classList.toggle('show-map', mode==='map');
  const listBtn = document.getElementById('toggleListBtn'), mapBtn = document.getElementById('toggleMapBtn');
  if(listBtn) listBtn.classList.toggle('on', mode==='list');
  if(mapBtn) mapBtn.classList.toggle('on', mode==='map');
  // The map container has real dimensions even while visibility:hidden (see
  // the CSS comment), but Leaflet still measured it back when tiles were
  // first requested -- re-measuring after becoming visible is cheap and
  // matches the same invalidateSize() calls mountMap() already does after
  // its own initial layout settles.
  if(mode==='map' && mapState && mapState.map) setTimeout(()=>mapState.map.invalidateSize(), 60);
}

function goHome(){ window.location.hash = ''; }

boot();
