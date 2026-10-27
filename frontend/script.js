/* ════════════════════════════════════════
   IMPORTS
════════════════════════════════════════ */
   DATA

const CEMETERY_CENTER = [13.9382, 121.6209];

const graveData = [
  {id:'A-001',name:'Maria Santos',dates:'1945–2021',loc:'Sec A Row 1',status:'occupied',latlng:[14.4810,120.8962]},
  {id:'A-002',name:'Jose Reyes',dates:'1932–2019',loc:'Sec A Row 1',status:'occupied',latlng:[14.4808,120.8965]},
  {id:'A-003',name:'— Available —',dates:'—',loc:'Sec A Row 1',status:'available',latlng:[14.4806,120.8968]},
  {id:'A-004',name:'Carmen Lopez',dates:'1950–2020',loc:'Sec A Row 2',status:'occupied',latlng:[14.4804,120.8961]},
  {id:'A-005',name:'— Reserved —',dates:'Pending',loc:'Sec A Row 2',status:'reserved',latlng:[14.4802,120.8964]},
  {id:'B-001',name:'Antonio Bautista',dates:'1937–2019',loc:'Sec B Row 1',status:'occupied',latlng:[14.4796,120.8970]},
  {id:'B-002',name:'— Available —',dates:'—',loc:'Sec B Row 1',status:'available',latlng:[14.4794,120.8973]},
  {id:'C-001',name:'Rosa Dela Cruz',dates:'1938–2022',loc:'Sec C Row 1',status:'occupied',latlng:[14.4785,120.8967]},
  {id:'C-002',name:'— Available —',dates:'—',loc:'Sec C Row 2',status:'available',latlng:[14.4783,120.8970]},
  {id:'D-001',name:'Nena Ocampo',dates:'1942–2023',loc:'Sec D Row 1',status:'occupied',latlng:[14.4779,120.8960]},
];

const colData = [
  {id:'COL-A1',loc:[14.4810,120.8962],slots:[
    {level:'T1',status:'occupied',name:'Maria Santos',dates:'1945–2021',rel:'Dela Cruz family',notes:''},
    {level:'T2',status:'occupied',name:'Jose Santos',dates:'1938–2017',rel:'Dela Cruz family',notes:''},
    {level:'T3',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T4',status:'reserved',name:null,dates:'Reserved 2024',rel:'Pending applicant',notes:''},
    {level:'T5',status:'available',name:null,dates:null,rel:null,notes:''},
  ]},
  {id:'COL-A2',loc:[14.4806,120.8966],slots:[
    {level:'T1',status:'occupied',name:'Carmen Lopez',dates:'1950–2020',rel:'Lopez family',notes:''},
    {level:'T2',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T3',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T4',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T5',status:'occupied',name:'Pedro Lopez',dates:'1948–2019',rel:'Lopez family',notes:''},
  ]},
  {id:'COL-B1',loc:[14.4796,120.8972],slots:[
    {level:'T1',status:'occupied',name:'Antonio Bautista',dates:'1937–2019',rel:'Bautista family',notes:''},
    {level:'T2',status:'occupied',name:'Rosario Bautista',dates:'1940–2022',rel:'Bautista family',notes:''},
    {level:'T3',status:'reserved',name:null,dates:'Reserved 2024',rel:'Pending',notes:''},
    {level:'T4',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T5',status:'available',name:null,dates:null,rel:null,notes:''},
  ]},
  {id:'COL-B2',loc:[14.4793,120.8976],slots:[
    {level:'T1',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T2',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T3',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T4',status:'reserved',name:null,dates:'Reserved Dec 2024',rel:'Pending',notes:''},
    {level:'T5',status:'available',name:null,dates:null,rel:null,notes:''},
  ]},
  {id:'COL-C1',loc:[14.4785,120.8968],slots:[
    {level:'T1',status:'occupied',name:'Rosa Dela Cruz',dates:'1938–2022',rel:'Dela Cruz family',notes:''},
    {level:'T2',status:'occupied',name:'Manuel Garcia',dates:'1941–2017',rel:'Garcia family',notes:''},
    {level:'T3',status:'occupied',name:'Lila Garcia',dates:'1944–2021',rel:'Garcia family',notes:''},
    {level:'T4',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T5',status:'available',name:null,dates:null,rel:null,notes:''},
  ]},
  {id:'COL-D1',loc:[14.4779,120.8960],slots:[
    {level:'T1',status:'occupied',name:'Nena Ocampo',dates:'1942–2023',rel:'Ocampo family',notes:''},
    {level:'T2',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T3',status:'reserved',name:null,dates:'Reserved 2024',rel:'Pending',notes:''},
    {level:'T4',status:'available',name:null,dates:null,rel:null,notes:''},
    {level:'T5',status:'occupied',name:'Carlos Rivera',dates:'1935–2018',rel:'Rivera family',notes:''},
  ]},
];

import { navConfigs, roleInfo } from './src/data/data.js';

/* ════════════════════════════════════════
   MAPS
════════════════════════════════════════ */
let pubMap=null, colMap=null;
let adminMap=null, planningMap=null;
let pubMarkers=[], colMarkers=[], adminMarkers=[];
let mapsInit={pub:false,col:false,admin:false,planning:false};
let currentRole='';

function makeIcon(status){
  const colors={available:'#10b981',occupied:'#ef4444',reserved:'#f59e0b'};
  const c=colors[status]||'#6b7280';
  return L.divIcon({
    className:'',
    html:`<div style="width:18px;height:18px;border-radius:50%;background:${c};border:3px solid rgba(255,255,255,.35);box-shadow:0 0 10px ${c}88;transition:all .2s"></div>`,
    iconSize:[18,18],iconAnchor:[9,9],popupAnchor:[0,-12]
  });
}

function makeColIcon(selected){
  return L.divIcon({
    className:'',
    html:`<div style="width:22px;height:22px;border-radius:5px;background:${selected?'#198765':'#104735'};border:2px solid ${selected?'#73C9A7':'#146B50'};display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 10px ${selected?'rgba(25,135,101,.5)':'rgba(0,0,0,.4)'}">🏛</div>`,
    iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-14]
  });
}

function initPubMap(){
  console.log('initPubMap called');
  if(mapsInit.pub){
    console.log('Map already initialized');
    return;
  }

  // Check if Leaflet is loaded
  if(typeof L === 'undefined'){
    console.log('Leaflet not loaded yet, retrying in 200ms...');
    setTimeout(initPubMap, 200);
    return;
  }

  const mapEl = document.getElementById('public-map');
  if(!mapEl){
    console.log('Map element not found');
    return;
  }
  console.log('Initializing map...');
  mapsInit.pub=true;
  pubMap=L.map('public-map',{zoomControl:false,attributionControl:true,maxZoom:24,minZoom:19}).setView(CEMETERY_CENTER,19);
  console.log('Map created:', pubMap);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxNativeZoom:19,maxZoom:24}).addTo(pubMap);
  // Add sample markers
  // graveData.forEach(g=>{
  //   const m=L.marker(g.latlng,{icon:makeIcon(g.status)}).addTo(pubMap);
  //   m.on('click',()=>showGravePanel(g));
  //   pubMarkers.push(m);
  // });
  // Add click handler to auto-close landing sidebar and show hamburger
  pubMap.on('click', function(e) {
    console.log('Map clicked at:', e.latlng);
    const landingSidebar = document.getElementById('landing-sidebar');
    const topbarHamburger = document.querySelector('.landing-topbar .hamburger-fab');
    const topbarSearch = document.querySelector('.landing-topbar .search-container');
    const pubSidebar = document.getElementById('pub-sidebar');
    const mapHamburger = document.getElementById('public-hamburger');
    const userSearch = document.getElementById('public-user-search');
    if(landingSidebar && landingSidebar.classList.contains('open')){
      landingSidebar.classList.remove('open');
      if(topbarHamburger) topbarHamburger.classList.remove('hidden');
      if(topbarSearch) topbarSearch.classList.remove('hidden');
    }
    if(pubSidebar && pubSidebar.classList.contains('open')){
      pubSidebar.classList.remove('open');
      if(mapHamburger) mapHamburger.classList.remove('hidden');
      if(userSearch) userSearch.classList.remove('hidden');
    }
  });
  // Force resize after init
  setTimeout(()=>{if(pubMap){pubMap.invalidateSize(); console.log('Map resized');}},100);
  setTimeout(()=>{if(pubMap){pubMap.invalidateSize(); console.log('Map resized again');}},500);
  // Handle window resize
  window.addEventListener('resize', ()=>{if(pubMap){pubMap.invalidateSize(); console.log('Window resize handled');}});
}


function initColMap(){
  if(mapsInit.col)return;

  // Check if Leaflet is loaded
  if(typeof L === 'undefined'){
    console.log('Leaflet not loaded yet for columbarium map, retrying in 200ms...');
    setTimeout(initColMap, 200);
    return;
  }

  mapsInit.col=true;
  colMap=L.map('col-map',{zoomControl:true,attributionControl:true,maxZoom:24}).setView(CEMETERY_CENTER,19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxNativeZoom:19,maxZoom:24}).addTo(colMap);
  colData.forEach((c,i)=>{
    const occ=c.slots.filter(s=>s.status==='occupied').length;
    const m=L.marker(c.loc,{icon:makeColIcon(false)}).addTo(colMap);
    m.bindPopup(`<strong style="color:var(--text-primary)">${c.id}</strong><br><span>${occ}/5 occupied</span>`);
    m.on('click',()=>selectColumbarium(i));
    colMarkers.push(m);
  });
}

function initPlanningMap(){
  if(mapsInit.planning)return;

  // Check if Leaflet is loaded
  if(typeof L === 'undefined'){
    console.log('Leaflet not loaded yet for planning map, retrying in 200ms...');
    setTimeout(initPlanningMap, 200);
    return;
  }

  mapsInit.planning=true;
  planningMap=L.map('planning-map',{zoomControl:true,attributionControl:true,maxZoom:24}).setView(CEMETERY_CENTER,19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxNativeZoom:19,maxZoom:24}).addTo(planningMap);
  // Zone overlay polygons
  const zones=[
    {pts:[[14.4814,120.8957],[14.4814,120.8972],[14.4800,120.8972],[14.4800,120.8957]],color:'#ef4444',label:'Section A (92%)'},
    {pts:[[14.4800,120.8957],[14.4800,120.8972],[14.4788,120.8972],[14.4788,120.8957]],color:'#f59e0b',label:'Section B (78%)'},
    {pts:[[14.4788,120.8957],[14.4788,120.8972],[14.4776,120.8972],[14.4776,120.8957]],color:'#10b981',label:'Section C (34%)'},
    {pts:[[14.4814,120.8972],[14.4814,120.8985],[14.4800,120.8985],[14.4800,120.8972]],color:'#f59e0b',label:'Section D (65%)'},
  ];
  zones.forEach(z=>{
    L.polygon(z.pts,{color:z.color,fillColor:z.color,fillOpacity:.18,weight:1.5,dashArray:'4 4'}).addTo(planningMap).bindPopup(`<strong style="color:var(--text-primary)">${z.label}</strong>`);
  });
  graveData.forEach(g => {
    if (g.status !== 'available') {
      L.circleMarker(g.latlng,{radius:4,color:g.status==='occupied'?'#ef4444':g.status==='reserved'?'#f59e0b':'#10b981',fillOpacity:.8,weight:1.5}).addTo(planningMap);
    }
  });
}

function initAdminMap(){
  if(mapsInit.admin)return;
  mapsInit.admin=true;
  // Admin map for graves, similar to public but with admin controls
  // Assuming #admin-map is the element
  adminMap=L.map('admin-map',{zoomControl:true,attributionControl:true,maxZoom:24}).setView(CEMETERY_CENTER,19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxNativeZoom:19,maxZoom:24}).addTo(adminMap);
  graveData.forEach(g => {
    if (g.status !== 'available') {
      const m=L.marker(g.latlng,{icon:makeIcon(g.status)}).addTo(adminMap);
      m.on('click',()=>showGravePanel(g));
      adminMarkers.push(m);
    }
  });
}

function pubMapZoom(d){
  if(pubMap){
    if(d>0)pubMap.zoomIn();
    else pubMap.zoomOut();
  }
}

function locateUser(){
  if(!pubMap){return;}
  if(!navigator.geolocation){
    alert('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(position=>{
    const {latitude, longitude} = position.coords;
    pubMap.flyTo([latitude, longitude], 17, {animate:true, duration:.9});
    L.circle([latitude, longitude], {radius:60, color:'rgba(25,135,101,0.8)', fillColor:'rgba(25,135,101,0.18)', weight:2}).addTo(pubMap);
  }, error=>{
    alert('Unable to determine location. Please allow location access.');
    console.warn('Location error:', error);
  }, {enableHighAccuracy:true, timeout:8000, maximumAge:10000});
}

/* ════════════════════════════════════════
   COLUMBARIUM UI
════════════════════════════════════════ */
let selectedCol=-1;

function buildColGrid(){
  const grid=document.getElementById('col-grid');
  if(!grid||grid.children.length>0)return;
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  colData.forEach((col,ci)=>{
    const el=document.createElement('div');
    el.className='columbarium';
    el.id='col-'+ci;
    el.innerHTML=`
      <div class="col-header">Column ${labels[ci % labels.length]}</div>
      <div class="col-slots">
        ${col.slots.map((s,si)=>`
          <div class="col-slot slot-${s.status === 'reserved' ? 'available' : s.status}" onclick="openColModal(${ci},${si})">${s.level}</div>
        `).join('')}
      </div>`;
    grid.appendChild(el);
  });
}

// Add new Columbarium dynamically
function addNewColumbarium() {
  const newId = `COL-${String.fromCharCode(65 + (colData.length % 26))}${Math.floor(colData.length / 26) + 1}`;
  
  // Randomize a small offset for the new map marker
  const latOffset = (Math.random() - 0.5) * 0.002;
  const lngOffset = (Math.random() - 0.5) * 0.002;
  
  const newCol = {
    id: newId,
    loc: [CEMETERY_CENTER[0] + latOffset, CEMETERY_CENTER[1] + lngOffset],
    slots: [
      {level:'T1',status:'available',name:null,dates:null,rel:null,notes:''},
      {level:'T2',status:'available',name:null,dates:null,rel:null,notes:''},
      {level:'T3',status:'available',name:null,dates:null,rel:null,notes:''},
      {level:'T4',status:'available',name:null,dates:null,rel:null,notes:''},
      {level:'T5',status:'available',name:null,dates:null,rel:null,notes:''},
    ]
  };
  
  colData.push(newCol);
  
  const grid = document.getElementById('col-grid');
  if (grid) {
    grid.innerHTML = '';
    buildColGrid();
  }
  
  if (colMap) {
    const index = colData.length - 1;
    const m = L.marker(newCol.loc, {icon: makeColIcon(false)}).addTo(colMap);
    m.bindPopup(`<strong style="color:var(--text-primary)">${newCol.id}</strong><br><span>0/5 occupied</span>`);
    m.on('click', () => selectColumbarium(index));
    colMarkers.push(m);
    colMap.flyTo(newCol.loc, 19, {animate: true, duration: 0.8});
  }
  
  alert(`New Columbarium (${newId}) with 5 available slots has been added!`);
}

function selectColumbarium(ci){
  selectedCol=ci;
  document.querySelectorAll('.columbarium').forEach((el,i)=>el.classList.toggle('selected',i===ci));
  colMarkers.forEach((m,i)=>m.setIcon(makeColIcon(i===ci)));
  if(colMap&&colData[ci])colMap.flyTo(colData[ci].loc,20,{animate:true,duration:.8});
}

function openColModal(ci,si){
  const col=colData[ci], slot=col.slots[si];
  document.getElementById('col-modal-title').textContent=`${col.id} — Level ${slot.level}`;
  const displayStatus = slot.status === 'reserved' ? 'available' : slot.status;
  const statusColors={occupied:'badge-red',available:'badge-green',reserved:'badge-green'}; // treat reserved as available
  document.getElementById('col-modal-body').innerHTML=`
    <div class="detail-row"><div class="detail-label">Status</div><div class="detail-val"><span class="badge ${statusColors[slot.status]}">${displayStatus}</span></div></div>
    <div class="detail-row"><div class="detail-label">Columbarium</div><div class="detail-val">${col.id}</div></div>
    <div class="detail-row"><div class="detail-label">Level</div><div class="detail-val">${slot.level} (${si===0?'Top':si===4?'Bottom':'Middle'} tier)</div></div>
    ${slot.name?`<div class="detail-row"><div class="detail-label">Interred</div><div class="detail-val fw-600 txt-primary">${slot.name}</div></div>`:''}
    ${slot.dates?`<div class="detail-row"><div class="detail-label">Dates</div><div class="detail-val">${slot.dates}</div></div>`:''}
    ${slot.rel?`<div class="detail-row"><div class="detail-label">Family</div><div class="detail-val">${slot.rel}</div></div>`:''}
    <div class="detail-row"><div class="detail-label">Dimensions</div><div class="detail-val">0.5 m × 0.5 m × 0.6 m</div></div>`;
  const btn=document.getElementById('col-modal-action');
  if(slot.status==='available' || slot.status==='reserved'){btn.textContent='Apply for Slot';btn.style.display='';}
  else if(slot.status==='occupied'){btn.textContent='View Certificate';btn.style.display='';}
  else{btn.textContent='View Application';btn.style.display='';}
  document.getElementById('col-modal').classList.add('open');
}
function filterColGrid(){
  const query = this.value.toLowerCase();
  const cols = document.querySelectorAll('.columbarium');
  cols.forEach(col => {
    const slots = col.querySelectorAll('.col-slot');
    let visible = false;
    slots.forEach(slot => {
      const level = slot.textContent.toLowerCase();
      if(level.includes(query)){
        slot.style.display = '';
        visible = true;
      } else {
        slot.style.display = 'none';
      }
    });
    col.style.display = visible ? '' : 'none';
  });
}

/* ════════════════════════════════════════
   APPROVALS & APPLICATIONS UI
════════════════════════════════════════ */
let mockApplications = [
  { id: 'APP-001', type: 'grave', plotId: 'A-005', name: 'Juan Perez', target: 'Sec A Row 2 (A-005)', status: 'pending' },
  { id: 'APP-002', type: 'columbarium', plotId: 'COL-A1', slotIndex: 3, name: 'Liza Soberano', target: 'Columbarium COL-A1 (T4)', status: 'pending' },
  { id: 'APP-003', type: 'columbarium', plotId: 'COL-B1', slotIndex: 2, name: 'Jose Rizal', target: 'Columbarium COL-B1 (T3)', status: 'pending' },
  { id: 'APP-004', type: 'columbarium', plotId: 'COL-B2', slotIndex: 3, name: 'Andres Bonifacio', target: 'Columbarium COL-B2 (T4)', status: 'pending' }
];

function buildApprovalsPanel() {
  const container = document.getElementById('panel-approvals');
  if(!container) return;

  // Show both pending and interview-scheduled applications
  const activeApps = mockApplications.filter(a => a.status === 'pending' || a.status === 'interview');

  // Dynamically update the notification badge in the sidebar
  document.querySelectorAll('.nav-badge').forEach(b => {
    if (b.parentElement.id.includes('approvals')) {
      b.textContent = activeApps.length;
      b.style.display = activeApps.length > 0 ? '' : 'none';
    }
  });

  let html = `
    <div class="scroll-panel">
      <div class="page-hdr">
        <div>
          <div class="page-title">Pending Applications</div>
          <div class="page-sub">Review and approve plot reservations for the cemetery and columbarium.</div>
        </div>
      </div>
      <div class="grid-2">
  `;

  if(activeApps.length === 0) {
    html += `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">✅</div><div class="empty-text">No pending applications at this time.</div></div>`;
  } else {
    activeApps.forEach(app => {
      const badgeText = app.status === 'interview' ? 'Interview Scheduled' : 'Pending';
      html += `
        <div class="app-card" id="app-${app.id}">
          <div class="app-card-top">
            <div class="app-card-name">${app.name}</div>
            <div class="badge badge-amber">${badgeText}</div>
          </div>
          <div class="app-card-meta" style="margin-bottom:6px">ID: <strong>${app.id}</strong></div>
          <div class="app-card-meta">Target: <strong>${app.target}</strong></div>
          ${app.interviewDate ? `<div class="app-card-meta" style="color:#198765;margin-bottom:6px">Date: <strong>${app.interviewDate}</strong></div>` : ''}
          <div class="app-card-actions">
            <button class="btn btn-primary btn-sm" onclick="approveApp('${app.id}')">Approve</button>
            <button class="btn btn-outline btn-sm" style="border:1px solid #d1d5db;background:transparent" onclick="scheduleInterviewApp('${app.id}')">Interview</button>
            <button class="btn btn-ghost btn-sm" onclick="disapproveApp('${app.id}')">Disapprove</button>
          </div>
        </div>
      `;
    });
  }
  html += `</div></div>`;
  container.innerHTML = html;
}

function approveApp(appId) {
  const app = mockApplications.find(a => a.id === appId);
  if(!app) return;

  // 1. Update app status
  app.status = 'approved';

  // 2. Update System Data globally
  if(app.type === 'grave') {
    const grave = graveData.find(g => g.id === app.plotId);
    if(grave) {
      grave.status = 'occupied';
      grave.name = app.name;
      grave.dates = new Date().getFullYear().toString();
    }
  } else if(app.type === 'columbarium') {
    const col = colData.find(c => c.id === app.plotId);
    if(col && col.slots[app.slotIndex]) {
      col.slots[app.slotIndex].status = 'occupied';
      col.slots[app.slotIndex].name = app.name;
      col.slots[app.slotIndex].dates = new Date().getFullYear().toString();
      col.slots[app.slotIndex].rel = 'Approved Applicant';
    }
  }

  // 3. Re-render UI Components
  buildApprovalsPanel();
  
  const grid = document.getElementById('col-grid');
  if (grid) {
    grid.innerHTML = '';
    buildColGrid();
  }

  // 4. Update Maps System-wide
  const reloadMapMarkers = (map, markersArr, data, iconFunc, isCol=false) => {
    if(!map) return markersArr;
    markersArr.forEach(m => m.remove());
    let newArr = [];
    data.forEach((d, i) => {
      if (!isCol && d.status === 'available') return; // Huwag isama ang 'available' sa grave maps
      const loc = isCol ? d.loc : d.latlng;
      const m = L.marker(loc, {icon: iconFunc(isCol ? (selectedCol === i) : d.status)}).addTo(map);
      if (isCol) {
        const occ = d.slots.filter(s => s.status === 'occupied').length;
        m.bindPopup(`<strong style="color:var(--text-primary)">${d.id}</strong><br><span>${occ}/5 occupied</span>`);
        m.on('click', () => selectColumbarium(i));
      } else {
        m.on('click', () => showGravePanel(d));
      }
      newArr.push(m);
    });
    return newArr;
  };

  adminMarkers = reloadMapMarkers(adminMap, adminMarkers, graveData, makeIcon);
  // pubMarkers = reloadMapMarkers(pubMap, pubMarkers, graveData, makeIcon);
  colMarkers = reloadMapMarkers(colMap, colMarkers, colData, makeColIcon, true);

  alert(`✅ Application ${appId} approved! The map and records have been updated globally.`);
}

function scheduleInterviewApp(appId) {
  const app = mockApplications.find(a => a.id === appId);
  if(!app) return;
  
  const date = prompt("Enter interview date and time (e.g., 'Oct 15, 2024 at 10:00 AM'):", "Tomorrow at 10:00 AM");
  if(date) {
    app.status = 'interview';
    app.interviewDate = date;
    buildApprovalsPanel();
    alert(`📅 Interview scheduled for ${app.name} on ${date}.`);
  }
}

function disapproveApp(appId) {
  const app = mockApplications.find(a => a.id === appId);
  if(!app) return;
  app.status = 'disapproved';
  
  if(app.type === 'grave') {
    const grave = graveData.find(g => g.id === app.plotId);
    if(grave && grave.status === 'reserved') grave.status = 'available';
  } else if(app.type === 'columbarium') {
    const col = colData.find(c => c.id === app.plotId);
    if(col && col.slots[app.slotIndex] && col.slots[app.slotIndex].status === 'reserved') {
      col.slots[app.slotIndex].status = 'available';
    }
  }
  
  buildApprovalsPanel();
  
  // Instantly force rebuild of Columbarium grids
  const grid = document.getElementById('col-grid');
  if (grid) {
    grid.innerHTML = '';
    buildColGrid();
  }

  // Instantly push updates to all Maps across the system
  const reloadMapMarkers = (map, markersArr, data, iconFunc, isCol=false) => {
    if(!map) return markersArr;
    markersArr.forEach(m => m.remove());
    let newArr = [];
    data.forEach((d, i) => {
      if (!isCol && d.status === 'available') return; // Huwag isama ang 'available' sa grave maps
      const loc = isCol ? d.loc : d.latlng;
      const m = L.marker(loc, {icon: iconFunc(isCol ? (selectedCol === i) : d.status)}).addTo(map);
      if (isCol) {
        const occ = d.slots.filter(s => s.status === 'occupied').length;
        m.bindPopup(`<strong style="color:var(--text-primary)">${d.id}</strong><br><span>${occ}/5 occupied</span>`);
        m.on('click', () => selectColumbarium(i));
      } else {
        m.on('click', () => showGravePanel(d));
      }
      newArr.push(m);
    });
    return newArr;
  };

  adminMarkers = reloadMapMarkers(adminMap, adminMarkers, graveData, makeIcon);
  // pubMarkers = reloadMapMarkers(pubMap, pubMarkers, graveData, makeIcon);
  colMarkers = reloadMapMarkers(colMap, colMarkers, colData, makeColIcon, true);

  alert(`❌ Application ${appId} disapproved. Plot returned to available on all maps.`);
}

/* ════════════════════════════════════════
   GRAVE PANEL (public)
════════════════════════════════════════ */
function showGravePanel(g){
  document.getElementById('gp-id').textContent='Grave '+g.id;
  document.getElementById('gp-name').textContent=g.name;
  document.getElementById('gp-dates').textContent=g.dates;
  document.getElementById('gp-loc').textContent=g.loc;
  const statusBadge={available:'badge-green',occupied:'badge-red',reserved:'badge-amber'};
  document.getElementById('gp-status').innerHTML=`<span class="badge ${statusBadge[g.status]}">${g.status}</span>`;
  const actions=document.getElementById('gp-actions');
  if(g.status==='available')actions.innerHTML=`<button class="btn btn-primary btn-sm">Apply for Plot</button><button class="btn btn-ghost btn-sm" onclick="closeGravePanel()">Close</button>`;
  else actions.innerHTML=`<button class="btn btn-primary btn-sm" onclick="pubMap&&pubMap.flyTo([${g.latlng}],20)">Navigate</button><button class="btn btn-ghost btn-sm" onclick="closeGravePanel()">Close</button>`;
  document.getElementById('grave-panel').classList.add('show');
}
function closeGravePanel(){document.getElementById('grave-panel').classList.remove('show');}

/* ════════════════════════════════════════
   BAR CHART
════════════════════════════════════════ */
function buildBurialChart(){
  const el=document.getElementById('burial-chart');
  if(!el||el.children.length>0)return;
  const vals=[3,4,5,3,2,4,6,4,3,2,2,0];
  const max=Math.max(...vals, 1); // Ensure max is at least 1 to avoid division by zero
  vals.forEach(v=>{
    const col=document.createElement('div');
    col.className='bar-col';
    const bar=document.createElement('div');
    bar.className='bar';
    bar.style.height='0px';
    bar.title=v+' burials';
    col.appendChild(bar);
    el.appendChild(col);
    setTimeout(()=>{bar.style.height=Math.round((v/max)*90)+'px';},200);
  });
}

function buildCapBars(){
  const el=document.getElementById('cap-bars');
  if(!el||el.children.length>0)return;
  const sections=[
    {name:'Section A',pct:92,color:'var(--red)'},
    {name:'Section B',pct:78,color:'var(--amber)'},
    {name:'Section C',pct:34,color:'var(--emerald)'},
    {name:'Section D',pct:65,color:'var(--amber)'},
    {name:'Section E',pct:28,color:'var(--emerald)'},
    {name:'Section F',pct:55,color:'var(--amber)'},
  ];
  sections.forEach(s=>{
    el.innerHTML+=`
      <div class="capacity-bar-wrap">
        <div class="cap-label"><span class="cap-name">${s.name}</span><span class="cap-pct">${s.pct}%</span></div>
        <div class="cap-track"><div class="cap-fill" style="width:0%;background:${s.color}" data-pct="${s.pct}"></div></div>
      </div>`;
  });
  setTimeout(()=>{
    el.querySelectorAll('.cap-fill').forEach(f=>{f.style.width=f.dataset.pct+'%';});
  },300);
}

/* ════════════════════════════════════════
   PUBLIC SIDEBAR
════════════════════════════════════════ */
function togglePubSidebar(){
  const landingSidebar = document.getElementById('landing-sidebar');
  const pubSidebar = document.getElementById('pub-sidebar');
  const topbarHamburger = document.querySelector('.landing-topbar .hamburger-fab');
  const topbarSearch = document.querySelector('.landing-topbar .search-container');
  const mapHamburger = document.getElementById('public-hamburger');
  const userSearch = document.getElementById('public-user-search');

  if(currentRole === 'user'){
    if(pubSidebar){
      pubSidebar.classList.toggle('open');
      const isOpen = pubSidebar.classList.contains('open');
      if(mapHamburger) mapHamburger.classList.toggle('hidden', isOpen);
      if(userSearch) userSearch.classList.toggle('hidden', isOpen);
    }
    if(landingSidebar) landingSidebar.classList.remove('open');
  } else {
    if(landingSidebar) {
      landingSidebar.classList.toggle('open');
      const isOpen = landingSidebar.classList.contains('open');
      if(topbarHamburger) topbarHamburger.classList.toggle('hidden', isOpen);
      if(topbarSearch) topbarSearch.classList.toggle('hidden', isOpen);
    }
    if(pubSidebar) pubSidebar.classList.remove('open');
  }
}
function switchPubPanel(panel){
  alert('Navigating to: '+panel.charAt(0).toUpperCase()+panel.slice(1));
  togglePubSidebar();
}

/* ════════════════════════════════════════
   AUTH TOGGLE
════════════════════════════════════════ */
function updateAuthBackButton(){
  const backBtn = document.getElementById('auth-back-btn');
  const registerForm = document.getElementById('auth-register-form');
  if(!backBtn || !registerForm) return;
  if(registerForm.style.display === 'none'){
    backBtn.style.display = 'block';
    backBtn.textContent = '← Back';
    backBtn.onclick = showLanding;
  } else {
    backBtn.style.display = 'none';
  }
}

function toggleRegister(){
  const l=document.getElementById('auth-login-form');
  const r=document.getElementById('auth-register-form');
  if(!l || !r) return;
  if(l.style.display==='none'){
    l.style.display='';
    r.style.display='none';
  } else {
    l.style.display='none';
    r.style.display='';
  }
  updateAuthBackButton();
}

function showAuth(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const auth = document.getElementById('screen-auth');
  if(auth) auth.classList.add('active');
  updateAuthBackButton();

  if (window.parent && window.parent !== window) {
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    window.parent.postMessage({ action: 'navigate', data: { page: 'auth' } }, targetOrigin);
  }
}

function showLanding(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const pub = document.getElementById('screen-public');
  if(pub) pub.classList.add('active');
  if(!mapsInit.pub) initPubMap();
  setTimeout(()=>{if(pubMap) pubMap.invalidateSize();},100);
  updatePublicUI();

  if (window.parent && window.parent !== window) {
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    window.parent.postMessage({ action: 'navigate', data: { page: 'public' } }, targetOrigin);
  }
}

// Initialize landing page map
window.addEventListener('load', () => {
  const publicScreen = document.getElementById('screen-public');
  if (publicScreen && publicScreen.classList.contains('active')) {
    if (!mapsInit.pub) initPubMap();
    if (pubMap) pubMap.invalidateSize();
    updatePublicUI();
  }
});

// Listen for messages from parent frame
window.addEventListener('message', function(event) {
  if (window.location.protocol !== 'file:' && event.origin !== window.location.origin) return;
  const { action, data } = event.data;
  if (action === 'page-loaded') {
    setTimeout(initPubMap, 200);
  }
});

/* ════════════════════════════════════════
   AUTH / ROUTING
════════════════════════════════ */
function loginAs(role){
  currentRole=role;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if(role==='user'){
    document.getElementById('screen-public').classList.add('active');
    if(!mapsInit.pub) initPubMap();
    updatePublicUI();
  } else {
    document.getElementById('screen-app').classList.add('active');
    setupAppShell(role);
  }
  setTimeout(()=>{const s=document.getElementById('pwa-snack');if(s)s.style.display='flex';},3000);
}

function validateAndLogin(arg){
  if(typeof arg === 'string'){
    loginAs(arg);
    return; // Added return to prevent falling through
  }
  if(arg && typeof arg.preventDefault === 'function') arg.preventDefault();
  loginAs('user');
}

function logout(){
  currentRole='';
  [pubMap,adminMap,planningMap].forEach(m=>{if(m)m.remove();});
  pubMap=adminMap=planningMap=null;
  Object.keys(mapsInit).forEach(k=>mapsInit[k]=false);
  pubMarkers=[];adminMarkers=[];
  const sidebar=document.getElementById('pub-sidebar');
  if(sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
  updatePublicUI();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-auth').classList.add('active');
}

function updatePublicUI(){
  const topbar = document.querySelector('.landing-topbar');
  const topbarHamburger = document.querySelector('.landing-topbar .hamburger-fab');
  const mapHamburger = document.getElementById('public-hamburger');
  const landingSidebar = document.getElementById('landing-sidebar');
  const pubSidebar = document.getElementById('pub-sidebar');
  const userSearch = document.getElementById('public-user-search');
  const userLegend = document.getElementById('public-user-legend');
  const userFilters = document.getElementById('public-user-filters');
  const loginBtn = document.getElementById('landing-login-btn');
  const logoutBtn = document.getElementById('landing-logout-btn');
  const welcome = document.getElementById('landing-welcome');
  const floatingControls = document.querySelector('.floating-controls');

  if(currentRole === 'user'){
    // Hide landing topbar
    if(topbar) topbar.style.display = 'none';
    // Show user fabs and map hamburger
    if(mapHamburger){
      mapHamburger.style.display = 'flex';
      const isPubOpen = pubSidebar && pubSidebar.classList.contains('open');
      mapHamburger.classList.toggle('hidden', isPubOpen);
    }
    if(userSearch){
      userSearch.style.display = 'flex';
      const isPubOpen = pubSidebar && pubSidebar.classList.contains('open');
      userSearch.classList.toggle('hidden', isPubOpen);
    }
    if(userLegend) userLegend.style.display = 'flex';
    if(userFilters) userFilters.style.display = 'flex';
    if(landingSidebar) landingSidebar.classList.remove('open');
    // Show floating controls
    if(floatingControls) floatingControls.style.display = 'flex';
    // Update buttons
    if(loginBtn) loginBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = 'block';
    if(welcome) welcome.style.display = 'block';
  } else {
    // Show landing topbar and hide map hamburger
    if(topbar) topbar.style.display = 'flex';
    if(mapHamburger) mapHamburger.style.display = 'none';
    if(topbarHamburger) {
      const isLandingOpen = landingSidebar && landingSidebar.classList.contains('open');
      topbarHamburger.classList.toggle('hidden', isLandingOpen);
    }
    const topbarSearch = document.querySelector('.landing-topbar .search-container');
    if(topbarSearch) {
      const isLandingOpen = landingSidebar && landingSidebar.classList.contains('open');
      topbarSearch.classList.toggle('hidden', isLandingOpen);
    }
    // Hide user fabs
    if(userSearch) userSearch.style.display = 'none';
    if(userLegend) userLegend.style.display = 'none';
    if(userFilters) userFilters.style.display = 'none';
    if(pubSidebar) pubSidebar.classList.remove('open');
    // Hide floating controls
    if(floatingControls) floatingControls.style.display = 'none';
    // Update buttons
    if(loginBtn) loginBtn.style.display = 'block';
    if(logoutBtn) logoutBtn.style.display = 'none';
    if(welcome) welcome.style.display = 'none';
  }
}

function setupAppShell(role){
  const info=roleInfo[role];
  document.getElementById('rb-chip').textContent=info.badge;
  document.getElementById('rb-chip').className='role-badge '+info.rb;
  document.getElementById('topbar-avatar').textContent=info.av;
  document.getElementById('sb-avatar').textContent=info.av;
  document.getElementById('sb-name').textContent=info.name;
  document.getElementById('sb-role').textContent=info.role;
  buildAppNav(role);
  const first=navConfigs[role][0];
  activateAppPanel(first.id,first.panel);
}

function buildAppNav(role){
  const nav=document.getElementById('app-sidebar-nav');
  nav.innerHTML='';
  navConfigs[role].forEach((item,i)=>{
    const el=document.createElement('div');
    el.className='nav-item'+(i===0?' active':'');
    el.id='anav-'+item.id;
    el.innerHTML=`<span class="nav-ico">${item.ico}</span><span class="nav-txt">${item.label}</span>${item.badge?`<span class="nav-badge">${item.badge}</span>`:''}`;
    el.onclick=()=>activateAppPanel(item.id,item.panel);
    nav.appendChild(el);
  });
}

function activateAppPanel(navId,panelId){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const nav=document.getElementById('anav-'+navId);
  if(nav)nav.classList.add('active');
  document.querySelectorAll('#main-panels .panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById(panelId);
  if(panel)panel.classList.add('active');
  // Lazy init maps/components
  setTimeout(()=>{
    if(panelId==='panel-admin-map')initAdminMap();
    if(panelId==='panel-columbarium'){buildColGrid(); document.getElementById('col-search').addEventListener('input', filterColGrid);}
    if(panelId==='panel-planning')initPlanningMap();
    if(panelId==='panel-mayor-dash'){buildBurialChart();}
      if(panelId==='panel-approvals'){buildApprovalsPanel();}
    buildCapBars();
    // Force Leaflet resize
    [adminMap,planningMap].forEach(m=>{if(m)m.invalidateSize();});
  },120);
}

// Toggle filters on search click
document.addEventListener('DOMContentLoaded', function() {
  // Public map search
  const pubSearchInput = document.getElementById('pub-search-input');
  const pubDropdown = document.getElementById('search-dropdown');
  if (pubSearchInput && pubDropdown) {
    pubSearchInput.addEventListener('click', function() {
      pubDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function(e) {
      if (!pubSearchInput.contains(e.target) && !pubDropdown.contains(e.target)) {
        pubDropdown.classList.add('hidden');
      }
    });
  }

  // Landing search
  const landingSearchInput = document.getElementById('landing-search');
  const landingDropdown = document.getElementById('landing-search-dropdown');
  if (landingSearchInput && landingDropdown) {
    landingSearchInput.addEventListener('click', function() {
      landingDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function(e) {
      if (!landingSearchInput.contains(e.target) && !landingDropdown.contains(e.target)) {
        landingDropdown.classList.add('hidden');
      }
    });
  }
});

/* ════════════════════════════════════════
   GLOBAL EXPORTS (For Vite/React Compatibility)
   Since Vite bundles files as ES modules, inline HTML 
   'onclick' events cannot see these functions unless 
   we explicitly attach them to the global window object.
════════════════════════════════════════ */
Object.assign(window, {
  approveApp,
  scheduleInterviewApp,
  disapproveApp,
  openColModal,
  addNewColumbarium,
  selectColumbarium,
  showGravePanel,
  closeGravePanel,
  switchPubPanel,
  toggleRegister,
  showAuth,
  showLanding,
  validateAndLogin,
  logout,
  locateUser,
  pubMapZoom
});
