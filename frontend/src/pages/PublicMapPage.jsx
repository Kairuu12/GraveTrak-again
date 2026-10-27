import UserSettings from '../components/UserSettings.jsx';
import { fetchNotifications, markNotificationRead } from '../api.js';
import './UserDashboardVisuals.css';
import graveTrakLogo from '../assets/gravetrak-logo.svg';
import { siteData } from '../data/cemeteryLayout.js';
import { connectNearbyNodes } from '../utils/routeGraph.js';
import { requestRoutePosition, routeLocationErrorMessage } from '../utils/routeLocation.js';
import { createRouteCamera } from '../utils/routeCamera.js';
import useCemeteryTransition from '../hooks/useCemeteryTransition.js';
import './PublicMapMobile.css';
import './PublicMapLayout.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { CEMETERY_CENTER, roleInfo } from '../data/data.js';
import { disposeLeafletMap, sanitizeLatLng, useLeafletMap } from '../hooks/useLeafletMap.jsx';
import Sidebar from '../components/Sidebar.jsx';
import GravePanel from '../components/GravePanel.jsx';
import MyLovedOnes from '../components/MyLovedOnes.jsx';
import useSavedGraves from '../hooks/useSavedGraves.js';
import BurialApplicationForm from '../components/BurialApplicationForm.jsx';
import { fetchGraves, updateGrave, createGrave, fetchBurialApplications, fetchColumbariums, replaceBurialDocuments, fetchCemeterySections, fetchCemeteryPathways, fetchBurialPlots } from '../api.js';
import anotherMapData from '../../anothermap.json';
import { buildSavedSectionPlotFeatures } from '../utils/savedSectionLayout.js';
import { closeBoundaryFeatures, buildPathwayJoinFeatures } from '../utils/mapGeometry.js';

const ANOTHER_CEMETERY_CENTER = [13.931237218126718, 121.62076352291137];
const OLD_CEMETERY_ENTRANCE = [13.939330, 121.619764];
// First endpoint of the New Cemetery's main north-south pathway.
const NEW_CEMETERY_ENTRANCE = [13.932708, 121.621159];
const PUBLIC_GRAVE_PLOT_FILL = '#104ec2';
const PUBLIC_GRAVE_PLOT_BORDER = '#ffffff';
const PUBLIC_GRAVE_PLOT_FILL_OPACITY = 0.9;
const PUBLIC_GRAVE_PLOT_HOVER_OPACITY = 1;
const PUBLIC_GRAVE_PLOT_BORDER_WEIGHT = 1;
const PUBLIC_GRAVE_PLOT_STYLE = {
  fillColor: PUBLIC_GRAVE_PLOT_FILL,
  fillOpacity: PUBLIC_GRAVE_PLOT_FILL_OPACITY,
  color: PUBLIC_GRAVE_PLOT_BORDER,
  opacity: 1,
  weight: PUBLIC_GRAVE_PLOT_BORDER_WEIGHT,
  smoothFactor: 0,
  lineCap: 'round',
  lineJoin: 'round',
};
const PUBLIC_PATHWAY_OUTER_STYLE = Object.freeze({
  color: '#a8a29e',
  weight: 6,
  opacity: 0.9,
  lineCap: 'round',
  lineJoin: 'round',
});
const PUBLIC_PATHWAY_INNER_STYLE = Object.freeze({
  color: '#ede8df',
  weight: 3,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
});

const defaultPublicFilters = [
  { label: 'All Sections', active: true },
  { label: 'Sec A', active: false },
  { label: 'Sec B', active: false },
  { label: 'Sec C', active: false },
];



function getSectionColor(id) {
  return PUBLIC_GRAVE_PLOT_FILL;
}

function normalizeSectionName(section) {
  if (!section) return '';
  let text = String(section).trim();
  text = text.replace(/^Section\s+(?=Expansion Area)/i, '');
  text = text.replace(/^Expansion Area/i, 'Section');
  if (text.length === 1 && /[A-Za-z]/.test(text)) return `Section ${text.toUpperCase()}`;
  const upper = text.replace(/^(sec(?:tion)?\s*)/i, 'Section ');
  const match = upper.match(/Section\s*([A-Za-z])/i);
  if (match) return `Section ${match[1].toUpperCase()}`;
  return upper;
}

function getMapType(section) {
  if (!section) return 'old';
  const s = String(section).toLowerCase();
  if (s.includes('new section') || s.includes('expansion') || s === 'section n' || s === 'section o') return 'new';
  return 'old';
}

const processSlots = (slots) => slots.map(s => ({
  ...s,
  cemeteryMap: s.cemeteryMap || s.cemetery_map || getMapType(s.section)
}));

const isAbortError = (err) => err?.name === 'AbortError';

const pathwaysGeoJson = { 
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203097766633, 13.93899233350628 ], [ 121.6203584928815, 13.93866505589906 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203589624657, 13.93866570137616 ], [ 121.6202633991534, 13.9386157604762 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6202636336396, 13.93861599133661 ], [ 121.6207691259841, 13.93768972950759 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6207696626524, 13.93768844156369 ], [ 121.6210990304713, 13.93785539984345 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6210988777536, 13.93785570890425 ], [ 121.6205429698922, 13.9388352505232 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203102036869, 13.93899271768179 ], [ 121.620542510091, 13.93883577310531 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6205693025217, 13.93878730958559 ], [ 121.6203585210953, 13.9386656315023 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6206169233314, 13.93870519321376 ], [ 121.6203040047124, 13.93854128185203 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203401274686, 13.9384832545099 ], [ 121.620645619438, 13.93864156157817 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203699208617, 13.93841603949021 ], [ 121.6206882841611, 13.93857896318904 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6204089369007, 13.93835273026727 ], [ 121.6207266606266, 13.93851093509283 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6204447661765, 13.93828480202759 ], [ 121.620765687285, 13.93844332484876 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6207986009202, 13.93838313067971 ], [ 121.6204845516553, 13.93821377737424 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6208361631577, 13.93831639836455 ], [ 121.6205207165578, 13.93814063083429 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6208719831922, 13.93825444009267 ], [ 121.6205554134991, 13.93808348036579 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6209115950159, 13.93818775444382 ], [ 121.6205857579615, 13.93801831042932 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6209447733714, 13.93812333800867 ], [ 121.6206199135002, 13.93795400783719 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6209809616032, 13.93806441225721 ], [ 121.6206536863501, 13.93788730897051 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6210206418197, 13.93799310174213 ], [ 121.6206948283482, 13.93782388134606 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6210545088034, 13.93793320622179 ], [ 121.6207310628712, 13.93776074103812 ] ] } },
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [ [ 121.6203102062417, 13.93899248769833 ], [ 121.6197641462361, 13.93933006880536 ] ] } }
  ]
};

const gravePlotsCache = {};

function generateGravePlots(sectionPolygon, sectionId, rows = 42, cemeteryMap = 'old') {
    const cacheKey = `${sectionId}-${rows}-${cemeteryMap}`;
    if (gravePlotsCache[cacheKey]) return gravePlotsCache[cacheKey];
    if (typeof window.turf === 'undefined') return { type: "FeatureCollection", features: [] };
    const turf = window.turf;
    const coords = sectionPolygon.coordinates[0];
    
    const get2D = (c) => [c[0], c[1]];
    const p0 = get2D(coords[0]); 
    const p1 = get2D(coords[1]); 
    const p2 = get2D(coords[2]); 
    const p3 = get2D(coords[3]); 
    
    const rightEdge = turf.lineString([p0, p1]);
    const leftEdge = turf.lineString([p3, p2]);

    const leftLength = turf.length(leftEdge, {units: 'meters'});
    const rightLength = turf.length(rightEdge, {units: 'meters'});
    
    const leftStep = leftLength / rows;
    const rightStep = rightLength / rows;
    
    const leftPts = [];
    const rightPts = [];
    const centerPts = [];
    
    for (let i = 0; i <= rows; i++) {
        const lPt = turf.along(leftEdge, i * leftStep, {units: 'meters'}).geometry.coordinates;
        const rPt = turf.along(rightEdge, i * rightStep, {units: 'meters'}).geometry.coordinates;
        leftPts.push(lPt);
        rightPts.push(rPt);
        const cPt = turf.midpoint(turf.point(lPt), turf.point(rPt)).geometry.coordinates;
        centerPts.push(cPt);
    }
    
    const gravePlots = [];
    for (let i = 0; i < rows; i++) {
        const leftPlotGeom = turf.polygon([[leftPts[i], leftPts[i+1], centerPts[i+1], centerPts[i], leftPts[i]]]);
        const rightPlotGeom = turf.polygon([[centerPts[i], centerPts[i+1], rightPts[i+1], rightPts[i], centerPts[i]]]);

        const leftCenter = turf.centerOfMass(leftPlotGeom).geometry.coordinates;
        const rightCenter = turf.centerOfMass(rightPlotGeom).geometry.coordinates;

        const leftPlot = turf.polygon([[leftPts[i], leftPts[i+1], centerPts[i+1], centerPts[i], leftPts[i]]], { // Changed name format
            "plotNumber": i + 1, "side": "Front", "name": `Section ${sectionId}-C${i + 1}`, "section": sectionId, "row": 1, "column": i + 1, "frontCoord": [leftCenter[1], leftCenter[0]], "cemeteryMap": cemeteryMap
        });
        const rightPlot = turf.polygon([[centerPts[i], centerPts[i+1], rightPts[i+1], rightPts[i], centerPts[i]]], { // Changed name format
            "plotNumber": i + 1, "side": "Back", "name": `Section ${sectionId}-C${i + (rows + 1)}`, "section": sectionId, "row": 2, "column": i + 1, "frontCoord": [rightCenter[1], rightCenter[0]], "cemeteryMap": cemeteryMap
        });
        gravePlots.push(leftPlot);
        gravePlots.push(rightPlot);
    }

    const result = { "type": "FeatureCollection", "features": gravePlots };
    gravePlotsCache[cacheKey] = result;
    return result;
}

const sectionFeatures = siteData.features.filter((feature) => feature.properties.id);

export default function PublicMapPage({ active, role, userInfo, account, onAccountUpdate, appearance, signedIn = false, onShowOfficeDashboard, onShowAuth, onLogout, selectedGrave, onSelectGrave, theme, onToggleTheme, onShowLanding, openApplication = false, initialCemetery = 'old', initialSearch = '' }) {
  const savedGraves = useSavedGraves(active && role === 'user');
  const [landingOpen, setLandingOpen] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [landingSearchOpen, setLandingSearchOpen] = useState(() => Boolean(initialSearch?.trim()));
  const [pubSearchOpen, setPubSearchOpen] = useState(() => Boolean(initialSearch?.trim()));
  const [pubSearchQuery, setPubSearchQuery] = useState(initialSearch || '');
  useEffect(() => {
    if (initialSearch) {
      setPubSearchQuery(initialSearch);
      setPubSearchOpen(true);
      setLandingSearchOpen(true);
    }
  }, [initialSearch]);
  const [recentSearches, setRecentSearches] = useState(() => JSON.parse(localStorage.getItem('gravetrak_recent_searches') || '[]'));
  const [activePanel, setActivePanel] = useState(null);
  const [trackingPage, setTrackingPage] = useState(1);
  const trackingListRef = useRef(null);
  useEffect(() => { setTrackingPage(1); }, [activePanel, account?.id]);
  useEffect(() => {
    if (active) setActivePanel(openApplication && role === 'user' ? 'panel-burial-application' : null);
  }, [active, openApplication, role]);
  const [pubFilters, setPubFilters] = useState(defaultPublicFilters);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [graveData, setGraveData] = useState([]);
  const [savedCemeterySections, setSavedCemeterySections] = useState([]);
  const [savedBurialPlots, setSavedBurialPlots] = useState([]);
  const [savedCemeteryPathways, setSavedCemeteryPathways] = useState([]);
  const [isGraveDataLoading, setIsGraveDataLoading] = useState(true);
  const [isColumbariumLoading, setIsColumbariumLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCemeteryGeoJson] = useState(anotherMapData);
  const mapContainerRef = useRef(null);
  const isMountedRef = useRef(false);
  const passiveTimeoutsRef = useRef([]);
  const routeLayerRef = useRef(null);
  const routeAnimationFrameRef = useRef(null);
  const [mapIsReady, setMapIsReady] = useState(false);
  const [floorDetailsContext, setFloorDetailsContext] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeOrigin, setRouteOrigin] = useState('Finding location...');
  const [routeDestination, setRouteDestination] = useState(null);
  const [routeDestSearch, setRouteDestSearch] = useState('');
  const navigationWatchId = useRef(null);
  const userMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const orientationHandlerRef = useRef(null);
  const routeAbortControllerRef = useRef(null);
  const [navStats, setNavStats] = useState(null);
  const routeCameraRef = useRef(null);
  const navigationStartViewRef = useRef(null);
  const [routeCameraState, setRouteCameraState] = useState({ mode: 'idle', ready: false, hasLocation: false });
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  useEffect(() => {
    setNotifications([]);
    setNotificationError('');
    if (!active || !signedIn) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const result = await fetchNotifications({ signal: controller.signal });
        if (!controller.signal.aborted) {
          setNotifications(Array.isArray(result) ? result : result.results || []);
          setNotificationError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotificationError('Unable to load notifications. Reopen to retry.');
      }
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, signedIn, userInfo?.id, notifOpen]);

  const [profileOpen, setProfileOpen] = useState(false);
  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const currentUserInfo = userInfo || roleInfo[role] || roleInfo.user;
  const currentUserName = currentUserInfo.name || [currentUserInfo.first_name, currentUserInfo.last_name].filter(Boolean).join(' ') || '';
  const authStatus = `${active ? 'active' : 'inactive'}:${role || 'public'}:${userInfo?.id || userInfo?.email || currentUserName || 'anonymous'}`;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      passiveTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      passiveTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.all([fetchCemeterySections(), fetchCemeteryPathways(), fetchBurialPlots()])
      .then(([data, pathwayData, plotRows]) => {
        if (cancelled) return;
        const features = Array.isArray(data?.features) ? data.features : [];
        setSavedCemeterySections(features);
        setSavedCemeteryPathways((Array.isArray(pathwayData?.features) ? pathwayData.features : []).filter(feature => feature.properties?.is_active !== false));
        setSavedBurialPlots(Array.isArray(plotRows) ? plotRows : []);
      })
      .catch(err => console.error('Unable to load CPDO sections on the public map:', err));
    return () => { cancelled = true; };
  }, [active]);

  const addToRecentSearches = useCallback((res) => {
    if (!res) return;
    const displayText = (res.status === 'occupied' && res.name && res.name !== '— Available —') ? res.name : (res.grave_id || res.id);
    
    let safeLatlng = null;
    if (res.latlng && Array.isArray(res.latlng)) { safeLatlng = [res.latlng[0], res.latlng[1]]; }
    else if (res.latlng && typeof res.latlng === 'object' && res.latlng.lat !== undefined) { safeLatlng = [res.latlng.lat, res.latlng.lng]; }

    const safeItem = { 
      text: displayText, 
      id: res.grave_id || res.id,
      grave_id: res.grave_id || res.id,
      name: res.name,
      status: res.status,
      latitude: res.latitude,
      longitude: res.longitude,
      latlng: safeLatlng,
      location: res.location,
      _isCol: res._isCol || false
    };

    setRecentSearches(prev => {
      const filtered = prev.filter(item => item.id !== safeItem.id);
      const updated = [safeItem, ...filtered].slice(0, 5);
      localStorage.setItem('gravetrak_recent_searches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeRecentSearch = useCallback((e, idToRemove) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(item => item.id !== idToRemove);
      localStorage.setItem('gravetrak_recent_searches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const [columbariumSlots, setColumbariumSlots] = useState([]);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fully Working Search Bar Logic
  const searchResults = useMemo(() => {
    if (!pubSearchQuery.trim()) return [];
    const query = pubSearchQuery.toLowerCase();

    const getFallbackCoords = (item) => {
      let sectionId = null;
      if (item.section) {
        sectionId = item.section.replace('Section ', '');
      } else if (item.location && item.location.includes('Sec ')) {
        const match = item.location.match(/Sec ([A-Z])/);
        if (match) sectionId = match[1];
      }

      // Extract plot number if available from grave_id or id
      // Assuming grave_id/id format like "Section A-C1" or "A-001"
      let plotNumberMatch = (item.grave_id || item.id || '').match(/C(\d+)/);
      let plotNumber = null;
      if (plotNumberMatch) {
        plotNumber = parseInt(plotNumberMatch[1], 10);
      } else {
        // Try to match "A-001" format, assuming it's a simple grave ID
        const legacyPlotMatch = (item.grave_id || item.id || '').match(/([A-Z])-(\d+)/);
        if (legacyPlotMatch) {
          sectionId = legacyPlotMatch[1]; // Update sectionId from legacy format
          // For legacy plots, we might not have a precise plotNumber for generateGravePlots
          // We'll rely on the section centroid or the original latlng if available
        }
      }

      if (sectionId) {
        const feature = siteData.features.find(f => f.properties.id === sectionId);
        if (feature && feature.geometry.type === 'Polygon') {
          // If it's a specific grave plot generated by generateGravePlots, try to get its frontCoord
          // Assuming 42 rows for old map sections, and 'old' cemeteryMap context
          if (plotNumber !== null && typeof window.turf !== 'undefined') {
            const plots = generateGravePlots(feature.geometry, sectionId, 42, 'old').features;
            const targetName = `Section ${sectionId}-C${plotNumber}`;
            const targetPlot = plots.find(p => p.properties.name === targetName);
            if (targetPlot && targetPlot.properties.frontCoord) {
              return targetPlot.properties.frontCoord; // Return the precise frontCoord
            }
          }

          // Fallback to centroid of the section if specific plot not found or not a generated plot
          const coords = feature.geometry.coordinates[0];
          if (coords && coords.length > 0) {
            let latSum = 0, lngSum = 0;
            coords.forEach(c => { latSum += c[1]; lngSum += c[0]; });
            return [latSum / coords.length, lngSum / coords.length];
          }
        }
      }
      // If sectionId is not found or not a polygon feature, return CEMETERY_CENTER
      return CEMETERY_CENTER;
    };

    const allDataForSearch = [
        ...graveData.map(g => ({...g, latlng: g.latlng || (g.latitude && g.longitude ? [parseFloat(g.latitude), parseFloat(g.longitude)] : getFallbackCoords(g))})),
        ...columbariumSlots.map(s => ({...s, _isCol: true, latlng: s.latlng || s.loc || (s.latitude && s.longitude ? [parseFloat(s.latitude), parseFloat(s.longitude)] : getFallbackCoords(s))}))
    ].filter(item => item.latlng && item.latlng[0]);

    return allDataForSearch.filter(m => 
      (m.name && String(m.name).toLowerCase().includes(query)) ||
      (m.grave_id && String(m.grave_id).toLowerCase().includes(query)) ||
      (m.id && String(m.id).toLowerCase().includes(query))
    ).slice(0, 10);
  }, [pubSearchQuery, graveData, columbariumSlots]);  const [publicColumbariumSection, setPublicColumbariumSection] = useState(null);
  const floorLabels = [4, 3, 2, 1];
  const colCount = publicColumbariumSection?.cemeteryMap === 'new' ? 124 : 84;
  const slotsPerSide = colCount / 2;
  const slotNumbers = Array.from({ length: colCount }, (_, index) => index + 1);
  const sectionColorGetterRef = useRef(() => '#FF9800');

  // Refs to prevent stale closures in Leaflet event handlers
  const graveDataRef = useRef([]);
  const columbariumSlotsRef = useRef([]);

  useEffect(() => {
    graveDataRef.current = graveData; // Update ref when graveData changes
  }, [graveData]);

  useEffect(() => {
    columbariumSlotsRef.current = columbariumSlots;
  }, [columbariumSlots]);

  const getColumbariumSectionStats = useCallback((sectionId, cemeteryMap) => {
    const sectionName = normalizeSectionName(`Section ${sectionId}`); // Ensure sectionName is consistent
    // Use the ref here to get live data even in old event listeners
    const sectionSlots = columbariumSlotsRef.current.filter((slot) => normalizeSectionName(slot.section) === sectionName && slot.cemeteryMap === cemeteryMap);
    const total = sectionSlots.length;
    let occupied = sectionSlots.filter((slot) => slot.status === 'occupied').length;
    const reserved = sectionSlots.filter((slot) => slot.status === 'reserved').length;

    graveDataRef.current.forEach(g => {
      if (g.grave_id && g.grave_id.startsWith(sectionName + '-C')) {
         if (g.status === 'occupied') occupied++;
      }
    });

    return { total, occupied, reserved }; 
  }, []);

  const getPublicPlotStyle = useCallback(() => ({ ...PUBLIC_GRAVE_PLOT_STYLE }), []);

  useEffect(() => {
    sectionColorGetterRef.current = () => PUBLIC_GRAVE_PLOT_STYLE.fillColor;
  }, []);

  const [myApplications, setMyApplications] = useState([]);
  const [myServiceRequests, setMyServiceRequests] = useState([]);
  const [trackingModalData, setTrackingModalData] = useState(null);
  const [correctedFiles, setCorrectedFiles] = useState({});
  const [seenStatuses, setSeenStatuses] = useState(() => JSON.parse(localStorage.getItem('gravetrak_seen_statuses') || '{}'));
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false);
  const [supportReplies, setSupportReplies] = useState(() => JSON.parse(localStorage.getItem('gravetrak_support_replies') || '[]'));
  const [viewReplyMsg, setViewReplyMsg] = useState(null);
  const [contactMessage, setContactMessage] = useState('');
  const [contactAppContext, setContactAppContext] = useState(null);
  const [transferRequestData, setTransferRequestData] = useState({ appId: '', deceasedName: '', currentLocation: '', reason: '' });

  // Toast Notification State
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = useCallback((message, type = 'success') => {
    if (!isMountedRef.current) return;
    setToast({ show: true, message, type });
    const timeoutId = setTimeout(() => {
      if (isMountedRef.current) {
        setToast(prev => ({ ...prev, show: false }));
      }
      passiveTimeoutsRef.current = passiveTimeoutsRef.current.filter((id) => id !== timeoutId);
    }, 4000);
    passiveTimeoutsRef.current.push(timeoutId);
  }, []);

  const prevStatusesRef = useRef({});

  const fetchMyApps = useCallback((signal) => {
    if (role !== 'user' || signal?.aborted) return;
    return fetchBurialApplications({ signal })
      .then(data => {
        if (!isMountedRef.current || signal?.aborted) return;
        if (Array.isArray(data)) {
          const mergedData = data.map(app => ({
            ...app,
            interview_date: app.interview_info?.scheduled_date,
            interview_time: app.interview_info?.scheduled_time,
            interview_location: app.interview_info?.location,
            action_reason: app.action_required_reason,
            doc_verifications: {},
            doc_reasons: {},
          }));
          // The API already restricts regular users to applications submitted by their account.
          // Relying on the entered applicant name here could hide a valid application.
          const myApps = mergedData;
          
          // Real-time Notification Trigger for Status Changes
          myApps.forEach(app => {
            const prevStatus = prevStatusesRef.current[app.id];
            if (prevStatus && prevStatus !== app.status) {
              if (app.status === 'approved') {
                showToast(`Burial Application ${app.application_id} approved.`, 'success');
              } else if (app.status === 'scheduled') {
                let fTime = '';
                if (app.interview_time) {
                  const parts = app.interview_time.split(':');
                  if (parts.length >= 2) {
                    const hour = parseInt(parts[0], 10);
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    fTime = `at ${hour % 12 || 12}:${parts[1]} ${ampm}`;
                  }
                }
                showToast(`Interview scheduled for ${app.deceased_name} on ${app.interview_date} ${fTime}`, 'success');
              } else if (app.status === 'fully_approved') {
                showToast(`Plot assigned for ${app.deceased_name}.`, 'success');
              } else if (app.status === 'action_required') {
                showToast(`Action required for ${app.deceased_name}'s application.`, 'error');
              }
            }
            prevStatusesRef.current[app.id] = app.status;
          });

          const localReplies = JSON.parse(localStorage.getItem('gravetrak_support_replies') || '[]');
          setSupportReplies(prev => JSON.stringify(prev) === JSON.stringify(localReplies) ? prev : localReplies);
          
          const localTransferReqs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]')
            .filter(m => (m.user === currentUserName || m.user === currentUserInfo.name) && m.message && m.message.includes('TRANSFER PLOT REQUEST'));
          setMyServiceRequests(prev => JSON.stringify(prev) === JSON.stringify(localTransferReqs) ? prev : localTransferReqs);

          setMyApplications(prev => JSON.stringify(prev) === JSON.stringify(myApps) ? prev : myApps);
        }
      })
      .catch(err => {
        if (!isMountedRef.current || signal?.aborted) return;
        if (isAbortError(err)) return;
        console.error("Failed to fetch applications:", err);
      });
  }, [role, currentUserName, currentUserInfo.name, showToast]);

  useEffect(() => {
    if (active && role === 'user') {
      const controller = new AbortController();
      let inFlight = false;
      const refresh = async () => {
        if (document.hidden || inFlight || controller.signal.aborted) return;
        inFlight = true;
        try { await fetchMyApps(controller.signal); }
        finally { inFlight = false; }
      };
      refresh();
      const interval = setInterval(refresh, 15000);
      
      // Cross-tab real-time listener (updates instantly when Mayor presses save)
      const handleStorageChange = (e) => {
        if (e.key && e.key.startsWith('gravetrak_')) refresh();
      };
      window.addEventListener('storage', handleStorageChange);
      document.addEventListener('visibilitychange', refresh);

      return () => {
        controller.abort();
        clearInterval(interval);
        window.removeEventListener('storage', handleStorageChange);
        document.removeEventListener('visibilitychange', refresh);
      };
    }
  }, [active, role, fetchMyApps]);



  const displayTrackingItems = [
    ...myApplications.map(app => {
    const formatTime = (timeStr) => {
      if (!timeStr) return '';
      const parts = timeStr.split(':');
      if (parts.length < 2) return timeStr;
      const hour = parseInt(parts[0], 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const formattedHour = hour % 12 || 12;
      return `${formattedHour}:${parts[1]} ${ampm}`;
    };

    let uiStatus = 'In Review';
    let detail = 'Your application and documents are being validated by the Mayor\'s Office.';
    let eta = '2–3 days';
    let statusColor = 'var(--amber)';
    let statusBg = 'rgba(245,158,11,.1)';
    let statusBorder = 'rgba(245,158,11,.2)';
    let badgeText = 'In progress';

    const rawStatus = (app.status || 'pending').toLowerCase();
    const deceasedName = String(app.deceased_name || '').trim().toLowerCase();
    const assignedPlotInfo = app.assigned_plot_info;
    const assignedGrave = graveData.find(grave => grave.status === 'occupied' && deceasedName && String(grave.name || '').toLowerCase().includes(deceasedName));
    const assignedNiche = columbariumSlots.find(slot => slot.status === 'occupied' && deceasedName && String(slot.name || '').toLowerCase().includes(deceasedName));
    const assignmentLocation = assignedGrave
      ? `Grave Plot ${assignedGrave.grave_id || assignedGrave.id}`
      : assignedNiche
      ? `Apartment Niche ${assignedNiche.id}`
      : assignedPlotInfo
      ? `Grave Plot ${assignedPlotInfo.plot_id || assignedPlotInfo.plot_number || assignedPlotInfo.id}`
      : '';
    const isBurialCompleted = Boolean(app.burial_executed_date) || rawStatus === 'completed';
    const isAssigned = !['rejected', 'cancelled'].includes(rawStatus) && (
      Boolean(assignmentLocation) || ['slot_assigned', 'fully_approved'].includes(rawStatus)
    );
    // Use the final assignment/burial state ahead of an older interview stage.
    const safeStatus = isBurialCompleted || isAssigned ? 'completed' : rawStatus;
    switch(safeStatus) {
      case 'documents_complete':
        uiStatus = 'Documents Complete';
        detail = 'All required documents passed completeness review. Your application is ready for interview scheduling; final approval happens later.';
        eta = 'Pending Schedule';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = 'Ready for scheduling';
        break;
      case 'action_required':
        uiStatus = 'Action Required';
        detail = app.action_reason || 'Some documents require correction. Review the document details below and resubmit the requested documents.';
        eta = 'Immediate';
        statusColor = 'var(--red)';
        statusBg = 'rgba(239,68,68,.1)';
        statusBorder = 'rgba(239,68,68,.2)';
        badgeText = 'Needs your attention';
        break;
      case 'slot_assigned':
        uiStatus = 'Plot Assigned';
        detail = 'A plot or columbarium slot has been tentatively assigned. Awaiting final approval.';
        eta = '1-2 days';
        statusColor = 'var(--accent)';
        statusBg = 'rgba(25,135,101,.1)';
        statusBorder = 'rgba(25,135,101,.2)';
        badgeText = 'In progress';
        break;
      case 'approved':
        uiStatus = 'Application Approved';
        detail = 'Your Burial Application has been approved. Review your application for complete details.';
        eta = 'Approved';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = 'Approved';
        break;
      case 'fully_approved':
        uiStatus = 'Approved';
        detail = 'Your application is fully approved and your slot has been successfully recorded in the cemetery system.';
        eta = 'Ready';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = 'Approved';
        break;
      case 'scheduled':
        uiStatus = 'Burial Scheduled';
        detail = app.burial_date ? 'Your burial schedule has been confirmed. Please see the details below.' : 'Your burial schedule has been confirmed by the office.';
        eta = app.burial_date || 'Upcoming';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = 'Action Required';
        break;
      case 'for_interview':
        uiStatus = 'Interview Scheduled';
        detail = app.interview_date ? 'Your interview has been scheduled. Please see the exact details below.' : 'Your interview schedule has been confirmed by the office.';
        eta = app.interview_date || 'Upcoming';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = 'Interview required';
        break;
      case 'completed':
        uiStatus = isBurialCompleted ? 'Burial Completed' : assignmentLocation ? 'Approved & Assigned' : 'Completed';
        detail = isBurialCompleted
          ? `The burial has been completed${app.burial_executed_date ? ` on ${app.burial_executed_date}` : ''}${assignmentLocation ? ` at ${assignmentLocation}` : ''}.`
          : assignmentLocation
          ? `Your burial location has been approved and assigned: ${assignmentLocation}. The application is now marked completed.`
          : 'Your burial service has been completed and the application is now closed.';
        eta = isBurialCompleted ? 'Burial completed' : assignmentLocation ? 'Assigned' : 'Completed';
        statusColor = 'var(--emerald)';
        statusBg = 'rgba(16,185,129,.1)';
        statusBorder = 'rgba(16,185,129,.2)';
        badgeText = isBurialCompleted ? 'Burial Completed' : assignmentLocation ? 'Approved & Assigned' : 'Completed';
        break;
      case 'rejected':
        uiStatus = 'Disapproved';
        detail = app.rejection_reason || 'Your application was denied. Please contact the office for details.';
        eta = 'Closed';
        statusColor = 'var(--text-muted)';
        statusBg = 'rgba(255,255,255,.05)';
        statusBorder = 'rgba(255,255,255,.1)';
        badgeText = 'Closed';
        break;
      case 'cancelled':
        uiStatus = 'Cancelled';
        detail = app.action_reason ? `You have cancelled this burial application. It will no longer be processed.\n\nReason: ${app.action_reason}` : 'You have cancelled this burial application. It will no longer be processed.';
        eta = 'Closed';
        statusColor = 'var(--text-muted)';
        statusBg = 'rgba(255,255,255,.05)';
        statusBorder = 'rgba(255,255,255,.1)';
        badgeText = 'Cancelled';
        break;
    }
    return { 
      id: app.application_id || `APP-${app.id}`, 
      rawId: app.id,
      type: 'Burial Application', 
      status: uiStatus, 
      eta, 
      detail, 
      rawStatus: safeStatus, 
      statusColor, 
      statusBg, 
      statusBorder, 
      badgeText, 
      applicant: app.applicant_name, 
      deceased: app.deceased_name,
      assignmentLocation,
      interviewDate: app.interview_date,
      interviewTime: formatTime(app.interview_time),
      interviewLocation: app.interview_location,
      interviewNotes: app.interview_info?.notes,
      actionReason: app.action_reason,
      docVerifications: app.doc_verifications,
      docReasons: app.doc_reasons,
      documents: app.documents || [],
      documentCompleteness: app.document_completeness,
      submittedAt: app.created_at || app.submitted_at || app.date_submitted || app.updated_at,
      updatedAt: app.updated_at || app.modified_at || app.created_at || app.submitted_at
    };
    }),
    ...myServiceRequests.map(req => {
      const detail = req.message.replace(/TRANSFER PLOT REQUEST\n/, '');
      return {
        id: `SRQ-${req.id.toString().slice(-6)}`,
        rawId: req.id,
        type: `Plot Transfer Request`,
        status: req.resolved ? 'Processed' : 'In Review',
        eta: req.resolved ? 'Completed' : 'Under Review',
        detail: detail,
        rawStatus: req.resolved ? 'resolved' : 'pending',
        statusColor: req.resolved ? 'var(--emerald)' : 'var(--amber)',
        statusBg: req.resolved ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)',
        statusBorder: req.resolved ? 'rgba(16,185,129,.2)' : 'rgba(245,158,11,.2)',
        badgeText: req.resolved ? 'Resolved' : 'Pending',
        applicant: req.user,
        deceased: req.deceased
      };
    })
  ];

  const trackingPageCount = Math.max(1, Math.ceil(displayTrackingItems.length / 5));
  const currentTrackingPage = Math.min(trackingPage, trackingPageCount);
  const paginatedTrackingItems = displayTrackingItems.slice((currentTrackingPage - 1) * 5, currentTrackingPage * 5);
  useEffect(() => { setTrackingPage(page => Math.min(page, trackingPageCount)); }, [trackingPageCount]);
  const changeTrackingPage = page => {
    setTrackingPage(Math.max(1, Math.min(page, trackingPageCount)));
    trackingListRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  useEffect(() => {
    if ((activePanel === 'panel-application-tracking' || notifOpen) && (displayTrackingItems.length > 0 || supportReplies.length > 0)) {
      setSeenStatuses(prev => {
        let updated = false;
        const newSeen = { ...prev };
        displayTrackingItems.forEach(item => {
          if (newSeen[item.id] !== item.rawStatus) {
            newSeen[item.id] = item.rawStatus;
            updated = true;
          }
        });
        supportReplies.forEach(r => {
          if (!newSeen[`reply-${r.id}`]) {
            newSeen[`reply-${r.id}`] = true;
            updated = true;
          }
        });
        if (updated) {
          localStorage.setItem('gravetrak_seen_statuses', JSON.stringify(newSeen));
          return newSeen;
        }
        return prev;
      });
    }
  }, [activePanel, notifOpen, displayTrackingItems, supportReplies]);

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    setIsColumbariumLoading(true);
    fetchColumbariums({ signal: controller.signal })
      .then((data) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        if (Array.isArray(data)) {
          const backendSlots = processSlots(data);
          setColumbariumSlots(backendSlots);
          localStorage.setItem('gravetrak_columbarium', JSON.stringify(backendSlots));
        } else {
          setColumbariumSlots([]);
        }
      })
      .catch((err) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        if (isAbortError(err)) return;
        setColumbariumSlots([]);
      })
      .finally(() => {
        if (isMountedRef.current && !controller.signal.aborted) setIsColumbariumLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [active, authStatus]);

  useEffect(() => {
    const handleColumbariumSync = (e) => {
      if (e.key === 'gravetrak_columbarium') {
        const updatedCol = JSON.parse(localStorage.getItem('gravetrak_columbarium') || '[]');
        if (updatedCol.length > 0) setColumbariumSlots(updatedCol.map(s => ({
          ...s,
          cemeteryMap: s.cemeteryMap || getMapType(s.section)
        })));
      }
    };
    window.addEventListener('storage', handleColumbariumSync);
    return () => window.removeEventListener('storage', handleColumbariumSync);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
      if (!event.target.closest('.search-container') && !event.target.closest('.search-fab')) {
        setLandingSearchOpen(false);
        setPubSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMapClick = useCallback(() => {
    setLandingOpen(false);
    setPubOpen(false);
    setLandingSearchOpen(false);
    setPubSearchOpen(false);
    if (isNavigating) return;
    onSelectGrave(null);
  }, [isNavigating, onSelectGrave]);

  const handleMarkerClick = useCallback((grave) => {
    addToRecentSearches(grave);
    onSelectGrave(grave);
  }, [onSelectGrave, addToRecentSearches]);

  const safeFlyTo = useCallback((coords, nextZoom = 21, options = {}) => {
    if (!mapRef.current) return false;
    const target = sanitizeLatLng(coords, null);
    if (!target) return false;
    try {
      mapRef.current.flyTo(target, nextZoom, { animate: true, ...options });
      return true;
    } catch (_) {
      return false;
    }
  }, []);

  const showDestinationMarker = useCallback((coords) => {
    if (!mapRef.current) return false;
    const target = sanitizeLatLng(coords, null);
    if (!target) return false;
    if (destinationMarkerRef.current) {
      try { mapRef.current.removeLayer(destinationMarkerRef.current); } catch (_) {}
    }

    const destinationIcon = L.divIcon({
      className: 'destination-marker',
      html: `<svg viewBox="0 0 24 24" width="36" height="36" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));">
               <path fill="#ef4444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
               <circle cx="12" cy="9.5" r="2.5" fill="white"/>
             </svg>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    destinationMarkerRef.current = L.marker(target, { icon: destinationIcon, zIndexOffset: 999, interactive: false }).addTo(mapRef.current);
    return true;
  }, []);

  const mapCenter = useMemo(() => sanitizeLatLng(initialCemetery === 'new' ? ANOTHER_CEMETERY_CENTER : CEMETERY_CENTER), [initialCemetery]);
  const oldSectionPlotCollections = useMemo(() => {
    if (typeof window.turf === 'undefined') return [];
    return siteData.features
      .filter((feature) => feature.properties.id && feature.geometry.type === 'Polygon')
      .map((feature) => ({
        id: feature.properties.id,
        plotsGeoJSON: generateGravePlots(feature.geometry, feature.properties.id, 42, 'old'),
      }));
  }, []);
  const newSectionPlotCollections = useMemo(() => {
    if (typeof window.turf === 'undefined') return [];
    return anotherMapData.features
      .filter((feature) => feature.properties?.name && feature.geometry?.type === 'Polygon')
      .map((feature) => {
        const normalizedSectionName = normalizeSectionName(feature.properties.name);
        let label = normalizedSectionName.replace('Expansion Area ', 'Section ');
        const origLabel = label.toLowerCase();
        let mappedSection = normalizedSectionName;
        if (origLabel === 'section n') { label = 'Section A'; mappedSection = 'Section A'; }
        if (origLabel === 'section o') { label = 'Section B'; mappedSection = 'Section B'; }
        if (!['section n', 'section o'].includes(normalizedSectionName.toLowerCase())) return null;
        return {
          normalizedSectionName,
          mappedSection,
          plotsGeoJSON: generateGravePlots(feature.geometry, mappedSection, 62, 'new'),
        };
      })
      .filter(Boolean);
  }, []);
  const oldSectionPlotCollectionsRef = useRef(oldSectionPlotCollections);
  const newSectionPlotCollectionsRef = useRef(newSectionPlotCollections);
  useEffect(() => {
    oldSectionPlotCollectionsRef.current = oldSectionPlotCollections;
    newSectionPlotCollectionsRef.current = newSectionPlotCollections;
  }, [oldSectionPlotCollections, newSectionPlotCollections]);
  const isMapDataLoading = active && (isGraveDataLoading || isColumbariumLoading);

  useEffect(() => {
    if (!active || isMapDataLoading) {
      setMapIsReady(false);
    }
  }, [active, isMapDataLoading]);

  const mapRef = useLeafletMap({
    containerRef: mapContainerRef,
    active: active && !isMapDataLoading,
    center: mapCenter,
    zoom: 19,
    onMarkerClick: handleMarkerClick,
    onMapClick: handleMapClick,
    onMapReady: useCallback((map) => {
      if (!isMountedRef.current || !mapContainerRef.current?.isConnected) return null;
      const isPublicMapAlive = () => isMountedRef.current && mapRef.current === map && mapContainerRef.current?.isConnected;
      setMapIsReady(true);
      const mapCanvasRenderer = L.canvas(); // Use Canvas to render 1000s of polygons without lag
      if (!map.getPane('publicPathwaysPane')) map.createPane('publicPathwaysPane');
      map.getPane('publicPathwaysPane').style.zIndex = '450';
      // Keep the active visitor route above the visual pathway it follows.
      if (!map.getPane('publicNavigationPane')) map.createPane('publicNavigationPane');
      map.getPane('publicNavigationPane').style.zIndex = '550';
      map.getPane('publicNavigationPane').style.pointerEvents = 'none';
      const publicPathwayRenderer = L.svg({ pane: 'publicPathwaysPane' });
      const oldMapLayerGroup = L.layerGroup();
      const newMapLayerGroup = L.layerGroup();
      const managedLegacyPathIds = new Set(savedCemeteryPathways.map(pathway => {
        const match = String(pathway.properties?.description || '').match(/\[legacy-path:([^\]]+)\]/);
        return match?.[1];
      }).filter(Boolean));

      const savedPlotSectionIds = new Set(savedBurialPlots.map(plot => String(plot.section_record)));
      const hiddenLegacySection = (name, cemetery) => savedCemeterySections.some(section =>
        (section.properties?.is_active === false || (section.geometry?.type === 'Polygon'
          && savedPlotSectionIds.has(String(section.id || section.properties?.id)))) && section.properties?.cemetery_code === cemetery &&
        [section.properties?.name, section.properties?.legacy_source_name].some(value => normalizeSectionName(value) === normalizeSectionName(name))
      );
      const sectionLayer = L.geoJSON(closeBoundaryFeatures(siteData), {
        smoothFactor: 0,
        filter: feature => !feature.properties?.id || !hiddenLegacySection(`Section ${feature.properties.id}`, 'old'),
        style: (feature) => {
          if (feature.properties.type === 'boundary') {
            return { color: '#2196F3', weight: 3, fillOpacity: 0, lineCap: 'round', lineJoin: 'round', smoothFactor: 0 };
          }
          return {
            ...getPublicPlotStyle(),
            weight: PUBLIC_GRAVE_PLOT_BORDER_WEIGHT,
          };
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.id) {
            const secColor = getSectionColor(feature.properties.id);
            
            // Create a dynamic container for stats that can be updated on popupopen
            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
              <div style="text-align: center; min-width: 160px;">
                <strong style="font-size: 14px; color: var(--text-primary);">Section ${feature.properties.id}</strong><br>
                <div style="margin: 10px 0; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 8px; border: 1px solid rgba(0,0,0,0.05);">
                  <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 2px;">Records & Capacity</span>
                  <div id="stats-container-${feature.properties.id}" style="font-size: 13px; font-weight: 800; color: var(--text-primary);">
                    Loading stats...
                  </div>
                </div>
                <button class="btn btn-primary btn-sm" style="width: 100%; background: ${secColor}; border-color: ${secColor}; color: #fff; font-weight: 700;" id="btn-pub-view-${feature.properties.id}">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:inline; margin-right:4px; vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  View Interred Records
                </button>
              </div>
            `;
            layer.bindPopup(popupContent);
            layer.on('popupopen', () => {
              if (!isPublicMapAlive()) return;
              const stats = getColumbariumSectionStats(feature.properties.id, 'old'); // uses live ref data
              const statsEl = document.getElementById(`stats-container-${feature.properties.id}`);
              if (statsEl) {
                statsEl.innerHTML = `${stats.occupied} / ${stats.total} Slots Interred`;
                statsEl.style.color = stats.occupied === stats.total ? 'var(--red)' : 'var(--text-primary)';
              }
              
              const btn = document.getElementById(`btn-pub-view-${feature.properties.id}`);
              if (btn) {
                btn.onclick = () => {
                  if (!isPublicMapAlive()) return;
                  setPublicColumbariumSection(normalizeSectionName(`Section ${feature.properties.id}`));
                  mapRef.current?.closePopup(); // Use mapRef.current to close the popup
                };
              }
            });
            layer.bindTooltip(`Section ${feature.properties.id}`, {
              permanent: true,
              direction: 'center',
              className: 'leaflet-tooltip-own',
            });
              
              layer.on({
                  mouseover: function(e) { if (!isPublicMapAlive()) return; e.target.setStyle({ fillOpacity: PUBLIC_GRAVE_PLOT_HOVER_OPACITY }); },
                  mouseout: function(e) { if (!isPublicMapAlive()) return; e.target.setStyle(getPublicPlotStyle()); }
              });
          }
        },
      }).addTo(oldMapLayerGroup);

      // Generate columbarium grids for ALL sections
      oldSectionPlotCollectionsRef.current.forEach(({ id, plotsGeoJSON }) => {
          if (hiddenLegacySection(`Section ${id}`, 'old')) return;
          L.geoJSON(plotsGeoJSON, { // Old cemetery plots
            renderer: mapCanvasRenderer,
            style: () => getPublicPlotStyle(),
            onEachFeature: (f, layer) => {
              layer.options.isGravePlot = true;
              layer.on({
                click: (e) => { 
                  if (!isPublicMapAlive()) return;
                  L.DomEvent.stopPropagation(e); 
                  if (typeof onSelectGrave === 'function') { 
                    const plotId = f.properties.name;
                    onSelectGrave({ 
                      id: plotId, 
                      grave_id: plotId, 
                      section: f.properties.section,
                      row: f.properties.row,
                      column: f.properties.column,
                      name: 'Multi-level Plot', 
                      dates: '—', 
                      location: `Section ${f.properties.section} Row ${f.properties.row} Col ${f.properties.column}`, 
                      status: 'available',
                      cemeteryMap: 'old',
                      latlng: f.properties.frontCoord || [e.latlng.lat, e.latlng.lng], 
                      floors: 4,
                      isPlotStack: true 
                    }); 
                  } 
                },
                mouseover: (e) => { if (!isPublicMapAlive()) return; e.target.setStyle({ fillOpacity: PUBLIC_GRAVE_PLOT_HOVER_OPACITY }); },
                mouseout: (e) => { if (!isPublicMapAlive()) return; e.target.setStyle(getPublicPlotStyle()); }
              });
            }
          }).addTo(oldMapLayerGroup);
      });
      
      // Integrate Another Cemetery Map
      L.geoJSON(closeBoundaryFeatures(anotherMapData), {
        smoothFactor: 0,
        filter: (feature) => {
          if (feature.geometry?.type === 'LineString' && feature.properties?.name === 'path') return false;
          if (feature.geometry?.type !== 'Polygon') return true;
          const sourceName = normalizeSectionName(feature.properties?.name || '').replace('Expansion Area ', 'Section ');
          return !savedCemeterySections.some(section =>
            section.properties?.cemetery_code === 'new' &&
            [section.properties?.name, section.properties?.legacy_source_name].some(name =>
              normalizeSectionName(name).replace('Expansion Area ', 'Section ') === sourceName
            )
          );
        },
        style: (feature) => {
          if (feature.geometry.type === 'LineString') {
            if (feature.properties && (feature.properties.type === 'boundary' || feature.properties.name === 'boundary')) {
              return { color: '#2196F3', weight: 4, opacity: 1.0 };
            }
            if (feature.properties && feature.properties.name === 'path') {
              return PUBLIC_PATHWAY_INNER_STYLE;
            }
            return { color: '#2196F3', weight: 3, opacity: 1.0 };
          }
          let mappedName = feature.properties.name;
          if (mappedName) {
            const norm = normalizeSectionName(mappedName).toLowerCase();
            if (norm === 'section n') mappedName = 'Section A';
            if (norm === 'section o') mappedName = 'Section B';
          }
          return getPublicPlotStyle();
        }, 
        onEachFeature: (feature, layer) => { // This onEachFeature is for the main section polygons
          if (feature.properties?.name && feature.geometry?.type === 'Polygon') {
            const sectionName = feature.properties.name;
            const normalizedSectionName = normalizeSectionName(sectionName);
            let label = normalizedSectionName.replace('Expansion Area ', 'Section ');
            
            const origLabel = label.toLowerCase();
            let mappedSection = normalizedSectionName;
            if (origLabel === 'section n') { label = 'Section A'; mappedSection = 'Section A'; }
            if (origLabel === 'section o') { label = 'Section B'; mappedSection = 'Section B'; }

            layer.bindTooltip(label, { permanent: true, direction: 'center', className: 'leaflet-tooltip-own' });
            
            if (['section n', 'section o'].includes(normalizedSectionName.toLowerCase())) {
              layer.bindPopup(`<strong>New Area: ${label}</strong><br>Status: Available`);
              layer.on({
                click: (e) => {
                  if (!isPublicMapAlive()) return;
                  L.DomEvent.stopPropagation(e); 
                  setPublicColumbariumSection(mappedSection);
                },
                mouseover: function(e) { if (!isPublicMapAlive()) return; e.target.setStyle({ fillOpacity: PUBLIC_GRAVE_PLOT_HOVER_OPACITY }); },
                mouseout: function(e) { if (!isPublicMapAlive()) return; e.target.setStyle(getPublicPlotStyle()); }
              });

              // Generate columbarium grids for these two specific new map sections using Canvas
              const memoizedNewPlots = newSectionPlotCollectionsRef.current.find((item) => item.mappedSection === mappedSection);
              const plotsGeoJSON = memoizedNewPlots?.plotsGeoJSON || generateGravePlots(feature.geometry, mappedSection, 62, 'new');
              L.geoJSON(plotsGeoJSON, {
                renderer: mapCanvasRenderer,
                style: () => getPublicPlotStyle(),
                onEachFeature: (f, layer) => { layer.options.isGravePlot = true; layer.on({ click: (e) => { if (!isPublicMapAlive()) return; L.DomEvent.stopPropagation(e); if (typeof onSelectGrave === 'function') { onSelectGrave({ id: f.properties.name, grave_id: f.properties.name, section: f.properties.section, row: f.properties.row, column: f.properties.column, name: 'Multi-level Plot', dates: '—', location: `${normalizedSectionName} Row ${f.properties.row} Col ${f.properties.column}`, status: 'available', latlng: f.properties.frontCoord || [e.latlng.lat, e.latlng.lng], isPlotStack: true, floors: 4, cemeteryMap: 'new' }); } }, mouseover: (e) => { if (!isPublicMapAlive()) return; e.target.setStyle({ fillOpacity: PUBLIC_GRAVE_PLOT_HOVER_OPACITY }); }, mouseout: (e) => { if (!isPublicMapAlive()) return; e.target.setStyle(getPublicPlotStyle()); } }); }
              }).addTo(newMapLayerGroup);
            } else {
              // New map is static for other sections to prevent lag
              layer.options.interactive = false;
            }
          }
        }
      }).addTo(newMapLayerGroup);

      savedCemeterySections.forEach(feature => {
        const props = feature.properties || {};
        if (!feature.geometry || props.is_active === false) return;
        const statusLabel = props.status === 'planned' ? 'Planning' : props.status === 'maintenance' ? 'Maintenance' : 'Active';
        L.geoJSON(feature, {
          style: () => getPublicPlotStyle(),
          onEachFeature: (_savedFeature, layer) => {
            layer.bindTooltip(`${props.zone_code || 'Zone'} — ${props.name}`, { direction: 'center', className: 'leaflet-tooltip-own' });
            layer.bindPopup(`<strong>${props.zone_code || 'Zone'} — ${props.name}</strong><br>Status: ${statusLabel}<br>Graves: ${props.total_plots || 0}<br>Floors per grave: ${props.estimated_stack_height || 1}`);
          },
        }).addTo(props.cemetery_code === 'new' ? newMapLayerGroup : oldMapLayerGroup);
      });
      const renderPathwayJoins = (features, group) => {
        const joins = buildPathwayJoinFeatures(features);
        const network = { type: 'FeatureCollection', features: [...features, ...joins.features] };
        // Draw all casings before all center lines so later roads cannot leave
        // dark caps over the middle of an already rendered junction.
        L.geoJSON(network, {
          renderer: publicPathwayRenderer,
          pane: 'publicPathwaysPane',
          smoothFactor: 0,
          style: PUBLIC_PATHWAY_OUTER_STYLE,
          interactive: false,
        }).addTo(group);
        L.geoJSON(network, {
          renderer: publicPathwayRenderer,
          pane: 'publicPathwaysPane',
          smoothFactor: 0,
          style: PUBLIC_PATHWAY_INNER_STYLE,
          onEachFeature: (feature, layer) => {
            const props = feature.properties || {};
            if (props.pathway_join) { layer.options.interactive = false; return; }
            const description = document.createElement('div');
            description.textContent = `${props.name || 'Pathway'} — ${props.pathway_type || 'walkway'}${props.width_meters ? ` • Width: ${props.width_meters} m` : ''}`;
            layer.bindPopup(description);
          },
        }).addTo(group);
      };
      const oldVisiblePaths = [
        ...pathwaysGeoJson.features.filter((feature, index) => !managedLegacyPathIds.has(`old-${index}`)),
        ...savedCemeteryPathways.filter(feature => feature.geometry?.type === 'LineString' && feature.properties?.is_active !== false && feature.properties?.cemetery_code === 'old'),
      ];
      const newVisiblePaths = [
        ...(anotherMapData?.features || []).filter((feature, index) => feature.geometry?.type === 'LineString' && feature.properties?.name === 'path' && !managedLegacyPathIds.has(`new-${feature.id || index}`)),
        ...savedCemeteryPathways.filter(feature => feature.geometry?.type === 'LineString' && feature.properties?.is_active !== false && feature.properties?.cemetery_code === 'new'),
      ];
      renderPathwayJoins(oldVisiblePaths, oldMapLayerGroup);
      renderPathwayJoins(newVisiblePaths, newMapLayerGroup);
      const savedPlotFeatures = buildSavedSectionPlotFeatures(savedCemeterySections, savedBurialPlots);
      L.geoJSON(savedPlotFeatures, {
        renderer: mapCanvasRenderer,
        style: () => getPublicPlotStyle(),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          layer.bindPopup(`<strong>${props.plot_id}</strong><br>${props.section_name}<br>Floors: ${props.floors}<br>Section status: ${props.section_status}<br>Plot status: ${props.status}`);
          layer.options.isGravePlot = true;
          layer.on('click', (event) => {
            if (!isPublicMapAlive() || typeof onSelectGrave !== 'function') return;
            L.DomEvent.stopPropagation(event);
            onSelectGrave({
              id: props.niche_column ? `${props.section_name}-C${props.niche_column}` : props.plot_id,
              grave_id: props.niche_column ? `${props.section_name}-C${props.niche_column}` : props.plot_id,
              section: props.section_name,
              status: props.status || 'available',
              name: props.name || '— Available —',
              dates: props.dates || '—',
              location: props.location_description || props.section_name,
              latitude: props.latitude,
              longitude: props.longitude,
              latlng: props.rendered_center || [props.latitude, props.longitude],
              cemeteryMap: props.cemetery_code || 'old',
              floors: props.floors || 1,
              row: props.row,
              column: props.niche_column || props.column,
              isPlotStack: Number(props.floors || 1) > 1,
              isGroundPlotStack: !props.niche_column && Number(props.floors || 1) > 1,
            });
          });
        },
      }).eachLayer(layer => {
        const cemeteryCode = layer.feature?.properties?.cemetery_code;
        (cemeteryCode === 'new' ? newMapLayerGroup : oldMapLayerGroup).addLayer(layer);
      });

      // Keep both cemetery datasets mounted on one geographic map. The
      // Old/New controls below only change the camera focus.
      oldMapLayerGroup.addTo(map);
      newMapLayerGroup.addTo(map);

      // Default to Old Cemetery; landing-page links can focus New Cemetery.
      map.setView(initialCemetery === 'new' ? ANOTHER_CEMETERY_CENTER : CEMETERY_CENTER, 19, { animate: false });

      return sectionLayer;
    }, [initialCemetery, getColumbariumSectionStats, getPublicPlotStyle, onSelectGrave, savedCemeterySections, savedCemeteryPathways, savedBurialPlots]),
  });
  const { transition: cemeteryTransition, switchCemetery, dismissTransition } = useCemeteryTransition(mapRef, active);


  useEffect(() => {
    if (!selectedGrave && !isNavigating) {
      if (routeAnimationFrameRef.current) {
        cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = null;
      }
      if (routeAbortControllerRef.current) {
        routeAbortControllerRef.current.abort();
        routeAbortControllerRef.current = null;
      }
      if (routeLayerRef.current && mapRef.current) {
        try {
          mapRef.current.removeLayer(routeLayerRef.current);
        } catch (_) {
          // Route layer may already be detached during map teardown.
        }
        routeLayerRef.current = null;
      }
      if (navigationWatchId.current != null) {
        navigator.geolocation.clearWatch(navigationWatchId.current);
        navigationWatchId.current = null;
      }
      if (userMarkerRef.current && mapRef.current) {
        try {
          mapRef.current.removeLayer(userMarkerRef.current);
        } catch (_) {
          // User marker may already be detached during map teardown.
        }
        userMarkerRef.current = null;
      }
      if (destinationMarkerRef.current && mapRef.current) {
        try {
          mapRef.current.removeLayer(destinationMarkerRef.current);
        } catch (_) {
          // Destination marker may already be detached.
        }
        destinationMarkerRef.current = null;
      }
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
        orientationHandlerRef.current = null;
      }
      setNavStats(null);
      setRouteDestination(null);
    }
  }, [selectedGrave, isNavigating, mapRef]);

  const stopNavigation = useCallback((options = {}) => {
    const shouldClearSelection = typeof options?.clearSelection === 'boolean'
      ? options.clearSelection
      : !(options && typeof options.preventDefault === 'function');

    setIsNavigating(false);
    setNavStats(null);
    setRouteDestination(null);

    if (routeAnimationFrameRef.current) {
      cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = null;
    }
    if (routeAbortControllerRef.current) {
      routeAbortControllerRef.current.abort();
      routeAbortControllerRef.current = null;
    }
    if (routeLayerRef.current && mapRef.current) {
      try {
        mapRef.current.removeLayer(routeLayerRef.current);
      } catch (_) {
        // Route layer may already be detached during map teardown.
      }
      routeLayerRef.current = null;
    }
    if (navigationWatchId.current != null) {
      navigator.geolocation.clearWatch(navigationWatchId.current);
      navigationWatchId.current = null;
    }
    if (userMarkerRef.current && mapRef.current) {
      try {
        mapRef.current.removeLayer(userMarkerRef.current);
      } catch (_) {
        // User marker may already be detached during map teardown.
      }
      userMarkerRef.current = null;
    }
    if (destinationMarkerRef.current && mapRef.current) {
      try {
        mapRef.current.removeLayer(destinationMarkerRef.current);
      } catch (_) {
        // Destination marker may already be detached.
      }
      destinationMarkerRef.current = null;
    }
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
      window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      orientationHandlerRef.current = null;
    }
    const mapInstance = mapRef.current;
    const startView = navigationStartViewRef.current;
    navigationStartViewRef.current = null;
    try {
      mapInstance?.stop();
      mapInstance?.invalidateSize({ pan: false });
      if (startView && mapInstance === startView.map && shouldClearSelection && options?.restoreView !== false) {
        mapInstance.flyTo(startView.center, startView.zoom, {
          animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          duration: 0.85,
        });
      }
    } catch (_) {}
    if (shouldClearSelection) onSelectGrave(null);
  }, [mapRef, onSelectGrave]);

  const handleSearchResultSelect = useCallback((grave) => {
    const coords = grave.latlng || grave.loc || (
      grave.latitude != null && grave.longitude != null
        ? [grave.latitude, grave.longitude]
        : null
    );
    if (isNavigating) stopNavigation({ clearSelection: false });
    addToRecentSearches(grave);
    onSelectGrave(grave);
    showDestinationMarker(coords);
    safeFlyTo(coords, 21);
  }, [isNavigating, stopNavigation, addToRecentSearches, onSelectGrave, showDestinationMarker, safeFlyTo]);

  // Choosing a different plot during directions starts a clean selection flow
  // instead of leaving the mobile map locked in the previous route state.
  useEffect(() => {
    if (!isNavigating || !selectedGrave || !routeDestination) return;
    const getRouteTargetKey = (grave) => `${grave.cemeteryMap || grave.cemetery_map || 'old'}:${grave.plot_id || grave.grave_id || grave.id || ''}`;
    if (getRouteTargetKey(selectedGrave) !== getRouteTargetKey(routeDestination)) {
      stopNavigation({ clearSelection: false });
    }
  }, [isNavigating, routeDestination, selectedGrave, stopNavigation]);

  const cleanupMapArtifacts = useCallback(() => {
    navigationStartViewRef.current = null;
    if (routeAnimationFrameRef.current) {
      cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = null;
    }
    if (routeAbortControllerRef.current) {
      routeAbortControllerRef.current.abort();
      routeAbortControllerRef.current = null;
    }
    if (navigationWatchId.current != null) {
      navigator.geolocation.clearWatch(navigationWatchId.current);
      navigationWatchId.current = null;
    }
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
      window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      orientationHandlerRef.current = null;
    }

    const mapInstance = mapRef.current;
    if (mapInstance) {
      try {
        mapInstance.stop?.();
        if (routeLayerRef.current) {
          routeLayerRef.current.off?.();
          routeLayerRef.current.clearLayers?.();
          mapInstance.removeLayer(routeLayerRef.current);
        }
        if (userMarkerRef.current) {
          userMarkerRef.current.off?.();
          mapInstance.removeLayer(userMarkerRef.current);
        }
      } catch (_) {
        // Leaflet may already be disposing the map.
      }
    }

    routeLayerRef.current = null;
    userMarkerRef.current = null;
  }, [mapRef]);

  const hardDisposeMap = useCallback(() => {
    cleanupMapArtifacts();
    disposeLeafletMap(mapRef, mapContainerRef, [
      routeLayerRef.current,
      userMarkerRef.current,
      destinationMarkerRef.current,
    ]);
    routeLayerRef.current = null;
    userMarkerRef.current = null;
    destinationMarkerRef.current = null;
  }, [cleanupMapArtifacts, mapRef]);

  useLayoutEffect(() => {
    return () => {
      hardDisposeMap();
    };
  }, [authStatus, hardDisposeMap]);

  useEffect(() => {
    if (!active) hardDisposeMap();
  }, [active, hardDisposeMap]);

  useEffect(() => cleanupMapArtifacts, [cleanupMapArtifacts]);

  const handleNavigateRoute = useCallback((grave) => {
    addToRecentSearches(grave);
    if (!mapRef.current) return;
    // Cancel any in-flight Leaflet animation (flyTo / fitBounds from a previous
    // route) before we start a new one.  If omitted, the map can stay in its
    // animating state and block pointer events on markers.
    try { mapRef.current.stop(); } catch (_) {}
    if (!navigationStartViewRef.current) {
      const center = mapRef.current.getCenter();
      navigationStartViewRef.current = { map: mapRef.current, center: [center.lat, center.lng], zoom: mapRef.current.getZoom() };
    }
    if (routeAbortControllerRef.current) {
      routeAbortControllerRef.current.abort();
    }
    const routeController = new AbortController();
    routeAbortControllerRef.current = routeController;
    setRouteCameraState({ mode: 'idle', ready: false, hasLocation: false });
    const camera = createRouteCamera(mapRef.current, {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onChange: state => setRouteCameraState(previous => ({ ...state, mode: state.mode === 'location-updated' ? previous.mode : state.mode })),
      getPadding: () => {
        const header = document.querySelector('#screen-public .nav-header-overlay');
        const card = document.querySelector('#screen-public .live-nav-overlay');
        return { paddingTopLeft: [24, (header?.getBoundingClientRect().bottom || 130) + 20],
          paddingBottomRight: [24, (card?.offsetHeight || 180) + 52] };
      },
    });
    routeCameraRef.current = camera;
    routeController.signal.addEventListener('abort', () => {
      camera.dispose();
      if (routeCameraRef.current === camera) routeCameraRef.current = null;
    }, { once: true });
    setIsNavigating(true);
    setRouteOrigin('Finding location...');
    setPubOpen(false);
    setLandingOpen(false);
    setPubSearchOpen(false);
    setLandingSearchOpen(false);
    setRouteDestination(grave);

    let targetCoords;
    if (grave.latlng && grave.latlng[0] !== undefined) {
      targetCoords = grave.latlng;
    } else if (grave.latitude && grave.longitude) {
      targetCoords = [grave.latitude, grave.longitude];
    } else if (grave.loc) {
      targetCoords = grave.loc;
    } else {
      targetCoords = CEMETERY_CENTER;
    }
    targetCoords = sanitizeLatLng(targetCoords, CEMETERY_CENTER);
    const explicitCemetery = grave.cemeteryMap || grave.cemetery_map;
    const targetDistanceToOld = Math.hypot(targetCoords[0] - CEMETERY_CENTER[0], targetCoords[1] - CEMETERY_CENTER[1]);
    const targetDistanceToNew = Math.hypot(targetCoords[0] - ANOTHER_CEMETERY_CENTER[0], targetCoords[1] - ANOTHER_CEMETERY_CENTER[1]);
    const isNewDestination = explicitCemetery
      ? explicitCemetery === 'new'
      : targetDistanceToNew < targetDistanceToOld;
    const destinationEntrance = isNewDestination ? NEW_CEMETERY_ENTRANCE : OLD_CEMETERY_ENTRANCE;

    // Mark the destination before computing the route so the same pin is used
    // for both search results and active directions.
    showDestinationMarker(targetCoords);

    // Starting coordinate (Entrance / exactly at the front path start)
    const defaultStartCoords = destinationEntrance;

    setNavStats({ eta: 'Calculating...', distance: '...' });

    let routingNodes = null;
    const getRoutingNodes = () => {
      if (routingNodes) return routingNodes;
      // 3. INTERNAL ROUTE: Custom Pathfinding Logic for Hand-Drawn Layers
      const nodes = new Map();
      let nextNodeId = 0;
      
      const addNode = (coord, pathIndex) => {
        const id = nextNodeId++;
        nodes.set(id, { coord, pathIndex, edges: [] });
        return id;
      };

    const preferredNewPathSource = newCemeteryGeoJson?.features?.some(f => f.geometry?.type === 'LineString')
      ? newCemeteryGeoJson
      : anotherMapData;
    const basePaths = isNewDestination
      ? preferredNewPathSource.features.filter(f => f.geometry && f.geometry.type === 'LineString' && (!f.properties || (f.properties.type !== 'boundary' && f.properties.name !== 'boundary')))
      : pathwaysGeoJson.features;
    const plannedPaths = savedCemeteryPathways.filter(feature =>
      feature.geometry?.type === 'LineString' &&
      feature.properties?.is_active !== false &&
      feature.properties?.cemetery_code === (isNewDestination ? 'new' : 'old')
    );
    const activePaths = [...basePaths, ...plannedPaths];

    activePaths.forEach((f, pathIndex) => {
        const coords = f.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;
        // Preserve one continuous node chain for the complete drawn route.
        let prevId = addNode(coords[0], pathIndex);
        for (let i = 0; i < coords.length - 1; i++) {
          const p1 = coords[i];
          const p2 = coords[i+1];

          const distDeg = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
          const steps = Math.max(1, Math.ceil(distDeg / 0.00001));

          for (let j = 1; j <= steps; j++) {
              const t = j / steps;
              const pt = [
                  p1[0] + (p2[0] - p1[0]) * t,
                  p1[1] + (p2[1] - p1[1]) * t
              ];
              const currId = addNode(pt, pathIndex);
              const stepDist = Math.hypot(nodes.get(prevId).coord[0] - nodes.get(currId).coord[0], nodes.get(prevId).coord[1] - nodes.get(currId).coord[1]);
              nodes.get(prevId).edges.push({ to: currId, dist: stepDist });
              nodes.get(currId).edges.push({ to: prevId, dist: stepDist });
              prevId = currId;
          }

        }
      });

      connectNearbyNodes(nodes, true);

      routingNodes = nodes;
      return nodes;
    };

    let routeCalculationVersion = 0;
    const calculateAndDrawRoute = async (startCoords) => {
      const calculationVersion = ++routeCalculationVersion;
      if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
      // 1. CONFIGURATION: Define the Cemetery Entrance Gate (The "Stitch" Point)
      const ENTRANCE_COORDS = destinationEntrance;
      
      let externalRoadPath = [];
      let roadDistance = 0;

      // 2. EXTERNAL ROUTE: Fetch real-world road directions via OSRM API
      // We only fetch external roads if the user is outside the cemetery gate (e.g. > 50 meters)
      const distToEntrance = Math.hypot(startCoords[0] - ENTRANCE_COORDS[0], startCoords[1] - ENTRANCE_COORDS[1]) * 111000;
      
      if (distToEntrance > 50) {
        try {
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startCoords[1]},${startCoords[0]};${ENTRANCE_COORDS[1]},${ENTRANCE_COORDS[0]}?overview=full&geometries=geojson`;
          const response = await fetch(osrmUrl, { signal: routeController.signal });
          if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
          if (!response.ok) throw new Error('OSRM API unreachable');
          const data = await response.json();
          if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
          
          if (data.routes && data.routes.length > 0) {
            // OSRM returns coordinates as [lng, lat], Leaflet polyline needs [lat, lng]
            externalRoadPath = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            roadDistance = data.routes[0].distance;
          }
        } catch (e) {
          if (!isMountedRef.current || routeController.signal.aborted || isAbortError(e)) return;
          console.error("Hybrid Routing Error (External):", e);
        }
      }

      const nodes = getRoutingNodes();

      // If we are using external roads, the internal leg begins at the entrance gate.
      // Otherwise, it starts exactly where the user is currently standing.
      let startNodeId = null;
      let minStartDist = Infinity;
      let endNodeId = null;
      let minEndDist = Infinity;

      const internalStartCoords = externalRoadPath.length > 0 ? ENTRANCE_COORDS : startCoords;
      const startPt = [internalStartCoords[1], internalStartCoords[0]];
      const endPt = [targetCoords[1], targetCoords[0]];

      for (const [id, node] of nodes.entries()) {
        const dStart = Math.hypot(node.coord[0] - startPt[0], node.coord[1] - startPt[1]);
        if (dStart < minStartDist) { minStartDist = dStart; startNodeId = id; }

        const dEnd = Math.hypot(node.coord[0] - endPt[0], node.coord[1] - endPt[1]);
        if (dEnd < minEndDist) { minEndDist = dEnd; endNodeId = id; }
      }

      let internalPathLatLngs = [internalStartCoords, targetCoords];
      let internalDistance = 0;

      if (startNodeId !== null && endNodeId !== null) {
        const dists = new Map();
        const prev = new Map();
        const unvisited = new Set();

        for (const id of nodes.keys()) {
          dists.set(id, Infinity);
          unvisited.add(id);
        }
        dists.set(startNodeId, 0);

        while(unvisited.size > 0) {
          let u = null;
          let minD = Infinity;
          for (const id of unvisited) {
            if (dists.get(id) < minD) {
              minD = dists.get(id);
              u = id;
            }
          }

          if (u === null || u === endNodeId) break;
          unvisited.delete(u);

          const uDist = dists.get(u);
          for (const edge of nodes.get(u).edges) {
            if (unvisited.has(edge.to)) {
              const alt = uDist + edge.dist;
              if (alt < dists.get(edge.to)) {
                dists.set(edge.to, alt);
                prev.set(edge.to, u);
              }
            }
          }
        }

        const path = [];
        let curr = endNodeId;
        if (prev.has(curr) || curr === startNodeId) {
          while (curr !== undefined && curr !== null) {
            const c = nodes.get(curr).coord;
            path.unshift([c[1], c[0]]);
            curr = prev.get(curr);
          }
        }

        if (path.length > 0) {
          internalPathLatLngs = [internalStartCoords, ...path, targetCoords];
          for(let i=0; i < internalPathLatLngs.length - 1; i++){
            internalDistance += Math.hypot(internalPathLatLngs[i][0] - internalPathLatLngs[i+1][0], internalPathLatLngs[i][1] - internalPathLatLngs[i+1][1]) * 111000;
          }
        } else {
          internalDistance = Math.hypot(internalStartCoords[0] - targetCoords[0], internalStartCoords[1] - targetCoords[1]) * 111000;
        }
      } else {
        internalDistance = Math.hypot(internalStartCoords[0] - targetCoords[0], internalStartCoords[1] - targetCoords[1]) * 111000;
      }

      // 4. STITCHING: Merge the external road array with our internal graph-calculated path
      const pathLatLngs = [...externalRoadPath, ...internalPathLatLngs]
        .map((coord) => sanitizeLatLng(coord, null))
        .filter(Boolean);
      if (calculationVersion !== routeCalculationVersion || pathLatLngs.length < 2 || !isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
      const totalDistance = roadDistance + internalDistance;

      // 5. DRAWING: Render the combined path as one continuous polyline
      if (routeAnimationFrameRef.current) {
        cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = null;
      }
      if (routeLayerRef.current) {
        try {
          mapRef.current.removeLayer(routeLayerRef.current);
        } catch (_) {
          // Route layer may already be detached during map teardown.
        }
      }

      const outlineLine = L.polyline(pathLatLngs, {
        pane: 'publicNavigationPane',
        interactive: false,
        color: '#73C9A7',
        weight: 12,
        opacity: 0.4,
        lineCap: 'round',
        lineJoin: 'round',
      });

      const coreLine = L.polyline(pathLatLngs, {
        pane: 'publicNavigationPane',
        interactive: false,
        color: '#167154',
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '1, 10',
        dashOffset: '0',
      });

      routeLayerRef.current = L.layerGroup([outlineLine, coreLine]).addTo(mapRef.current);

      let offset = 0;
      const animateDash = () => {
        if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current || !routeLayerRef.current) {
          routeAnimationFrameRef.current = null;
          return;
        }
        offset -= 1;
        try {
          coreLine.setStyle({ dashOffset: offset.toString() });
          routeAnimationFrameRef.current = requestAnimationFrame(animateDash);
        } catch (_) {
          routeAnimationFrameRef.current = null;
        }
      };
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) animateDash();

      const walkingSpeed = 1.4;
      const timeSecs = totalDistance / walkingSpeed;
      const timeMins = Math.ceil(timeSecs / 60);
      if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
      
      setNavStats({ 
        eta: timeMins > 1 ? `${timeMins} min` : '1 min', 
        distance: totalDistance > 1000 ? `${(totalDistance/1000).toFixed(1)} km` : `${Math.round(totalDistance)} m` 
      });

      camera.setRoute(pathLatLngs);

    };

    if (navigationWatchId.current != null) navigator.geolocation?.clearWatch(navigationWatchId.current);
    requestRoutePosition(
        (pos) => {
          if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
          const { latitude, longitude } = pos.coords;
          const currentCoords = sanitizeLatLng([latitude, longitude], defaultStartCoords);
          camera.updateLocation(currentCoords);
          setRouteOrigin('Live location');
          calculateAndDrawRoute(currentCoords, false);

            navigationWatchId.current = navigator.geolocation.watchPosition(
              (watchPos) => {
                if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
                const liveLat = watchPos.coords.latitude;
                const liveLng = watchPos.coords.longitude;
                const heading = watchPos.coords.heading;
                const liveCoords = sanitizeLatLng([liveLat, liveLng], null);
                if (!liveCoords) return;
                camera.updateLocation(liveCoords);
                setRouteOrigin('Live location');
                
                if (!userMarkerRef.current) {
                  userMarkerRef.current = L.marker(liveCoords, {
                    icon: L.divIcon({
                      className: 'user-location-marker',
                      html: `<div class="user-pulse"></div><div class="user-flashlight"></div><div class="user-dot"></div>`,
                      iconSize: [48, 48],
                      iconAnchor: [24, 24]
                    }),
                    zIndexOffset: 1000,
                    interactive: false
                  }).addTo(mapRef.current);
                } else {
                  userMarkerRef.current.setLatLng(liveCoords);
                }

                if (heading !== null && userMarkerRef.current) {
                  const flashlight = userMarkerRef.current.getElement()?.querySelector('.user-flashlight');
                  if (flashlight) flashlight.style.transform = `translate(-50%, -100%) rotate(${heading}deg)`;
                }

                calculateAndDrawRoute(liveCoords, true);
              },
              (err) => {
                if (!isMountedRef.current || routeController.signal.aborted) return;
                console.warn('Watch error:', err);
                camera.loseLocation();
                setRouteOrigin('GPS signal unavailable — showing the last calculated route');
              },
              { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
            );

            if (window.DeviceOrientationEvent) {
              if (orientationHandlerRef.current) {
                window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
                window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
              }
              orientationHandlerRef.current = (event) => {
                if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
                let alpha = null;
                if (event.webkitCompassHeading) {
                  alpha = event.webkitCompassHeading;
                } else if (event.absolute && event.alpha !== null) {
                  alpha = 360 - event.alpha;
                }
                if (alpha !== null && userMarkerRef.current) {
                  const flashlight = userMarkerRef.current.getElement()?.querySelector('.user-flashlight');
                  if (flashlight) {
                    flashlight.style.transform = `translate(-50%, -100%) rotate(${alpha}deg)`;
                  }
                }
              };
              window.addEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
              window.addEventListener('deviceorientation', orientationHandlerRef.current, true);
            }
        },
        (error) => {
          if (!isMountedRef.current || routeController.signal.aborted || !mapRef.current) return;
          setRouteOrigin((isNewDestination ? 'New' : 'Old') + ' cemetery entrance (GPS unavailable)');
          showToast(routeLocationErrorMessage(error) + ' Showing directions from the cemetery entrance.', 'info');
          calculateAndDrawRoute(defaultStartCoords, false);
        },
        { signal: routeController.signal }
    );
  }, [mapRef, addToRecentSearches, showToast, safeFlyTo, showDestinationMarker, newCemeteryGeoJson, savedCemeteryPathways]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setIsGraveDataLoading(true);
    fetchGraves(undefined, { signal: controller.signal })
      .then((data) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        setGraveData(data);
      })
      .catch((err) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        if (isAbortError(err)) return;
        setError(err.message);
      })
      .finally(() => {
        if (isMountedRef.current && !controller.signal.aborted) setIsGraveDataLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [active, authStatus]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!active || !mapIsReady || !mapInstance) return;

    mapInstance.eachLayer((layer) => {
        if (layer.options && layer.options.isGravePlot) {
            layer.setStyle(getPublicPlotStyle());
        }
        if (layer.feature?.geometry?.type === 'Polygon' && layer.feature.properties?.id) {
            layer.setStyle({
              ...getPublicPlotStyle(),
              weight: PUBLIC_GRAVE_PLOT_BORDER_WEIGHT
            });
        }
        if (layer.feature?.geometry?.type === 'Polygon' && layer.feature.properties?.name?.startsWith('Expansion Area')) {
          layer.setStyle({ 
            ...getPublicPlotStyle(),
            weight: PUBLIC_GRAVE_PLOT_BORDER_WEIGHT
          });
        }
    });
    const timeout = setTimeout(() => {
      if (!isMountedRef.current || mapRef.current !== mapInstance) return;
      try {
        mapInstance.invalidateSize();
      } catch (_) {
        // The map container may have been hidden or disposed mid-layout.
      }
    }, 100);
    passiveTimeoutsRef.current.push(timeout);
    return () => {
      clearTimeout(timeout);
      passiveTimeoutsRef.current = passiveTimeoutsRef.current.filter((id) => id !== timeout);
    };
  }, [graveData, active, mapIsReady, columbariumSlots, mapRef, getPublicPlotStyle]);

  const toggleSidebar = () => {
    if (role === 'user') {
      setPubOpen((value) => !value);
      setLandingOpen(false);
    } else {
      setLandingOpen((value) => !value);
      setPubOpen(false);
    }
  };

  const togglePublicFilter = (index) => {
    setPubFilters((current) =>
      current.map((item, idx) =>
        idx === index ? { ...item, active: !item.active } : item
      )
    );
  };

  const handleApplyForPlot = async (grave) => {
    try {
      let updatedGrave;
      const exists = graveData.some(g => g.grave_id === grave.grave_id);
      
      if (exists) {
        updatedGrave = await updateGrave(grave.id, { status: 'reserved' });
        setGraveData((current) => current.map((g) => (g.id === updatedGrave.id ? updatedGrave : g)));
      } else {
        updatedGrave = await createGrave({
          grave_id: grave.grave_id,
          name: '— Available —',
          dates: '-',
          location: grave.location,
          status: 'reserved',
          latitude: grave.latlng ? grave.latlng[0] : 14.48,
          longitude: grave.latlng ? grave.latlng[1] : 120.897,
          notes: 'Auto-generated during application'
        });
        setGraveData(current => [...current, updatedGrave]);
      }
      
      onSelectGrave(updatedGrave);
      showToast(`Successfully submitted application for Grave ${grave.grave_id}. It is now reserved pending review.`);
    } catch (err) {
      showToast(`Failed to apply for plot: ${err.message}`, 'error');
    }
  };

  const handleRecordServiceAction = (action) => {
    showToast(`Initiated: ${action}. This request will be processed by City Planning.`, 'info');
  };

  const handleViewTrackingDetails = (item) => {
    setTrackingModalData(item);
  };

  const handleContactUs = (item) => {
    setContactAppContext(item || null);
    setContactMessage('');
    setIsContactModalOpen(true);
  };

  const handleVisitorGuideJump = useCallback((target) => {
    console.log(`[Visitor Guide] Map jump placeholder: ${target}`);
  }, []);

  const handleCancelApplication = (item) => {
    if (item.type && item.type.includes('Request')) {
      const reason = window.prompt(`Are you sure you want to cancel your transfer request for ${item.deceased}?\n\nPlease enter the reason:`);
      if (reason !== null && reason.trim() !== '') {
        const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
        const updated = msgs.map(m => m.id === item.rawId ? { ...m, resolved: true, message: `${m.message}\n\n[CANCELLED BY USER]: ${reason.trim()}` } : m);
        localStorage.setItem('gravetrak_support_messages', JSON.stringify(updated));
        
        const evt = new Event('storage');
        evt.key = 'gravetrak_support_messages';
        window.dispatchEvent(evt);
        
        showToast('Transfer Request cancelled.', 'info');
        if (trackingModalData && trackingModalData.rawId === item.rawId) setTrackingModalData(null);
        fetchMyApps();
      }
      return;
    }

    const reason = window.prompt(`Are you sure you want to cancel the burial application for ${item.deceased}?\n\nPlease enter the reason for cancellation:`);
    if (reason !== null) {
      if (reason.trim() === '') {
        showToast('A reason is required to cancel the application.', 'error');
        return;
      }
      const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
      statuses[String(item.rawId)] = 'cancelled';
      localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));
      
      const reasons = JSON.parse(localStorage.getItem('gravetrak_demo_reasons') || '{}');
      reasons[String(item.rawId)] = reason.trim();
      localStorage.setItem('gravetrak_demo_reasons', JSON.stringify(reasons));
      
      const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
      logs.unshift({
        id: Date.now(),
        date: new Date().toLocaleString(),
        user: currentUserName || 'Public User',
        action: 'Cancelled Application',
        details: `Cancelled burial application for ${item.deceased}. Reason: ${reason.trim()}`
      });
      localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
      
      const cancelledNotifs = JSON.parse(localStorage.getItem('gravetrak_cancelled_notifs') || '[]');
      cancelledNotifs.unshift({
        id: Date.now(),
        appId: item.id,
        name: item.deceased,
        reason: reason.trim()
      });
      localStorage.setItem('gravetrak_cancelled_notifs', JSON.stringify(cancelledNotifs));
      
      const evt = new Event('storage'); 
      evt.key = 'gravetrak_cancelled_notifs'; 
      window.dispatchEvent(evt);
      
      showToast('Application has been successfully cancelled.', 'info');
      if (trackingModalData && trackingModalData.rawId === item.rawId) {
        setTrackingModalData(null);
      }
      fetchMyApps();
    }
  };

  const panelMeta = {
    'panel-loved-ones': { title: 'My Loved Ones', subtitle: 'Graves saved privately to your account.' },
    'panel-user-dash': {
      title: 'User Dashboard',
      subtitle: 'Welcome to your personal cemetery services portal.',
    },
    'panel-burial-application': {
      title: 'Burial Application',
      subtitle: 'Begin a new burial request and track submission steps.',
    },
    'panel-application-tracking': {
      title: 'Application Tracking',
      subtitle: 'Monitor your active requests and approvals in real time.',
    },
    'panel-settings': {
      title: 'Settings',
      subtitle: 'Manage your account, notifications, appearance, and security.',
    },
  };

  const cemeteryOverview = [
    { label: 'Available plots', value: '142', accent: 'var(--emerald)' },
    { label: 'Occupied plots', value: '318', accent: 'var(--red)' },
    { label: 'Open applications', value: '7', accent: 'var(--accent)' },
  ];

  const isUser = role === 'user';
  const isOfficeViewer = signedIn && ['staff', 'admin', 'mayor', 'planning'].includes(role);
  const isPageActive = Boolean(activePanel);
  // Desktop users get the same persistent navigation pattern as office dashboards.
  // On mobile, the compact sidebar remains toggleable.
  const isSidebarOpen = isUser && (!isMobile || pubOpen);
  const currentPanelMeta = panelMeta[activePanel] || {};
  const activeNavigationDestination = routeDestination || selectedGrave;

  const unreadCount = notifications.filter(item => !item.read).length;
  const burialTrackerSteps = ['Submitted', 'Document Review', 'Scheduled Interview', 'Approved & Assigned'];
  const getBurialTrackerStep = (status, assignmentLocation = '') => {
    const safeStatus = String(status || '').toLowerCase();
    if (assignmentLocation) return 4;
    if (['fully_approved', 'slot_assigned', 'scheduled', 'completed'].includes(safeStatus)) return 4;
    if (['approved', 'for_interview'].includes(safeStatus)) return 3;
    if (['pending_review', 'review', 'action_required'].includes(safeStatus)) return 2;
    if (['pending', 'submitted'].includes(safeStatus)) return 1;
    return 1;
  };
  const formatSubmittedDate = (dateValue) => {
    if (!dateValue) return 'Recently submitted';
    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) return String(dateValue);
    return parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className={`screen ${active ? 'active' : ''} ${isUser ? 'user-logged-in' : 'is-guest'} ${isNavigating ? 'is-navigating' : ''} ${isSidebarOpen ? 'sidebar-open' : ''} ${isPageActive ? 'has-active-page' : ''} ${selectedGrave ? 'has-selected-grave' : ''}`} id="screen-public" data-text-size={isUser ? appearance?.preferences.text_size || 'standard' : 'standard'} data-contrast={isUser && appearance?.preferences.high_contrast ? 'high' : 'normal'}>
      <style>{`
        [data-theme='light'] {
          --bg-base: #ffffff;
          --bg-surface: #ffffff;
          --bg-card: #f8fafc;
          --border: #e2e8f0;
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --text-muted: #64748b;
          --accent: #1687C9;
          --accent-light: #5BB5E8;
          --red: #ce1126;
          --emerald: #104ec2;
          --amber: #ef4444;
          --violet: #002d86;
        }
        .dashboard-tracker-panel {
          display: grid;
          gap: 14px;
          padding: 18px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }
        .dashboard-tracker-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .dashboard-tracker-list {
          display: grid;
          gap: 12px;
        }
        .application-tracker-card {
          display: grid;
          grid-template-columns: minmax(170px, 0.85fr) minmax(320px, 1.4fr) auto;
          gap: 18px;
          align-items: center;
          padding: 16px;
          background: rgba(255,255,255,.03);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        }
        .application-tracker-meta {
          min-width: 0;
        }
        .application-tracker-id {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .7px;
          text-transform: uppercase;
          color: var(--accent-light);
          margin-bottom: 8px;
        }
        .application-tracker-name {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .application-tracker-date {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 6px;
        }
        .application-stepper {
          display: grid;
          grid-template-columns: repeat(4, minmax(72px, 1fr));
          align-items: start;
        }
        .application-stepper-item {
          position: relative;
          display: grid;
          justify-items: center;
          gap: 7px;
          color: var(--text-muted);
          text-align: center;
          min-width: 0;
        }
        .application-stepper-item::before,
        .application-stepper-item::after {
          content: '';
          position: absolute;
          top: 13px;
          height: 3px;
          background: rgba(148,163,184,.25);
          width: 50%;
          z-index: 0;
        }
        .application-stepper-item::before {
          left: 0;
        }
        .application-stepper-item::after {
          right: 0;
        }
        .application-stepper-item:first-child::before,
        .application-stepper-item:last-child::after {
          display: none;
        }
        .application-stepper-item.is-complete::before,
        .application-stepper-item.is-complete::after,
        .application-stepper-item.is-current::before {
          background: var(--accent);
        }
        .application-step-dot {
          position: relative;
          z-index: 1;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: rgba(148,163,184,.18);
          border: 1px solid rgba(148,163,184,.28);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 800;
        }
        .application-stepper-item.is-complete .application-step-dot,
        .application-stepper-item.is-current .application-step-dot {
          background: var(--accent);
          border-color: transparent;
          color: #fff;
          box-shadow: 0 0 0 4px rgba(25,135,101,.1);
        }
        .application-step-label {
          font-size: 10px;
          font-weight: 700;
          line-height: 1.25;
          color: inherit;
          overflow-wrap: anywhere;
        }
        .application-stepper-item.is-complete,
        .application-stepper-item.is-current {
          color: var(--text-primary);
        }
        .application-tracker-actions {
          display: flex;
          justify-content: flex-end;
        }
        .dashboard-tracker-empty {
          padding: 24px 18px;
          text-align: center;
          color: var(--text-muted);
          background: rgba(255,255,255,.02);
          border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
          font-size: 12px;
        }
        .leaflet-control-attribution { display: none !important; }
        /* Google Maps Style UI Overrides */
        .public-map-overlay {
          position: absolute !important;
          bottom: 30px !important;
          left: 20px !important;
          top: auto !important;
          background: rgba(15, 22, 41, 0.88) !important;
          backdrop-filter: blur(24px) !important;
          -webkit-backdrop-filter: blur(24px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 16px !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
          padding: 16px !important;
          z-index: 1001 !important;
        }
        .legend-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px 16px;
          max-height: 180px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .map-legend .legend-title {
          font-size: 12px !important;
          font-weight: 700 !important;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-primary) !important;
          margin-bottom: 12px !important;
        }
        .map-legend .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
        }
        .map-legend .color-key {
          border-radius: 50% !important;
          width: 10px !important;
          height: 10px !important;
        }
        .map-action-pill {
          position: absolute !important;
          top: 140px !important;
          right: 16px !important;
          display: flex;
          flex-direction: column;
          background: rgba(15, 22, 41, 0.88) !important;
          backdrop-filter: blur(24px) !important;
          -webkit-backdrop-filter: blur(24px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 24px !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
          z-index: 1001 !important;
          overflow: hidden;
        }
        .map-action-pill .pill-btn {
          width: 40px !important;
          height: 40px !important;
          background: transparent !important;
          color: var(--text-primary) !important;
          border: none !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease !important;
        }
        .map-action-pill .pill-btn:last-child {
          border-bottom: none !important;
        }
        .map-action-pill .pill-btn:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: var(--accent-light) !important;
        }
        .map-action-pill .pill-btn:active {
          background: var(--accent) !important;
          color: #ffffff !important;
        }
        .hamburger-fab {
          position: absolute !important;
          top: 16px !important;
          left: 16px !important;
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1) !important;
          z-index: 1001 !important;
          width: 48px !important;
          height: 48px !important;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .hamburger-icon {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .hamburger-icon-line {
          width: 22px;
          height: 3px;
          background: var(--text-primary);
          border-radius: 2px;
        }
        .search-fab {
          position: absolute !important;
          top: 16px !important;
          left: 80px !important;
          transform: translateX(0) !important;
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 28px !important;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1) !important;
          z-index: 1001 !important;
          width: calc(100% - 96px) !important;
          max-width: 460px !important;
          display: flex;
          align-items: center;
          padding: 0 6px 0 16px !important;
          height: 52px !important;
          cursor: text;
          transition: left 0.3s ease, transform 0.3s ease, width 0.3s ease !important;
        }
        .search-fab.centered {
          left: 50% !important;
          transform: translateX(-50%) !important;
          width: 90% !important;
        }
        .search-fab svg {
          width: 20px;
          height: 20px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        .search-fab input {
          border: none;
          background: transparent;
          width: 100%;
          height: 100%;
          outline: none;
          color: var(--text-primary);
          font-size: 16px;
          margin-left: 12px;
          margin-right: 12px;
          flex: 1;
          min-width: 0;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (min-width: 769px) {
          #screen-public.user-logged-in.sidebar-open .pub-sidebar:not(.landing-sidebar) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            bottom: 0 !important;
            width: 280px !important;
            transform: none !important;
            z-index: 1100 !important;
          }
          #screen-public.user-logged-in.sidebar-open .pub-page {
            inset: 72px 24px 24px 324px !important;
            max-width: calc(100% - 324px) !important;
          }
          #screen-public.user-logged-in.sidebar-open .search-fab.is-user-search:not(.centered) {
            left: 304px !important;
            width: min(460px, calc(100% - 328px)) !important;
          }
        }
        @media (max-width: 768px) {
          .hamburger-fab, .landing-topbar .topbar-left {
            display: none !important;
          }
          .public-map-overlay {
            bottom: 280px !important;
            left: 16px !important;
            padding: 12px !important;
            width: auto !important;
            max-width: 240px !important;
            z-index: 10001 !important;
          }
          .legend-grid {
            gap: 6px 12px;
            max-height: 140px;
          }
          .map-action-pill {
            top: 76px !important;
            right: 12px !important;
            z-index: 10001 !important;
          }
          .map-action-pill .pill-btn {
            width: 36px !important;
            height: 36px !important;
          }
          .map-legend .legend-title {
            font-size: 11px !important;
          }
          .map-legend .legend-item {
            font-size: 11px !important;
          }
          .search-fab {
            top: 12px !important;
            left: 12px !important;
            width: calc(100% - 24px) !important;
            height: 52px !important;
            padding: 0 6px 0 16px !important;
          }
          .pub-sidebar:not(.landing-sidebar) {
            position: fixed !important;
            top: auto !important;
            bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
            left: 16px !important;
            width: calc(100% - 32px) !important;
            height: 72px !important;
            max-width: 100vw !important;
            transform: none !important;
            z-index: 10000 !important;
            background: rgba(15, 22, 41, 0.88) !important;
            backdrop-filter: blur(24px) !important;
            -webkit-backdrop-filter: blur(24px) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            display: flex !important;
            flex-direction: row !important;
            opacity: 1 !important;
            padding: 0 !important;
            border-radius: 24px !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
            visibility: visible !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-sidebar-head, 
          .pub-sidebar:not(.landing-sidebar) .pub-sidebar-footer {
            display: none !important;
          }
          .pub-sidebar:not(.landing-sidebar) .sidebar-scroll {
            flex-direction: row !important;
            padding: 0 4px !important;
            width: 100% !important;
            height: 100% !important;
            align-items: center !important;
            justify-content: space-between !important;
            overflow: visible !important;
            gap: 2px !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item {
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
            padding: 8px 2px !important;
            text-align: center !important;
            height: 100% !important;
            border-radius: 8px !important;
            white-space: nowrap !important;
            flex: 1 1 0 !important;
            min-width: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            color: var(--text-muted) !important;
            border: none !important;
            position: relative !important;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.active {
            color: var(--accent-light) !important;
            background: transparent !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.active .nav-icon {
            background: rgba(25, 135, 101, 0.15) !important;
            transform: translateY(-2px) !important;
            filter: drop-shadow(0 4px 12px rgba(25, 135, 101, 0.4)) !important;
            color: var(--accent-light) !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.map-nav-item .nav-icon {
            background: var(--accent) !important;
            color: #ffffff !important;
            width: 48px !important;
            height: 48px !important;
            border-radius: 50% !important;
            box-shadow: 0 4px 12px rgba(25, 135, 101, 0.4) !important;
            transform: translateY(-12px) !important;
            border: 4px solid rgba(15, 22, 41, 1) !important;
            filter: none !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.map-nav-item.active .nav-icon {
            transform: translateY(-16px) scale(1.05) !important;
            box-shadow: 0 8px 20px rgba(25, 135, 101, 0.6) !important;
            filter: none !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.map-nav-item .nav-label {
            transform: translateY(-10px) !important;
          }
          .pub-sidebar:not(.landing-sidebar) .nav-content-wrapper {
            flex-direction: column !important;
            gap: 3px !important;
            width: 100% !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .pub-sidebar:not(.landing-sidebar) .nav-icon {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 46px !important;
            height: 28px !important;
            margin-bottom: 0 !important;
            border-radius: 14px !important;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
          .pub-sidebar:not(.landing-sidebar) .nav-label {
            font-size: 9px !important;
            display: block !important;
            letter-spacing: -0.2px !important;
            font-weight: 600 !important;
            transition: all 0.4s ease !important;
            text-overflow: ellipsis !important;
            overflow: hidden !important;
            width: 100% !important;
            text-align: center !important;
          }
          .pub-sidebar:not(.landing-sidebar) .pub-nav-item.active .nav-label {
            font-size: 10px !important;
            font-weight: 800 !important;
            color: #ffffff !important;
          }
          .pub-sidebar:not(.landing-sidebar) .nav-badge {
            position: absolute !important;
            top: 4px !important;
            right: 50% !important;
            margin-right: -22px !important;
            padding: 2px 5px !important;
            font-size: 9px !important;
            border-radius: 10px !important;
            border: 2px solid rgba(15, 22, 41, 0.9) !important;
            background: var(--red) !important;
            color: white !important;
            z-index: 2 !important;
          }
          .hamburger-fab.mobile-hide {
            display: none !important;
          }
          .pub-page {
            padding-bottom: 110px !important;
          }
        }
        .service-card {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .service-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          border-color: var(--accent) !important;
        }
        /* Panel responsiveness: dashboard and panel grids inside .pub-page */
        .pub-page .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
        }
        .pub-page .panel-grid {
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: 20px;
          align-items: start;
        }
        .pub-page .panel-card,
        .pub-page .service-card,
        .pub-page .plot-distribution-card {
          width: 100% !important;
          min-width: 0 !important;
        }
        @media (max-width: 1100px) {
          .application-tracker-card {
            grid-template-columns: 1fr;
            align-items: stretch;
          }
          .application-tracker-actions {
            justify-content: flex-start;
          }
          .pub-page .panel-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 768px) {
          .dashboard-tracker-panel {
            padding: 14px;
          }
          .dashboard-tracker-header {
            flex-direction: column;
          }
          .application-tracker-card {
            padding: 14px;
            gap: 16px;
          }
          .application-stepper {
            grid-template-columns: repeat(4, minmax(58px, 1fr));
            overflow-x: auto;
            padding-bottom: 4px;
          }
          .application-step-label {
            font-size: 9px;
          }
        }
        @keyframes bellRing {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(15deg); }
          30% { transform: rotate(-10deg); }
          45% { transform: rotate(5deg); }
          60% { transform: rotate(-5deg); }
          75% { transform: rotate(0); }
        }
        .bell-ring-anim {
          animation: bellRing 2s infinite ease-in-out;
          transform-origin: top center;
        }
        .notification:hover svg {
          animation: bellRing 1s ease 1;
          transform-origin: top center;
        }
      `}</style>
      {toast.show && (
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: toast.type === 'success' ? 'var(--emerald)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          zIndex: 100020,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontWeight: 600,
          fontSize: 14,
          pointerEvents: 'none',
          animation: 'slideDown 0.3s ease'
        }}>
          <span style={{ fontSize: 18 }}>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠' : 'ℹ'}</span>
          {toast.message}
        </div>
      )}
      <div className="landing-topbar" style={{ display: isUser ? 'none' : 'flex' }}>
        <div className="topbar-left">
          <div className="hamburger-fab" style={{ display: landingOpen ? 'none' : 'flex' }} onClick={toggleSidebar}>
            <div className="hamburger-icon">
              <div className="hamburger-icon-line" />
              <div className="hamburger-icon-line" />
              <div className="hamburger-icon-line" />
            </div>
          </div>
        </div>
        <div className="topbar-center">
          <div className="search-container map-fab" onClick={() => setLandingSearchOpen(true)} style={{ position: 'relative' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              aria-label="Search by name, grave ID, or section" placeholder={isMobile ? "Search graves..." : "Search by name, grave ID, or section..."}
              value={pubSearchQuery}
              onChange={(e) => {
                setPubSearchQuery(e.target.value);
                setLandingSearchOpen(true);
              }}
              onFocus={() => setLandingSearchOpen(true)}
            />
            <div className="search-dropdown" style={{ display: landingSearchOpen && (pubSearchQuery.trim() || recentSearches.length > 0) ? 'block' : 'none', position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 10000, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
              {!pubSearchQuery.trim() && recentSearches.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="legend-title" style={{ margin: 0 }}>Recent Searches</div>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px', height: 'auto', minHeight: 'unset' }} onClick={(e) => {
                      e.stopPropagation();
                      setRecentSearches([]);
                      localStorage.removeItem('gravetrak_recent_searches');
                    }}>Clear</button>
                  </div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {recentSearches.map((item, idx) => (
                      <div key={idx} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(128,128,128,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} onClick={(e) => {
                        e.stopPropagation();
                        handleSearchResultSelect(item);
                        setLandingSearchOpen(false);
                        setPubSearchQuery('');
                      }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>🕒</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.grave_id || item.id}</div>
                        </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px', minHeight: 'unset', height: 'auto', color: 'var(--text-muted)', fontSize: 12 }} onClick={(e) => removeRecentSearch(e, item.id)} title="Remove">✕</button>
                    </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {pubSearchQuery.trim() && (
                <div style={{ marginBottom: 12 }}>
                  <div className="legend-title">Search Results</div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {searchResults.length > 0 ? searchResults.map((res, idx) => (
                      <div key={idx} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(128,128,128,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} onClick={(e) => {
                        e.stopPropagation();
                      handleSearchResultSelect(res);
                        setLandingSearchOpen(false);
                        setPubSearchQuery('');
                      }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: res.status === 'occupied' ? 'rgba(239,68,68,0.15)' : res.status === 'reserved' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: res.status === 'occupied' ? 'var(--red)' : res.status === 'reserved' ? 'var(--amber)' : 'var(--emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                          {res.status === 'occupied' ? '🪦' : res.status === 'reserved' ? '⏳' : '✨'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(res.status === 'occupied' && res.name && res.name !== '— Available —') ? res.name : (res.status === 'reserved' ? 'Reserved Slot' : 'Available Slot')}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{res.grave_id || res.id} • {res.location || (res._isCol ? 'Columbarium' : 'Grave Plot')}</div>
                        </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: res.status === 'occupied' ? 'rgba(239,68,68,0.1)' : res.status === 'reserved' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: res.status === 'occupied' ? 'var(--red)' : res.status === 'reserved' ? 'var(--amber)' : 'var(--emerald)' }}>
                        {res.status.toUpperCase()}
                      </div>
                    </div>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px' }}>No results found.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="topbar-right">
          {!isUser ? (
            <button className="btn btn-primary" onClick={isOfficeViewer ? onShowOfficeDashboard : onShowAuth}>{isOfficeViewer ? (role === 'staff' || role === 'admin' ? 'Back to Staff Dashboard' : 'Back to Office Dashboard') : 'Login'}</button>
          ) : null}
          <button 
            className="btn btn-ghost btn-sm" 
            onClick={onToggleTheme}
            style={{ marginLeft: 12 }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
          {isUser ? (
            <button className="btn btn-ghost" onClick={onLogout} style={{ marginLeft: 12 }}>
              Logout
            </button>
          ) : null}
          {isUser ? (
            <div className="txt-sm" style={{ color: 'var(--text-primary)', fontWeight: 600, marginLeft: 12 }}>
              Welcome, {currentUserInfo.name}
            </div>
          ) : null}
        </div>
      </div>

      {isUser && isMobile ? (
        <div className="hamburger-fab" style={{ display: !pubOpen && (!isMobile || !isPageActive) ? 'flex' : 'none' }} onClick={toggleSidebar}>
          <div className="hamburger-icon">
            <div className="hamburger-icon-line" />
            <div className="hamburger-icon-line" />
            <div className="hamburger-icon-line" />
          </div>
        </div>
      ) : null}

      {isNavigating && navStats && activeNavigationDestination && (
        <>
          <div className="nav-header-overlay">
            <button
              type="button"
              className="gp-close"
              onClick={() => stopNavigation({ clearSelection: true })}
              aria-label="Exit directions"
              title="Exit directions"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 2,
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: 'white',
                fontSize: 16,
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
            <div className="nav-dots"></div>
            <div className="nav-input-row" style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '3px solid #4285F4', background: 'transparent', flexShrink: 0 }}></div>
              <input type="text" readOnly value={routeOrigin} />
            </div>
            <div className="nav-input-row" style={{ position: 'relative', zIndex: 1, paddingRight: 32 }}>
              <div style={{ fontSize: 16, flexShrink: 0, marginLeft: '-1px' }}>📍</div>
              <input 
                type="text" 
                readOnly 
                value={activeNavigationDestination.name && activeNavigationDestination.name !== '— Available —' && activeNavigationDestination.name !== 'Multi-level Plot' ? `${activeNavigationDestination.name}` : (activeNavigationDestination.location || activeNavigationDestination.grave_id || activeNavigationDestination.id)} 
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 36, marginTop: '-6px' }}>
              Destination: {activeNavigationDestination.location || activeNavigationDestination.grave_id || activeNavigationDestination.id}
            </div>
          </div>
          
          <div className="live-nav-overlay">
            <div>
              <div className="nav-eta-text">{navStats.eta}</div>
              <div className="nav-origin-text">{routeOrigin}</div>
              <div className="nav-dist-text">{navStats.distance} <span style={{fontSize: 12, fontWeight: 'normal', opacity: 0.8}}>• Walking</span></div>
            </div>
            <button className="nav-stop-btn" onClick={() => stopNavigation({ clearSelection: true })}>✕ Exit</button>
            <div className="route-camera-actions">
              <div className="route-camera-hint" aria-live="polite">
                {!routeCameraState.ready ? 'Calculating your walking route…' : routeCameraState.mode === 'following' ? 'Following your location. Drag the map to explore.' : routeCameraState.hasLocation ? 'Preview the route, then start when you are ready.' : 'Route preview only. Live location is unavailable.'}
              </div>
              {routeCameraState.hasLocation ? (
                <button className="btn btn-primary" disabled={!routeCameraState.ready || routeCameraState.mode === 'following'} onClick={() => routeCameraRef.current?.start()}>
                  {routeCameraState.mode === 'following' ? 'Following location' : routeCameraState.started ? 'Balik sa lokasyon ko' : 'Simulan ang paglalakad'}
                </button>
              ) : <button className="btn btn-primary" disabled={!routeCameraState.ready} onClick={() => routeCameraRef.current?.startPoint()}>Tingnan ang simula</button>}
              <button className="btn btn-ghost" disabled={!routeCameraState.ready} onClick={() => routeCameraRef.current?.overview()}>Buong ruta</button>
            </div>
          </div>
        </>
      )}

      <div id="public-map" ref={mapContainerRef} style={{ display: isPageActive || isMapDataLoading ? 'none' : 'block' }} />
      {isMapDataLoading && !isPageActive ? (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-surface)', color: 'var(--text-secondary)', zIndex: 5 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 34, height: 34, border: '3px solid rgba(25,135,101,.18)', borderLeftColor: 'var(--accent)', borderRadius: '50%', animation: 'appSpin 1s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Loading map data...</div>
          </div>
        </div>
      ) : null}
      <div className="cemetery-switcher-fab">
        <button
          type="button"
          className="btn btn-xs"
          onClick={() => { stopNavigation({ clearSelection: true, restoreView: false }); switchCemetery('Old Cemetery', CEMETERY_CENTER); }}
        >
          Old Cemetery
        </button>
        <button
          type="button"
          className="btn btn-xs"
          onClick={() => { stopNavigation({ clearSelection: true, restoreView: false }); switchCemetery('New Cemetery', ANOTHER_CEMETERY_CENTER); }}
        >
          New Cemetery
        </button>
      </div>
      {cemeteryTransition && !isPageActive && (
        <div className="cemetery-transition" role="status" aria-live="polite" aria-busy={!cemeteryTransition.failed}>
          <div className="cemetery-transition-card">
            {!cemeteryTransition.failed && <span className="cemetery-transition-spinner" aria-hidden="true" />}
            <strong>{cemeteryTransition.failed ? 'Map is taking longer to load' : `Opening ${cemeteryTransition.name}`}</strong>
            <p>{cemeteryTransition.failed ? 'Some map tiles are still loading. You can continue viewing the map.' : 'Preparing the cemetery map and locations…'}</p>
            {cemeteryTransition.failed && <button className="btn btn-primary" onClick={dismissTransition}>View map</button>}
          </div>
        </div>
      )}
      <style>{`
        .cemetery-switcher-fab {
          position: absolute;
          top: 80px;
          right: 70px;
          z-index: 1001;
          display: flex;
          gap: 8px;
        }
        .cemetery-switcher-fab button {
          min-width: 88px;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(0,0,0,0.12);
          background: rgba(255,255,255,0.95);
          color: #111;
          cursor: pointer;
          font-weight: 700;
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
        }
        .cemetery-switcher-fab button.active {
          background: #167154;
          border-color: #146B50;
          color: #fff;
        }
        .cemetery-switcher-fab button:hover {
          transform: translateY(-1px);
        }
        .user-location-marker {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .user-dot {
          width: 16px;
          height: 16px;
          background: #4285F4;
          border: 3px solid white;
          border-radius: 50%;
          position: relative;
          z-index: 3;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        }
        .user-pulse {
          width: 48px;
          height: 48px;
          background: rgba(66, 133, 244, 0.4);
          border-radius: 50%;
          position: absolute;
          z-index: 2;
          animation: userPulseAnim 2s infinite cubic-bezier(0.4, 0, 0.2, 1);
        }
        .user-flashlight {
          width: 0;
          height: 0;
          border-left: 30px solid transparent;
          border-right: 30px solid transparent;
          border-top: 60px solid rgba(66, 133, 244, 0.25);
          position: absolute;
          top: 50%;
          left: 50%;
          transform-origin: bottom center;
          transform: translate(-50%, -100%) rotate(0deg);
          border-radius: 50% 50% 0 0;
          z-index: 1;
          filter: blur(2px);
          transition: transform 0.1s ease-out;
        }
        @keyframes userPulseAnim {
          0% { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .nav-header-overlay {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          max-width: 400px;
          background: rgba(15, 22, 41, 0.95);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
          z-index: 100000;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          flex-direction: column;
          gap: 12px;
          animation: slideDown 0.3s ease;
        }
        .nav-input-row {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255,255,255,0.05);
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .nav-input-row input {
          background: transparent;
          border: none;
          color: white;
          font-size: 14px;
          font-weight: 600;
          width: 100%;
          outline: none;
          text-overflow: ellipsis;
        }
        .nav-dots {
          position: absolute;
          left: 36px;
          top: 50px;
          bottom: 50px;
          width: 3px;
          background: rgba(255,255,255,0.3);
          z-index: 0;
        }
        .live-nav-overlay {
          position: absolute;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 22, 41, 0.95);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 12px 24px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
          z-index: 100000;
          display: flex;
          align-items: center;
          gap: 20px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          color: white;
          animation: slideUp 0.3s ease;
        }
        .nav-eta-text {
          font-size: 22px;
          font-weight: 800;
          color: #10b981;
          line-height: 1.2;
        }
        .nav-dist-text {
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.7);
        }
        .nav-stop-btn {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
          padding: 8px 16px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .nav-stop-btn:hover {
          background: #ef4444;
          color: white;
        }
        @keyframes slideUp {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @media (max-width: 768px) {
          .nav-header-overlay {
            top: max(16px, env(safe-area-inset-top, 16px));
          }
          .live-nav-overlay {
            bottom: 120px;
            width: 90%;
            max-width: 350px;
            justify-content: space-between;
          }
        }
      `}</style>

      {isUser ? (
        <div className={`search-fab is-user-search ${pubOpen ? 'centered' : ''}`} style={{ display: isPageActive ? 'none' : 'flex' }} onClick={(e) => {
          if (!e.target.closest('.search-right-controls') && !e.target.closest('.search-dropdown')) {
            setPubSearchOpen(true);
            setNotifOpen(false);
            setProfileOpen(false);
          }
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            aria-label="Search by name, grave ID, or section" placeholder={isMobile ? "Search graves..." : "Search by name, grave ID, or section..."}
            value={pubSearchQuery}
            onChange={(e) => {
              setPubSearchQuery(e.target.value);
              setPubSearchOpen(true);
              setNotifOpen(false);
              setProfileOpen(false);
            }}
            onFocus={() => {
              setPubSearchOpen(true);
              setNotifOpen(false);
              setProfileOpen(false);
            }}
          />
          
          <div className="search-right-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '100%', padding: '4px 0' }}>
            <div className="notification" ref={notifRef} onClick={(e) => { e.stopPropagation(); setNotifOpen((v) => !v); setProfileOpen(false); setPubSearchOpen(false); }} title="Notifications" style={{ position: 'relative', cursor: 'pointer', width: 38, height: 38, borderRadius: '50%', background: 'transparent', color: 'var(--text-secondary)', transition: 'background 0.2s ease, color 0.2s ease' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(128,128,128,0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg className={unreadCount > 0 ? "bell-ring-anim" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ display: 'block' }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </div>
              {unreadCount > 0 && <span className="notif-badge" style={{ position: 'absolute', top: 0, right: 0, padding: '3px 6px', fontSize: 10, fontWeight: 800, background: 'var(--red)', color: '#fff', borderRadius: '12px', border: '2px solid var(--bg-surface)', minWidth: 18, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxShadow: '0 2px 6px rgba(239, 68, 68, 0.5)' }}>{unreadCount}</span>}
              
              {notifOpen && (
                <div className="dropdown-menu user-notification-menu" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: -10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: 280, zIndex: 100, padding: 12, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', flexShrink: 0, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</span>
                    {unreadCount > 0 ? (
                      <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', padding: '2px 6px', borderRadius: 10 }}>{unreadCount} new</span>
                    ) : (
                      <span style={{ fontSize: 10, background: 'rgba(255,255,255,.05)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 10 }}>Up to date</span>
                    )}
                  </div>
                  <div className="user-notification-list" role="region" aria-label="Notifications" tabIndex={0}>
                    {notificationError && <div role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>{notificationError}</div>}
                    {notifications.length ? notifications.map(item => (
                      <div key={item.id} style={{ padding: 10, background: !item.read ? 'rgba(25,135,101,.08)' : 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                        <button className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal' }} onClick={async (event) => {
                          event.stopPropagation();
                          try {
                            const updated = await markNotificationRead(item.id);
                            setNotifications(current => current.map(n => n.id === item.id ? updated : n));
                            if (item.application) {
                              setActivePanel('panel-application-tracking');
                              const target = displayTrackingItems.find(row => String(row.rawId) === String(item.application));
                              if (target) setTrackingModalData(target);
                            }
                            setNotifOpen(false);
                          } catch (error) { showToast(error.message, 'error'); }
                        }}>
                          <strong>{!item.read && '● '}{item.title}</strong>
                          <div style={{ fontSize: 12, marginTop: 5 }}>{item.message}</div>
                          <small>{new Date(item.created_at).toLocaleString()}</small>
                        </button>
                        {!item.read && <button className="btn btn-ghost btn-sm" onClick={async (event) => {
                          event.stopPropagation();
                          try {
                            const updated = await markNotificationRead(item.id);
                            setNotifications(current => current.map(n => n.id === item.id ? updated : n));
                          } catch (error) { showToast(error.message, 'error'); }
                        }}>Mark as read</button>}
                      </div>
                    )) : !notificationError && <div style={{ padding: 16, fontSize: 12 }}>No recent updates</div>}
                  </div>
                </div>
              )}
            </div>
            
            <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px', opacity: 0.6 }}></div>
            
            <div style={{ position: 'relative', paddingLeft: '2px' }} ref={profileRef} onClick={(e) => e.stopPropagation()}>
              <div className="profile" onClick={(e) => { e.stopPropagation(); setProfileOpen((v) => !v); setNotifOpen(false); setPubSearchOpen(false); }} style={{ cursor: 'pointer', transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: '2px solid var(--bg-surface)', boxShadow: '0 2px 8px rgba(22, 135, 201, 0.3)' }}>{currentUserInfo.av}</div>
              </div>
              {profileOpen && (
                <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: 220, zIndex: 100, padding: 8 }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{currentUserInfo.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{currentUserInfo.role}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <button className="btn btn-ghost" onClick={() => { setProfileOpen(false); onShowLanding(); }}>Visit Homepage</button>
                    <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '8px 12px', fontSize: 12, width: '100%' }} onClick={() => { setActivePanel('panel-settings'); setProfileOpen(false); }}>Profile Settings</button>
                    <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '8px 12px', fontSize: 12, width: '100%', color: 'var(--red)' }} onClick={() => { setProfileOpen(false); onLogout(); }}>Logout</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="search-dropdown" style={{ display: pubSearchOpen && (pubSearchQuery.trim() || recentSearches.length > 0) ? 'block' : 'none', position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 10000, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            {!pubSearchQuery.trim() && recentSearches.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="legend-title" style={{ margin: 0 }}>Recent Searches</div>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px', height: 'auto', minHeight: 'unset' }} onClick={(e) => {
                    e.stopPropagation();
                    setRecentSearches([]);
                    localStorage.removeItem('gravetrak_recent_searches');
                  }}>Clear</button>
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {recentSearches.map((item, idx) => (
                    <div key={idx} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(128,128,128,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} onClick={(e) => {
                      e.stopPropagation();
                        handleSearchResultSelect(item);
                      setPubSearchOpen(false);
                      setPubSearchQuery('');
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>🕒</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.grave_id || item.id}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button className="btn btn-ghost" style={{ padding: '4px 8px', minHeight: 'unset', height: 'auto', color: 'var(--text-muted)', fontSize: 12 }} onClick={(e) => removeRecentSearch(e, item.id)} title="Remove">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pubSearchQuery.trim() && (
              <div style={{ marginBottom: 12 }}>
                <div className="legend-title">Search Results</div>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {searchResults.length > 0 ? searchResults.map((res, idx) => (
                    <div key={idx} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(128,128,128,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} onClick={(e) => {
                      e.stopPropagation();
                      handleSearchResultSelect(res);
                      setPubSearchOpen(false);
                      setPubSearchQuery('');
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: res.status === 'occupied' ? 'rgba(239,68,68,0.15)' : res.status === 'reserved' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: res.status === 'occupied' ? 'var(--red)' : res.status === 'reserved' ? 'var(--amber)' : 'var(--emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                        {res.status === 'occupied' ? '🪦' : res.status === 'reserved' ? '⏳' : '✨'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(res.status === 'occupied' && res.name && res.name !== '— Available —') ? res.name : (res.status === 'reserved' ? 'Reserved Slot' : 'Available Slot')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{res.grave_id || res.id} • {res.location || (res._isCol ? 'Columbarium' : 'Grave Plot')}</div>
                      </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: res.status === 'occupied' ? 'rgba(239,68,68,0.1)' : res.status === 'reserved' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: res.status === 'occupied' ? 'var(--red)' : res.status === 'reserved' ? 'var(--amber)' : 'var(--emerald)' }}>
                        {res.status.toUpperCase()}
                      </div>
                    </div>
                    </div>
                  )) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px' }}>No results found.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="map-action-pill">
        <button className="pill-btn compass-btn" onClick={() => {
          safeFlyTo(CEMETERY_CENTER, 18, { duration: 0.8 });
        }} title="Reset Map View">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="#ef4444" d="M12 2 L8 12 L12 12 Z" />
            <path fill="#dc2626" d="M12 2 L16 12 L12 12 Z" />
            <path fill="#9ca3af" d="M12 22 L8 12 L12 12 Z" />
            <path fill="#6b7280" d="M12 22 L16 12 L12 12 Z" />
          </svg>
        </button>
        <button className="pill-btn location-btn" onClick={() => {
          if (!mapRef.current) return;
          if (!navigator.geolocation) {
            showToast('Geolocation is not supported by your browser.', 'error');
            return;
          }
          navigator.geolocation.getCurrentPosition((position) => {
            const locationCoords = sanitizeLatLng([position.coords.latitude, position.coords.longitude], null);
            if (!locationCoords) {
              showToast('Unable to determine location. Please try again.', 'error');
              return;
            }
            safeFlyTo(locationCoords, 17, { duration: 0.9 });
            L.circle(locationCoords, {
              radius: 60,
              color: 'rgba(25,135,101,0.8)',
              fillColor: 'rgba(25,135,101,0.18)',
              weight: 2,
            }).addTo(mapRef.current);
          }, () => {
            showToast('Unable to determine location. Please allow location access.', 'error');
          }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
        }} title="My location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className={`pub-sidebar landing-sidebar ${landingOpen ? 'open' : ''}`}>
        <div className="pub-sidebar-head">
          <div className="pub-sidebar-brand">
            <div className="topbar-icon" style={{ width: 28, height: 28, borderRadius: 7 }}>
              <img src={graveTrakLogo} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <button type="button" onClick={onShowLanding} aria-label="GraveTrak homepage" title="Visit homepage" style={{ fontFamily: 'inherit', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>GraveTrak</button>
          </div>
          <button className="close-sidebar" aria-label="Close visitor guide" onClick={toggleSidebar}>←</button>
        </div>
        <div className="landing-menu-section">
          <div className="section-title">Jump to Section</div>
          {['Section A', 'Section B', 'Section C', 'Main Office & Administration'].map((target) => (
            <button
              key={target}
              type="button"
              className="landing-menu-item"
              onClick={() => handleVisitorGuideJump(target)}
              style={{ width: '100%', textAlign: 'left' }}
            >
              <div className="menu-label">{target}</div>
              <div className="menu-sub">Map navigation shortcut</div>
            </button>
          ))}
        </div>
        <div className="landing-menu-section">
          <button className="btn btn-ghost" onClick={onToggleTheme}>Switch to {theme === 'dark' ? 'light' : 'dark'} mode</button>
          <div className="section-title">General Information</div>
          <div className="landing-menu-item" style={{ cursor: 'default' }}>
            <div className="menu-label">Visiting Hours</div>
            <div className="menu-sub">6:00 AM - 6:00 PM Daily</div>
          </div>
          <div className="landing-menu-item" style={{ cursor: 'default' }}>
            <div className="menu-label">Office Hours</div>
            <div className="menu-sub">Mon-Fri, 8:00 AM - 5:00 PM</div>
          </div>
          <div className="landing-menu-item" style={{ cursor: 'default' }}>
            <div className="menu-label">Contact</div>
            <div className="menu-sub">[Insert Office Phone/Email]</div>
          </div>
        </div>
        <div className="landing-install-card" style={{ cursor: 'default' }}>
          <div className="landing-install-icon">!</div>
          <div className="landing-install-content">
            <div className="landing-install-title">Public Notice</div>
            <div className="landing-install-sub">Please coordinate with the Main Office for scheduling maintenance or grave repairs.</div>
          </div>
        </div>
      </div>

      {isUser ? (
        <Sidebar
          onShowLanding={onShowLanding}
          role={role}
          userInfo={currentUserInfo}
          isOpen={isSidebarOpen}
          isMobile={isMobile}
          activePanel={activePanel}
          onSelectPanel={(panel) => {
            setActivePanel(panel);
            if (isMobile) setPubOpen(false);
          }}
          onClose={() => setPubOpen(false)}
          onLogout={onLogout}
        />
      ) : null}

      {isUser && isPageActive ? (
        <div className="pub-page">
          {appearance?.error && activePanel !== 'panel-settings' && <div className="settings-save-error" role="alert">{appearance.error}</div>}
          <div className="pub-page-header">
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{currentPanelMeta.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{currentPanelMeta.subtitle}</div>
            </div>
            {['panel-burial-application', 'panel-user-dash', 'panel-application-tracking'].includes(activePanel) ? null : (
              <button className="btn btn-ghost btn-sm" onClick={() => setActivePanel(null)}>Back to map</button>
            )}
          </div>

          {activePanel === 'panel-user-dash' && (() => {
            const burialApplications = displayTrackingItems.filter(i => i.type === 'Burial Application');
            const closedStatuses = ['fully_approved', 'completed', 'rejected', 'cancelled', 'resolved'];
            // The public dashboard groups all accepted/cleared applications under
            // Approved. Interview scheduling is an internal workflow detail and
            // should not appear as a separate user-facing status.
            const approvedStatuses = ['fully_approved', 'completed', 'for_interview', 'scheduled'];
            const userStats = {
              pending: displayTrackingItems.filter(i => ['pending_review', 'pending', 'review'].includes(i.rawStatus) && !i.type.includes('Transfer')).length,
              transfer: displayTrackingItems.filter(i => i.type.includes('Transfer') && i.rawStatus !== 'resolved').length,
              actionRequired: displayTrackingItems.filter(i => i.rawStatus === 'action_required').length,
              approved: burialApplications.filter(i => approvedStatuses.includes(i.rawStatus) || Boolean(i.assignmentLocation)).length,
              completed: burialApplications.filter(i => closedStatuses.includes(i.rawStatus) || Boolean(i.assignmentLocation)).length,
            };
            const totalActive = displayTrackingItems.filter(i => !closedStatuses.includes(i.rawStatus) && !i.assignmentLocation).length;

            const validApplicationDates = burialApplications
              .map(item => ({ ...item, submittedDate: new Date(item.submittedAt) }))
              .filter(item => !Number.isNaN(item.submittedDate.getTime()));
            const averageAgeDays = validApplicationDates.length > 0
              ? Math.round(validApplicationDates.reduce((sum, item) => sum + Math.max(0, (Date.now() - item.submittedDate.getTime()) / 86400000), 0) / validApplicationDates.length)
              : null;

            const documentTotals = burialApplications.reduce((totals, item) => {
              const completeness = item.documentCompleteness;
              const required = Number(completeness?.required_count || 0);
              const complete = Number(completeness?.complete_count || 0);
              return { required: totals.required + required, complete: totals.complete + Math.min(complete, required) };
            }, { required: 0, complete: 0 });
            const documentRate = documentTotals.required > 0
              ? Math.round((documentTotals.complete / documentTotals.required) * 100)
              : 0;

            const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
            const monthlyActivity = Array.from({ length: 6 }, (_, index) => {
              const date = new Date();
              date.setDate(1);
              date.setHours(0, 0, 0, 0);
              date.setMonth(date.getMonth() - (5 - index));
              const value = validApplicationDates.filter(item => (
                item.submittedDate.getFullYear() === date.getFullYear()
                && item.submittedDate.getMonth() === date.getMonth()
              )).length;
              return { label: monthFormatter.format(date), value };
            });
            const monthlyMaximum = Math.max(1, ...monthlyActivity.map(item => item.value));

            const userPlotDistribution = [
              { label: 'Pending / In Review', value: userStats.pending + userStats.transfer, color: 'var(--accent)' },
              { label: 'Needs Action', value: userStats.actionRequired, color: 'var(--red)' },
              { label: 'Approved', value: userStats.approved, color: 'var(--emerald)' },
            ].filter(item => item.value > 0);

            const userPlotDistributionTotal = userPlotDistribution.reduce((sum, item) => sum + item.value, 0);

            const userPlotGradient = userPlotDistribution.length > 0 ? userPlotDistribution
              .reduce((acc, item, index) => {
                const start = userPlotDistribution
                  .slice(0, index)
                  .reduce((sum, prev) => sum + prev.value, 0) / userPlotDistributionTotal * 100;
                const end = start + item.value / userPlotDistributionTotal * 100;
                return acc + `${item.color} ${start}% ${end}%${index < userPlotDistribution.length - 1 ? ', ' : ''}`;
              }, '') : 'var(--border) 0% 100%';

            const upcomingInterviews = displayTrackingItems.filter(i => (
              ['for_interview', 'scheduled'].includes(i.rawStatus)
              && i.interviewDate
              && !i.assignmentLocation
            ));
            const dashboardBurialApplications = displayTrackingItems.filter(item => (
              item.type === 'Burial Application' && !['rejected', 'cancelled'].includes(item.rawStatus)
            ));

            return (
              <div className="user-dashboard-visuals" style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
                  <div className="plot-distribution-card service-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Application Status</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Breakdown of your requests</div>
                      </div>
                    </div>
                    {userPlotDistributionTotal > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'center' }}>
                        <div className="donut-chart" role="img" aria-label={`Application status: ${userPlotDistribution.map(item => `${item.label}: ${item.value}`).join(', ')}`} style={{ background: `conic-gradient(${userPlotGradient})`, width: 100, height: 100, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 6px rgba(255,255,255,.05)' }}>
                          <div className="donut-chart-center" style={{ width: 68, height: 68, background: 'var(--bg-card)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{userPlotDistributionTotal}</div>
                        </div>
                        <div className="donut-legend-list" style={{ display: 'grid', gap: 10 }}>
                          {userPlotDistribution.map((item) => (
                            <div key={item.label} className="donut-legend-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="donut-legend-dot" style={{ background: item.color, width: 10, height: 10, borderRadius: 3 }} />
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.value} requests</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>You don't have any active applications.</div>
                    )}
                  </div>


                  <div style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Upcoming Schedules</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Interviews and appointments</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 12, flex: 1, alignContent: upcomingInterviews.length > 0 ? 'start' : 'center' }}>
                      {upcomingInterviews.length > 0 ? (
                        upcomingInterviews.map((item, idx) => (
                          <div key={idx} style={{ padding: 12, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 'var(--radius)', display: 'flex', gap: 12, alignItems: 'center' }}>
                            <div style={{ width: 40, height: 40, background: 'var(--emerald)', borderRadius: '8px', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', lineHeight: 1 }}>{new Date(item.interviewDate).toLocaleDateString('en-US', { month: 'short' })}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, marginTop: 2 }}>{new Date(item.interviewDate).getDate()}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{item.deceased ? `Interview for ${item.deceased}` : 'Interview'}</div>
                              <div style={{ fontSize: 11, color: 'var(--emerald)', fontWeight: 600, marginTop: 2 }}>{item.interviewTime}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>📍 {item.interviewLocation}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>No upcoming schedules.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="dashboard-kpi-grid">
                  <div className="service-card" style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }} onClick={() => setActivePanel('panel-application-tracking')}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Active Requests</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>{totalActive}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Ongoing applications & transfers</div>
                  </div>
                  <div className="service-card" style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }} onClick={() => setActivePanel('panel-application-tracking')}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Approved Plots</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--emerald)', marginBottom: 8 }}>{userStats.approved}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Successfully assigned</div>
                  </div>
                  <div className="service-card" style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }} onClick={() => setActivePanel('panel-application-tracking')}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Needs Action</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: userStats.actionRequired > 0 ? 'var(--red)' : 'var(--text-muted)', marginBottom: 8 }}>{userStats.actionRequired}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Requires your attention</div>
                  </div>
                  <div className="service-card" style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Total Applications</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{burialApplications.length}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{userStats.completed} closed or completed</div>
                  </div>
                  <div className="service-card" style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Average Age</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>{averageAgeDays === null ? '—' : averageAgeDays}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{averageAgeDays === null ? 'No dated applications' : 'days since submission'}</div>
                  </div>
                </div>

                <div className="dashboard-analytics-grid">
                  <section className="dashboard-analytics-card">
                    <div className="dashboard-analytics-heading">
                      <div>
                        <div className="dashboard-analytics-title">Applications by Month</div>
                        <div className="dashboard-analytics-subtitle">Submissions during the last six months</div>
                      </div>
                      <span className="dashboard-analytics-total">{validApplicationDates.length} total</span>
                    </div>
                    <div className="monthly-bar-chart" role="img" aria-label={`Monthly applications: ${monthlyActivity.map(item => `${item.label} ${item.value}`).join(', ')}`}>
                      {monthlyActivity.map((item, index) => (
                        <div className="monthly-bar-column" key={`${item.label}-${index}`}>
                          <span className="monthly-bar-value">{item.value}</span>
                          <div className="monthly-bar-track">
                            <div className="monthly-bar-fill" style={{ '--bar-height': `${item.value === 0 ? 4 : Math.max(14, (item.value / monthlyMaximum) * 100)}%`, '--bar-delay': `${index * 90}ms` }} />
                          </div>
                          <span className="monthly-bar-label">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="dashboard-analytics-card document-analytics-card">
                    <div className="dashboard-analytics-heading">
                      <div>
                        <div className="dashboard-analytics-title">Document Verification</div>
                        <div className="dashboard-analytics-subtitle">Office-approved documents only; interview and burial steps continue separately</div>
                      </div>
                    </div>
                    {documentTotals.required > 0 ? (
                      <div className="document-analytics-content">
                        <div className="document-progress-ring" style={{ '--document-rate': `${documentRate * 3.6}deg` }} role="img" aria-label={`${documentRate}% of required documents verified`}>
                          <div className="document-progress-center"><strong>{documentRate}%</strong><span>verified</span></div>
                        </div>
                        <div className="document-progress-copy">
                          <strong>{documentTotals.complete} of {documentTotals.required}</strong>
                          <span>required documents approved</span>
                          <div className="document-linear-track"><div className="document-linear-fill" style={{ '--document-width': `${documentRate}%` }} /></div>
                          <small>{documentTotals.required - documentTotals.complete} remaining</small>
                        </div>
                      </div>
                    ) : (
                      <div className="dashboard-analytics-empty">No document verification data yet.</div>
                    )}
                  </section>
                </div>

                <div className="dashboard-tracker-panel">
                  <div className="dashboard-tracker-header">
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Active Burial Applications</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Track document review, payment verification, and assignment progress.</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent-light)', background: 'rgba(25,135,101,.1)', border: '1px solid rgba(25,135,101,.2)', borderRadius: 999, padding: '5px 10px', whiteSpace: 'nowrap' }}>
                      {dashboardBurialApplications.length} active
                    </span>
                  </div>

                  <div className="dashboard-tracker-list">
                    {dashboardBurialApplications.length > 0 ? (
                      dashboardBurialApplications.map((item) => {
                        const currentStep = getBurialTrackerStep(item.rawStatus, item.assignmentLocation);
                        return (
                          <div key={item.id} className="application-tracker-card">
                            <div className="application-tracker-meta">
                              <div className="application-tracker-id">#{String(item.id).replace(/^#/, '')}</div>
                              <div className="application-tracker-name">{item.deceased || item.applicant || 'Burial applicant'}</div>
                              <div className="application-tracker-date">Submitted {formatSubmittedDate(item.submittedAt)}</div>
                              {item.assignmentLocation && <div style={{ marginTop: 7, color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>Approved &amp; Assigned · {item.assignmentLocation}</div>}
                            </div>

                            <div className="application-stepper" aria-label={`Application progress for ${item.id}`}>
                              {burialTrackerSteps.map((step, index) => {
                                const stepNumber = index + 1;
                                const isComplete = stepNumber < currentStep;
                                const isCurrent = stepNumber === currentStep;
                                return (
                                  <div key={step} className={`application-stepper-item ${isComplete ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''}`}>
                                    <div className="application-step-dot">{isComplete ? '1' : stepNumber}</div>
                                    <div className="application-step-label">{step}</div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="application-tracker-actions">
                              <button className="btn btn-primary btn-sm" onClick={() => handleViewTrackingDetails(item)}>Track</button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="dashboard-tracker-empty">You have no active burial applications.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {activePanel === 'panel-loved-ones' && <MyLovedOnes saved={savedGraves} onRemove={async id => {
            try { await savedGraves.remove(id); showToast('Removed from My Loved Ones.'); }
            catch (error) { showToast(error.message, 'error'); }
          }} onView={grave => {
            setActivePanel(null);
            onSelectGrave(null);
            if (!grave) return;
            const current = [...graveData, ...columbariumSlots].find(item =>
              String(item.grave_id || item.id) === grave.grave_id && (item.cemeteryMap || item.cemetery_map || 'old') === grave.cemeteryMap);
            const target = current ? { ...grave, ...current, latlng: current.latlng || grave.latlng } : grave;
            onSelectGrave(target);
            requestAnimationFrame(() => { mapRef.current?.invalidateSize(); safeFlyTo(target.latlng, 21); });
          }} />}
          {activePanel === 'panel-burial-application' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <BurialApplicationForm 
                active={activePanel === 'panel-burial-application'} 
                userInfo={currentUserInfo} 
                onSuccess={() => {
                  fetchMyApps();
                  setActivePanel('panel-user-dash');
                }} 
              />
            </div>
          )}

          {activePanel === 'panel-application-tracking' && (
            <div ref={trackingListRef} style={{ display: 'grid', gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>Monitor your active requests and track approval progress in real time. Updates sent via email.</div>
              </div>

              <div style={{ display: 'grid', gap: 14 }}>
                  {displayTrackingItems.length > 0 ? (
                    paginatedTrackingItems.map((item) => (
                      <div key={item.id} className="service-card" style={{ padding: 18, borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', position: 'relative' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.statusColor, marginTop: 4, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{item.type}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{item.id} {item.deceased ? `· For: ${item.deceased}` : ''}</div>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, color: item.statusColor, background: item.statusBg, border: `1px solid ${item.statusBorder}`, borderRadius: '999px', padding: '4px 10px', whiteSpace: 'nowrap' }}>{item.status}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ marginLeft: 24, paddingBottom: 12 }}>
                          {item.rawStatus !== 'action_required' && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-line' }}>{item.detail}</div>
                          )}
                          
                          {item.rawStatus === 'action_required' && (
                            <div style={{ marginBottom: 16, background: 'rgba(239,68,68,.08)', border: '2px solid var(--red)', padding: 16, borderRadius: 'var(--radius)' }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--red)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{fontSize: 18}}>⚠</span> Action Required: Resubmit Documents</div>
                              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 16, whiteSpace: 'pre-line' }}><strong style={{color: 'var(--red)'}}>Message from Office:</strong><br/>{item.detail}</div>
                              
                              {item.docVerifications && Object.keys(item.docVerifications).length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Document Status Checklist</div>
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    {Object.entries(item.docVerifications).map(([docName, status]) => (
                                      <div key={docName} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, padding: '10px 12px', background: status === 'approved' ? 'rgba(16,185,129,.05)' : 'rgba(239,68,68,.15)', borderLeft: `3px solid ${status === 'approved' ? 'var(--emerald)' : 'var(--red)'}`, borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{docName}</span>
                                          <span style={{ fontWeight: 700, color: status === 'approved' ? 'var(--emerald)' : 'var(--red)' }}>{status === 'approved' ? '✓ Accepted' : '✕ Needs Replacement'}</span>
                                        </div>
                                        {status !== 'approved' && item.docReasons && item.docReasons[docName] && (
                                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red)', background: 'rgba(239,68,68,.1)', padding: '6px 8px', borderRadius: '4px', borderLeft: '2px solid var(--red)' }}>
                                            <strong>Reason:</strong> {item.docReasons[docName]}
                                          </div>
                                        )}
                                        {status !== 'approved' && (
                                          <div style={{ marginTop: 6 }}>
                                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Upload new document:</div>
                                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setCorrectedFiles(prev => ({...prev, [`${item.rawId}-${docName}`]: e.target.files[0]}))} style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,.2)', border: '1px dashed rgba(239,68,68,.4)', borderRadius: '4px', fontSize: 11, color: 'var(--text-primary)', cursor: 'pointer' }} />
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <button className="btn btn-primary" style={{ width: '100%', background: 'var(--red)', borderColor: 'var(--red)', padding: '10px', marginTop: 8 }} onClick={() => {
                                if (item.docVerifications) {
                                  const rejectedDocs = Object.keys(item.docVerifications).filter(docName => item.docVerifications[docName] !== 'approved');
                                  const missingUploads = rejectedDocs.filter(docName => !correctedFiles[`${item.rawId}-${docName}`]);
                                  if (missingUploads.length > 0) {
                                    showToast('Please upload all requested documents before submitting.', 'error');
                                    return;
                                  }
                                  
                                  const oversizedFiles = rejectedDocs.filter(docName => {
                                    const file = correctedFiles[`${item.rawId}-${docName}`];
                                    return file && file.size > 10 * 1024 * 1024;
                                  });
                                  if (oversizedFiles.length > 0) {
                                    showToast('One or more files exceed the 10MB limit. Please upload smaller files.', 'error');
                                    return;
                                  }
                                }
                                const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
                                statuses[String(item.rawId)] = 'pending_review';
                                localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));
                                showToast('Corrected documents submitted successfully! Application is back in review.');
                                fetchMyApps();
                              }}>Submit Corrected Documents</button>
                            </div>
                          )}

                          {item.rawStatus === 'scheduled' && item.interviewDate && (
                            <div style={{ padding: '12px 16px', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: 'var(--emerald)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Interview Schedule</div>
                              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{item.interviewDate} at {item.interviewTime}</div>
                              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📍 Location: {item.interviewLocation}</div>
                            </div>
                          )}

                          {item.assignmentLocation && (
                            <div style={{ padding: '12px 16px', background: 'rgba(25,135,101,.08)', border: '1px solid rgba(25,135,101,.24)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Approved &amp; Assigned</div>
                              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{item.assignmentLocation}</div>
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>Your burial location is recorded in the cemetery system.</div>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                            <span>🕐 {item.eta}</span>
                            <span style={{ padding: '2px 8px', background: item.statusBg, color: item.statusColor, borderRadius: '4px', fontWeight: 600 }}>{item.badgeText}</span>
                          </div>
                        </div>

                        <div style={{ marginLeft: 24, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.05)' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleViewTrackingDetails(item)}>View details</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleContactUs(item)}>Contact us</button>
                            {(item.assignmentLocation || ['fully_approved', 'slot_assigned'].includes(item.rawStatus)) && (
                              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }} onClick={() => {
                                const gMatch = graveData.find(g => g.status === 'occupied' && g.name && g.name.toLowerCase() === item.deceased.toLowerCase());
                                const cMatch = columbariumSlots.find(s => s.status === 'occupied' && s.name && s.name.toLowerCase().includes(item.deceased.toLowerCase()));
                                const loc = gMatch ? `Grave Plot ${gMatch.grave_id}` : (cMatch ? `Columbarium Slot ${cMatch.id}` : 'Unassigned/Not found');
                                setTransferRequestData({ appId: item.id, deceasedName: item.deceased, currentLocation: loc, reason: '' });
                                setIsTransferModalOpen(true);
                              }}>Transfer Plot</button>
                            )}
                            {['pending_review', 'action_required', 'pending', 'review', 'approved'].includes(item.rawStatus) && (
                              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--red)' }} onClick={() => handleCancelApplication(item)}>Cancel Application</button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>You have no active burial applications.</div>
                  )}
              </div>

              {displayTrackingItems.length > 0 && <nav aria-label="Application tracking pages" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }} aria-live="polite">
                  Showing {(currentTrackingPage - 1) * 5 + 1}–{Math.min(currentTrackingPage * 5, displayTrackingItems.length)} of {displayTrackingItems.length} requests
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn btn-ghost btn-sm" disabled={currentTrackingPage === 1} onClick={() => changeTrackingPage(currentTrackingPage - 1)}>Previous</button>
                  <span style={{ fontSize: 12 }}>Page {currentTrackingPage} of {trackingPageCount}</span>
                  <button className="btn btn-ghost btn-sm" disabled={currentTrackingPage === trackingPageCount} onClick={() => changeTrackingPage(currentTrackingPage + 1)}>Next</button>
                </div>
              </nav>}

              <div style={{ padding: 14, borderRadius: 'var(--radius-lg)', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--emerald)', marginBottom: 6 }}>✓ Real-Time Sync Enabled</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>You'll receive real-time in-app updates at each milestone of your application.</div>
              </div>
            </div>
          )}

          {activePanel === 'panel-settings' && account && (
            <UserSettings accountId={account.id} onAccountUpdate={onAccountUpdate} appearance={appearance} onLogout={onLogout} />
          )}
        </div>
      ) : null}

      {/* Tracking Details Modal */}
      {trackingModalData && (
        <div className="modal-overlay open" style={{ zIndex: 100000, padding: 20, alignItems: 'center', overflow: 'hidden' }} onClick={() => setTrackingModalData(null)}>
          <div className="modal" style={{ width: 'min(540px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ flexShrink: 0 }}>
              <div className="modal-title">Application Status</div>
              <button className="modal-close" aria-label="Close application status" onClick={() => setTrackingModalData(null)}>{'\u00D7'}</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
              <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{trackingModalData.type}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>ID: {trackingModalData.id}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: trackingModalData.statusColor, background: trackingModalData.statusBg, border: `1px solid ${trackingModalData.statusBorder}`, borderRadius: '999px', padding: '4px 10px' }}>{trackingModalData.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div><strong style={{color: 'var(--text-primary)'}}>For:</strong> {trackingModalData.deceased || 'N/A'}</div>
                  {trackingModalData.rawStatus !== 'action_required' && (
                    <div style={{marginTop: 6}}><strong style={{color: 'var(--text-primary)'}}>Detail:</strong> {trackingModalData.detail}</div>
                  )}
                  
                  {['for_interview', 'scheduled'].includes(trackingModalData.rawStatus) && trackingModalData.interviewDate && (
                    <div style={{ padding: '12px 16px', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 'var(--radius)', marginTop: 16 }}>
                      <div style={{ fontSize: 11, color: 'var(--emerald)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Physical Document Verification / Interview · Scheduled</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{trackingModalData.interviewDate} at {trackingModalData.interviewTime}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📍 Location: {trackingModalData.interviewLocation}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Please bring the original copies of all required submitted documents.</div>
                      {trackingModalData.interviewNotes && <div style={{ whiteSpace: 'pre-wrap', marginTop: 10, fontSize: 13 }}><strong>Notes to Applicant:</strong> {trackingModalData.interviewNotes}</div>}
                    </div>
                  )}
                </div>
              </div>

              {trackingModalData.documentCompleteness && (
                <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Required Documents</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                    {trackingModalData.documentCompleteness.complete_count} / {trackingModalData.documentCompleteness.required_count} complete · {trackingModalData.documentCompleteness.state.replaceAll('_', ' ')}
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {[...trackingModalData.documents, ...(trackingModalData.documentCompleteness.missing_document_types || []).map((type, index) => ({ id: `missing-${index}`, document_type: type, document_type_display: trackingModalData.documentCompleteness.missing_documents[index], verification_status: 'missing' }))].map(doc => {
                      const label = doc.verification_status === 'pending_review' ? 'Pending Review' : doc.verification_status === 'needs_correction' ? 'Needs Correction' : doc.verification_status === 'complete' ? 'Complete' : 'Missing';
                      const color = doc.verification_status === 'complete' ? 'var(--emerald)' : doc.verification_status === 'needs_correction' ? 'var(--red)' : 'var(--amber)';
                      const fileKey = `${trackingModalData.rawId}-${doc.document_type}`;
                      return (
                        <div key={doc.id} style={{ padding: '10px 12px', borderLeft: `3px solid ${color}`, background: 'rgba(255,255,255,.025)', borderRadius: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{doc.document_type_display}</span>
                            <span style={{ fontWeight: 700, color }}>{label}</span>
                          </div>
                          {doc.verification_note && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>{doc.verification_note}</div>}
                          {doc.verification_status === 'needs_correction' && (
                            <div style={{ marginTop: 8 }}>
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setCorrectedFiles(prev => ({ ...prev, [fileKey]: event.target.files[0] }))} style={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                              <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={async () => {
                                const file = correctedFiles[fileKey];
                                if (!file) return showToast('Choose a replacement file first.', 'error');
                                if (file.size > 10 * 1024 * 1024) return showToast('The file exceeds the 10MB limit.', 'error');
                                try {
                                  await replaceBurialDocuments(trackingModalData.rawId, { [doc.document_type]: file });
                                  showToast('Replacement uploaded and returned to pending review.', 'success');
                                  setTrackingModalData(null);
                                  fetchMyApps();
                                } catch (err) { showToast(err.message, 'error'); }
                              }}>Replace Document</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {trackingModalData.rawStatus === 'action_required' && (
                <div style={{ padding: '16px', background: 'rgba(239,68,68,.08)', border: '2px solid var(--red)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--red)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{fontSize: 18}}>⚠</span> Action Required: Resubmit Documents</div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 16, whiteSpace: 'pre-line', lineHeight: 1.6 }}><strong style={{color: 'var(--red)'}}>Message from Office:</strong><br/>{trackingModalData.actionReason || trackingModalData.detail}</div>
                  
                  {trackingModalData.docVerifications && Object.keys(trackingModalData.docVerifications).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Document Status Checklist</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {Object.entries(trackingModalData.docVerifications).map(([docName, status]) => (
                                      <div key={docName} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, padding: '10px 12px', background: status === 'approved' ? 'rgba(16,185,129,.05)' : 'rgba(239,68,68,.15)', borderLeft: `3px solid ${status === 'approved' ? 'var(--emerald)' : 'var(--red)'}`, borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{docName}</span>
                                          <span style={{ fontWeight: 700, color: status === 'approved' ? 'var(--emerald)' : 'var(--red)' }}>{status === 'approved' ? '✓ Accepted' : '✕ Needs Replacement'}</span>
                                        </div>
                                        {status !== 'approved' && trackingModalData.docReasons && trackingModalData.docReasons[docName] && (
                                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red)', background: 'rgba(239,68,68,.1)', padding: '6px 8px', borderRadius: '4px', borderLeft: '2px solid var(--red)' }}>
                                            <strong>Reason:</strong> {trackingModalData.docReasons[docName]}
                                          </div>
                                        )}
                                        {status !== 'approved' && (
                                          <div style={{ marginTop: 6 }}>
                                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Upload new document:</div>
                                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setCorrectedFiles(prev => ({...prev, [`${trackingModalData.rawId}-${docName}`]: e.target.files[0]}))} style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,.2)', border: '1px dashed rgba(239,68,68,.4)', borderRadius: '4px', fontSize: 11, color: 'var(--text-primary)', cursor: 'pointer' }} />
                                          </div>
                                        )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                              <button className="btn btn-primary" style={{ width: '100%', background: 'var(--red)', borderColor: 'var(--red)', padding: '10px', marginTop: 8 }} onClick={() => {
                    if (trackingModalData.docVerifications) {
                      const rejectedDocs = Object.keys(trackingModalData.docVerifications).filter(docName => trackingModalData.docVerifications[docName] !== 'approved');
                      const missingUploads = rejectedDocs.filter(docName => !correctedFiles[`${trackingModalData.rawId}-${docName}`]);
                      if (missingUploads.length > 0) {
                        showToast('Please upload all requested documents before submitting.', 'error');
                        return;
                      }
                      
                      const oversizedFiles = rejectedDocs.filter(docName => {
                        const file = correctedFiles[`${trackingModalData.rawId}-${docName}`];
                        return file && file.size > 10 * 1024 * 1024;
                      });
                      if (oversizedFiles.length > 0) {
                        showToast('One or more files exceed the 10MB limit. Please upload smaller files.', 'error');
                        return;
                      }
                    }
                    const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
                    statuses[String(trackingModalData.rawId)] = 'pending_review';
                    localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));
                    showToast('Corrected documents submitted successfully! Application is back in review.');
                    setTrackingModalData(null);
                    fetchMyApps();
                  }}>Submit Corrected Documents</button>
                </div>
              )}

              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>Progress Timeline</div>
              
              <div style={{ display: 'grid', gap: 16, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 5, top: 10, bottom: 10, width: 2, background: 'var(--border)', zIndex: 0 }} />
                
                {[
                  { step: 'Application Submitted', active: true, desc: 'Received successfully' },
                  { step: 'Document Review', active: !['pending_review', 'pending', 'review'].includes(trackingModalData.rawStatus), desc: trackingModalData.rawStatus === 'action_required' ? 'Issue detected' : (trackingModalData.rawStatus === 'rejected' ? 'Application denied' : (trackingModalData.rawStatus === 'cancelled' ? 'Cancelled by user' : 'Documents verified')) },
                  { step: "Interview", active: ['scheduled', 'fully_approved', 'slot_assigned'].includes(trackingModalData.rawStatus), desc: trackingModalData.rawStatus === 'scheduled' ? 'Interview scheduled' : (['fully_approved', 'slot_assigned'].includes(trackingModalData.rawStatus) ? 'Interview completed' : 'Pending schedule') },
                  { step: 'Final Approval & Assignment', active: ['fully_approved', 'slot_assigned'].includes(trackingModalData.rawStatus), desc: ['fully_approved', 'slot_assigned'].includes(trackingModalData.rawStatus) ? 'Plot assigned and finalized' : 'Awaiting confirmation' },
                ].map((stage, i) => (
                  <div key={stage.step} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: stage.active ? (stage.desc.includes('denied') || stage.desc.includes('Issue') ? 'var(--red)' : 'var(--emerald)') : 'var(--bg-card)', border: `2px solid ${stage.active ? (stage.desc.includes('denied') || stage.desc.includes('Issue') ? 'var(--red)' : 'var(--emerald)') : 'var(--border)'}`, marginTop: 4, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: stage.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>{stage.step}</div>
                      <div style={{ fontSize: 11, color: stage.active ? (stage.desc.includes('denied') || stage.desc.includes('Issue') ? 'var(--red)' : 'var(--emerald)') : 'var(--text-secondary)', marginTop: 4 }}>
                        {stage.active ? stage.desc : 'Pending'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Plot Request Modal */}
      {isTransferModalOpen && (
        <div className="modal-overlay open" style={{ zIndex: 100000 }} onClick={() => setIsTransferModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Request Plot Transfer</div>
              <button className="modal-close" onClick={() => setIsTransferModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Deceased Name</label>
                <input
                  type="text"
                  value={transferRequestData.deceasedName}
                  readOnly
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 14, outline: 'none' }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Current Location</label>
                <input
                  type="text"
                  value={transferRequestData.currentLocation}
                  readOnly
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 14, outline: 'none' }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Reason for Transfer / New Location Details</label>
                <textarea
                  value={transferRequestData.reason}
                  onChange={(e) => setTransferRequestData({ ...transferRequestData, reason: e.target.value })}
                  placeholder="Provide the reason for the transfer request and details about the new location."
                  style={{ width: '100%', minHeight: '100px', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(0,0,0,.1)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button className="btn btn-ghost" onClick={() => setIsTransferModalOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => {
                  if (!transferRequestData.reason.trim()) {
                    showToast('Please provide a reason for the transfer.', 'error');
                    return;
                  }
                  const messageText = `TRANSFER PLOT REQUEST\n${transferRequestData.reason.trim()}`;
                  const messages = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                  messages.unshift({
                    id: Date.now(),
                    date: new Date().toLocaleString(),
                    user: currentUserName || currentUserInfo.name || 'Public User',
                    appId: transferRequestData.appId,
                    deceased: transferRequestData.deceasedName,
                    currentLocation: transferRequestData.currentLocation,
                    message: messageText
                  });
                  localStorage.setItem('gravetrak_support_messages', JSON.stringify(messages));
                  const evt = new Event('storage');
                  evt.key = 'gravetrak_support_messages';
                  window.dispatchEvent(evt);
                  
                  localStorage.setItem('gravetrak_new_transfer_request', Date.now().toString());
                  const evt2 = new Event('storage');
                  evt2.key = 'gravetrak_new_transfer_request';
                  window.dispatchEvent(evt2);
                  
                  fetchMyApps();
                  showToast("Transfer Plot Request sent! The Mayor's Office will review it shortly.");
                  setIsTransferModalOpen(false);
                }}>Submit Request</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Us Modal */}
      {isContactModalOpen && (
        <div className="modal-overlay open" onClick={() => setIsContactModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Contact Support</div>
              <button className="modal-close" onClick={() => setIsContactModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {contactAppContext && (
                <div style={{ padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  Application ID: <strong>{contactAppContext.id}</strong><br/>
                  Regarding: <strong>{contactAppContext.deceased}</strong>
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Your Message</label>
                <textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="How can we help you? (e.g., inquiry about requirements, request to reschedule...)"
                  style={{ width: '100%', minHeight: '120px', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(0,0,0,.1)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="btn btn-ghost" style={{ color: 'var(--accent-light)' }} onClick={() => setIsChatHistoryOpen(true)}>💬 Chat History</button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={() => setIsContactModalOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => {
                    if (!contactMessage.trim()) {
                      showToast('Please enter a message.', 'error');
                      return;
                    }
                    
                    const messages = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                    messages.unshift({
                      id: Date.now(),
                      date: new Date().toLocaleString(),
                      user: currentUserInfo.name || 'Public User',
                      appId: contactAppContext ? contactAppContext.id : null,
                      deceased: contactAppContext ? contactAppContext.deceased : null,
                      message: contactMessage.trim()
                    });
                    localStorage.setItem('gravetrak_support_messages', JSON.stringify(messages));
                    
                    // Force same-window Real-time Sync
                    const evt = new Event('storage');
                    evt.key = 'gravetrak_support_messages';
                    window.dispatchEvent(evt);
                    
                    showToast("Your message has been sent! Please check your notifications here for the Mayor's Office reply.");
                    setIsContactModalOpen(false);
                    setContactMessage('');
                  }}>Send Message</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat History Modal */}
      {isChatHistoryOpen && (
        <div className="modal-overlay open" style={{ zIndex: 100000 }} onClick={() => setIsChatHistoryOpen(false)}>
          <div className="modal" style={{ maxWidth: '600px', width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Chat History</div>
              <button className="modal-close" onClick={() => setIsChatHistoryOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', background: 'var(--bg-surface)' }}>
              {(() => {
                 const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]').filter(m => m.user === (currentUserInfo.name || 'Public User') || m.user === currentUserName);
                 const replies = supportReplies;
                 const allChats = [...msgs.map(m => ({ ...m, isSender: true })), ...replies.map(r => ({ ...r, isSender: false }))];
                 allChats.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                 
                 if (allChats.length === 0) {
                   return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>No active conversations found.</div>;
                 }
                 
                 return (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                     {allChats.map(chat => (
                       <div key={`${chat.isSender ? 'msg' : 'rep'}-${chat.id}`} style={{ alignSelf: chat.isSender ? 'flex-end' : 'flex-start', maxWidth: '85%', background: chat.isSender ? 'var(--accent)' : 'var(--bg-card)', padding: '12px 16px', borderRadius: chat.isSender ? '16px 16px 4px 16px' : '16px 16px 16px 4px', border: chat.isSender ? 'none' : '1px solid var(--border)', color: chat.isSender ? '#fff' : 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }}>
                         <div style={{ fontSize: 11, color: chat.isSender ? 'rgba(255,255,255,.7)' : 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
                           {chat.isSender ? 'You' : chat.admin} • {chat.date}
                         </div>
                         {chat.appId && chat.isSender && <div style={{ fontSize: 11, background: 'rgba(0,0,0,.15)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', marginBottom: 8 }}>Re: {chat.appId}</div>}
                         <div style={{ fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                           {chat.message}
                         </div>
                       </div>
                     ))}
                   </div>
                 );
              })()}
            </div>
          </div>
        </div>
      )}
      {/* View Support Reply Modal */}
      {viewReplyMsg && (
        <div className="modal-overlay open" style={{ zIndex: 100000 }} onClick={() => setViewReplyMsg(null)}>
          <div className="modal" style={{ maxWidth: '500px', width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>✉️ Support Reply</div>
              <button className="modal-close" onClick={() => setViewReplyMsg(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ padding: 16, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ marginBottom: 4 }}><strong>From:</strong> {viewReplyMsg.admin}</div>
                <div style={{ marginBottom: 4 }}><strong>Date:</strong> {viewReplyMsg.date}</div>
              </div>
              <div style={{ padding: 16, background: 'rgba(25,135,101,.05)', borderRadius: 'var(--radius)', border: '1px solid rgba(25,135,101,.2)', fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-line', lineHeight: 1.6, minHeight: '100px' }}>
                {viewReplyMsg.message}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button className="btn btn-ghost" onClick={() => setViewReplyMsg(null)}>Close</button>
                <button className="btn btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => {
                  const updated = supportReplies.filter(r => r.id !== viewReplyMsg.id);
                  setSupportReplies(updated);
                  localStorage.setItem('gravetrak_support_replies', JSON.stringify(updated));
                  setViewReplyMsg(null);
                }}>Delete Message</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Public Columbarium View Modal */}
      {publicColumbariumSection && (
        <div className="modal-overlay open" onClick={() => setPublicColumbariumSection(null)}>
          <div className="modal" style={{ maxWidth: '900px', width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 16, height: 16, borderRadius: '4px', background: getSectionColor(publicColumbariumSection.replace('Section ', '')) }}></span>
                {publicColumbariumSection} - Columbarium Records
              </div>
              <button className="modal-close" onClick={() => setPublicColumbariumSection(null)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowX: 'auto', background: 'var(--bg-surface)' }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status legend:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--emerald)' }}><div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--emerald)' }}/> Available</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--red)' }}><div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)' }}/> Occupied</div>
              </div>
              <div className="columbarium-grid-panel" style={{ minWidth: '750px', padding: 10, overflowX: 'auto' }}>
                {[slotNumbers.slice(0, 42), slotNumbers.slice(42, 84)].map((group, groupIndex) => (
                  <div key={`group-${groupIndex}`} className="columbarium-grid-block" style={{ minWidth: 'max-content', marginBottom: '24px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '12px', paddingLeft: '32px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {publicColumbariumSection} — {groupIndex === 0 ? 'Front Side (C1-C42)' : 'Back Side (C1-C42)'}
                    </div>
                    <div className="columbarium-grid-header" style={{ display: 'flex', flexWrap: 'nowrap' }}>
                      <div className="columbarium-corner" />
                      {group.map((slot) => <div key={`col-${slot}`} className="columbarium-column-label" style={{ flexShrink: 0 }}>C{slot > 42 ? slot - 42 : slot}</div>)}
                    </div>
                    {floorLabels.map((floor) => (
                      <div key={`floor-${floor}-group-${groupIndex}`} className="columbarium-floor-row" style={{ display: 'flex', flexWrap: 'nowrap' }}>
                        <div className="columbarium-floor-label" style={{ flexShrink: 0 }}>F{floor}</div>
                        {group.map((slot) => {
                          const slotId = `${publicColumbariumSection}-F${floor}-C${slot}`;
                          const slotObj = columbariumSlots.find(s => s.id === slotId);
                          const status = slotObj ? slotObj.status : 'available';
                          const isOccupied = status === 'occupied';
                          const displaySlot = slot > 42 ? slot - 42 : slot;
                          return (
                            <div key={slotId} className={`columbarium-slot ${status}`} title={`${slotId} - ${status.toUpperCase()}${isOccupied && slotObj?.name ? '\nOccupant: ' + slotObj.name : ''}`} 
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectGrave(slotObj || { id: slotId, grave_id: slotId, status: 'available', name: '— Available —', dates: '—', location: `${publicColumbariumSection} F${floor} C${slot}` });
                                setPublicColumbariumSection(null);
                              }}
                              style={{ padding: 0, cursor: 'pointer', opacity: isOccupied ? 1 : 0.4, flexShrink: 0 }}>
                              {isOccupied ? <span style={{fontSize: 10, fontWeight: 'bold', color: 'var(--red)'}}>{slotObj.name ? slotObj.name.substring(0, 3).toUpperCase() : 'X'}</span> : displaySlot}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isUser && <nav className="guest-mobile-nav" aria-label="Visitor navigation">
        <button onClick={onShowLanding}><span aria-hidden="true">⌂</span>Home</button>
        <button aria-current={!landingOpen ? 'page' : undefined} onClick={() => setLandingOpen(false)}><span aria-hidden="true">⌖</span>Map</button>
        <button aria-expanded={landingOpen} onClick={() => setLandingOpen(v => !v)}><span aria-hidden="true">ⓘ</span>Visitor Guide</button>
        <button onClick={isOfficeViewer ? onShowOfficeDashboard : onShowAuth}><span aria-hidden="true">↪</span>{isOfficeViewer ? 'Dashboard' : 'Sign in'}</button>
      </nav>}
      <GravePanel grave={selectedGrave}
        onSelectFloor={isUser ? floor => { setFloorDetailsContext({ stack: selectedGrave, childId: floor.id }); onSelectGrave(floor); } : undefined}
        onBackToFloors={isUser && floorDetailsContext && selectedGrave?.id === floorDetailsContext.childId ? () => { onSelectGrave(floorDetailsContext.stack); setFloorDetailsContext(null); } : undefined}
        onClose={() => onSelectGrave(null)} mapRef={mapRef} onApply={handleApplyForPlot} graveData={graveData} columbariumSlots={columbariumSlots} onNavigateRoute={handleNavigateRoute} isNavigating={isNavigating} closeOnNavigate={isUser && isMobile} isGraveSaved={savedGraves.isSaved} saveBusy={savedGraves.busy || savedGraves.loading} onSaveGrave={isUser ? async grave => {
        try { await savedGraves.save(grave); showToast('Saved to your My Loved Ones.'); }
        catch (error) { showToast(error.message, 'error'); }
      } : undefined} />
    </div>
  );
}
