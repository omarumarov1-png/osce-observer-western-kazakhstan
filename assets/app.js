const AC = '#1d4ed8';
let MANIFEST = null;
let mapState = null; // holds Leaflet map + markers etc. for the currently open region

function fmtOblastLabel(o){ return o; }

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
    section.innerHTML = `<h2 class="oblast-title">${fmtOblastLabel(ob)} — ${regions.reduce((s,r)=>s+r.count,0)} участков</h2>
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
      <span class="chip">${r.count} УИК</span>
      <span class="chip">${r.groupCount} округов</span>
      ${lowN ? `<span class="chip warn">${lowN} ≈ приблизительно</span>` : (highN===r.count ? `<span class="chip">все подтверждены</span>` : '')}
    </div>
  </a>`;
}

/* ================= REGION MAP VIEW ================= */

async function openRegion(id){
  const meta = MANIFEST.find(r=>r.id===id);
  if(!meta){ window.location.hash = ''; return; }
  document.getElementById('home').style.display = 'none';
  document.getElementById('region').classList.add('active');

  if(mapState && mapState.id === id){ return; } // already loaded
  document.getElementById('side').querySelector('#head h1').textContent = meta.title + ' · УИК';
  document.getElementById('head-sub').textContent = `${meta.count} избирательных участков — ${meta.subtitle}. Нажмите на участок в списке или на карте.`;
  document.getElementById('cTot').textContent = meta.count;

  const res = await fetch('data/' + meta.file);
  const PECS = await res.json();
  mountMap(id, meta, PECS);
}

function mountMap(id, meta, PECS){
  // tear down any previous map instance
  if(mapState && mapState.map){ mapState.map.remove(); mapState = null; }
  document.getElementById('loading').style.display = 'flex';

  const map = L.map('map', {zoomControl:true, minZoom:3, maxZoom:19}).setView(meta.center, meta.count > 60 ? 12 : 9);

  const bases = {
    'Схема (улицы)': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'}),
    'Светлая': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:20, attribution:'© OpenStreetMap © CARTO'}),
    'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {subdomains:'abc', maxZoom:19, attribution:'© OpenStreetMap'}),
    'Спутник': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'© Esri'}),
  };
  const activeBase = bases['Схема (улицы)'];
  activeBase.addTo(map);
  activeBase.on('load', () => { const l=document.getElementById('loading'); if(l) l.style.display='none'; });
  setTimeout(()=>{ const l=document.getElementById('loading'); if(l) l.style.display='none'; }, 2500);
  L.control.layers(bases, null, {position:'topright', collapsed:true}).addTo(map);
  L.control.scale({imperial:false, position:'bottomleft'}).addTo(map);

  function pinIcon(p, hl){
    const approx = p.c==='low', big = String(p.n).length>2, sz = approx?26:25;
    const bg = approx ? '#fff' : AC;
    const style = `width:${sz}px;height:${sz}px;font-size:${big?10:11.5}px;background:${bg};` + (approx ? `border-color:${AC};` : '');
    return L.divIcon({html:`<div class="pecpin ${approx?'approx':''}${hl?' hl':''}" style="${style}">${p.n}</div>`,
      className:'', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], popupAnchor:[0,-sz/2-1]});
  }
  function popHtml(p){
    let h = `<div class="pop"><b class="t">УИК №${p.n}</b><span class="chip2">${p.group}</span>`;
    if(p.b) h += `<div class="bd">${p.b}</div>`;
    if(p.a) h += `<div class="ad">${p.a}</div>`;
    h += `<div class="co" title="Скопировать координаты" onclick="navigator.clipboard&&navigator.clipboard.writeText('${p.lat}, ${p.lng}')">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} ⧉</div>`;
    if(p.c==='low') h += `<div class="w">≈ Приблизительная привязка — уточните на месте${p.note?': '+p.note:''}</div>`;
    else if(p.c==='med') h += `<div class="w">Адрес требует проверки на месте${p.note?' («'+p.note+'»)':''}</div>`;
    const g = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    const y = `https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=16&l=map`;
    h += `<div class="links"><a href="${g}" target="_blank" rel="noopener">Google&nbsp;Maps</a><a href="${y}" target="_blank" rel="noopener">Яндекс</a></div></div>`;
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
    d.innerHTML = `<h4>Обозначения</h4>
      <div class="li"><span class="lm" style="background:${AC};color:#fff;border:2px solid #fff">№</span> избирательный участок</div>
      <div class="li"><span class="lm" style="background:#fff;border:2px dashed ${AC};color:${AC}">≈</span> приблизит. — проверить</div>
      <div class="li"><span class="lm" style="background:#0f172a;color:#fff">15</span> группа участков (клик)</div>`;
    L.DomEvent.disableClickPropagation(d); return d; };
  lg.addTo(map);

  const ctl = L.control({position:'topleft'});
  ctl.onAdd = function(){ const d=L.DomUtil.create('div','mapbtns');
    d.innerHTML = `<button class="mbtn" id="resetBtn" title="Показать весь регион">⤢ Весь регион</button>
      <button class="mbtn ${clustered?'on':''}" id="clusterBtn" title="Группировать близкие участки">◉ Группировать</button>`;
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

  const groups = [...new Set(PECS.map(p=>p.group))].sort((a,b)=>a.localeCompare(b,'ru'));
  document.getElementById('cGrp').textContent = groups.length;
  document.getElementById('cApx').textContent = PECS.filter(p=>p.c==='low').length;
  const groupSel = document.getElementById('groupSel');
  groupSel.innerHTML = '<option value="all">Все округа</option>';
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
      const row = document.createElement('div');
      row.className = 'row' + (p.n===selNum ? ' sel' : '');
      row.innerHTML = `<div class="num${approx?' approx':''}">${p.n}</div>
        <div class="meta"><div class="bldg">${p.b||'—'}</div><div class="addr">${p.a}</div><div class="grp">${p.group}</div>${approx?'<span class="flag">≈ проверить на месте</span>':(p.c==='med'?'<span class="flag med">уточнить адрес</span>':'')}</div>`;
      row.onmouseenter = () => highlight(p.n, true);
      row.onmouseleave = () => highlight(p.n, false);
      row.onclick = () => { selNum = p.n; focusPec(p.n); render(); };
      listEl.appendChild(row);
    });
    emptyEl.style.display = arr.length ? 'none' : 'block';
    shownCount.textContent = 'Показано: ' + arr.length + ' из ' + PECS.length;
    clrBtn.style.display = qEl.value ? 'block' : 'none';
  }
  function highlight(n, on){ const m = markers[n]; if(!m) return; m.setIcon(pinIcon(m._pec, on)); }
  function focusPec(n){
    const m = markers[n]; if(!m) return;
    const go = () => m.openPopup();
    map.setView(m.getLatLng(), 15, {animate:true});
    if(clustered && hasCluster && cluster.zoomToShowLayer){ cluster.zoomToShowLayer(m, go); } else { setTimeout(go, 250); }
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
    this.textContent = 'Сортировка: ' + (sortMode==='num' ? '№ ▲' : 'по названию');
    render();
  };
  map.on('popupopen', e => { if(e.popup._source && e.popup._source._pec){ selNum = e.popup._source._pec.n; render(); } });
  render();

  mapState = {id, map};
}

function goHome(){ window.location.hash = ''; }

boot();
