import StaffSearch from '../cemetery/StaffSearch.jsx';
import { availableNichesInAssignmentOrder } from '../../../utils/nicheAssignment.js';
import { applyPlotFilterStyle, bindPlotHover } from '../../../utils/mapPlotStyle.js';
import { closeBoundaryFeatures } from '../../../utils/mapGeometry.js';
import oldCemeteryBoundary from '../../../data/oldCemeteryBoundary.json';
import './StaffMapControls.css';
import MapLoadingOverlay from '../cemetery/MapLoadingOverlay.jsx';
import { isReportReady } from '../../../utils/reportReadiness.js';
import CemeteryReports from '../cemetery/CemeteryReports.jsx';
import { fetchNotificationRecipient } from '../../../api.js';
import ReportSubmissions from '../cemetery/ReportSubmissions.jsx';
import ReportApplications from '../cemetery/ReportApplications.jsx';
import { downloadReportWorkbook } from '../../../utils/reportWorkbook.js';
import StaffDashboard from '../cemetery/StaffDashboard.jsx';
import CPDOAnalytics from '../cpdo/CPDOAnalytics.jsx';
import '../mayor/MayorDashboard.css';
import '../mayor/UserManagement.css';
import SectionLayoutPreview from '../cpdo/SectionLayoutPreview.jsx';
import '../cpdo/SectionModal.css';
import { getSectionLayout, getNichePosition } from '../../../utils/sectionLayout.js';
import { findPlanningSection, findSectionConflict, planningSectionSidebarId, resolvePlanningSections } from '../../../utils/planningSections.js';
import { findPlanningMapTarget } from '../../../utils/planningMapInteraction.js';
import CPDOPlotManager from '../cpdo/CPDOPlotManager.jsx';
import CPDOPlotRecords from '../cpdo/CPDOPlotRecords.jsx';
import { activeInventoryForZones, buildInventory, buildStackInventory, compareInventorySections, inventorySectionTotals, inventoryTotals } from '../../../utils/cpdoInventory.js';
import GraveRecordsTable from '../cemetery/GraveRecordsTable.jsx';
import ApartmentNicheWall, { memorialLabel } from '../cemetery/ApartmentNicheWall.jsx';
import NicheSearch from '../cemetery/NicheSearch.jsx';
import graveTrakLogo from '../../../assets/gravetrak-logo.svg';
import { selectApplicationList, applicationWaitingLabel } from '../../../utils/applicationSearch.js';
import { getElapsedMilliseconds, getAverageApprovalTiming } from '../../../utils/applicationTiming.js';
import { buildUserPatch } from '../../../utils/userManagement.js';
import './AdminSettings.css';
import './AdminApplications.css';
import './PlanningMap.css';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet-draw'; // Import Leaflet.draw JS
import 'leaflet-draw/dist/leaflet.draw.css'; // Import Leaflet.draw CSS
import { CEMETERY_CENTER, navConfigs, normalizeAppRole, roleInfo } from '../../../data/data.js';
import { makeIcon, makeColIcon, sanitizeLatLng, useLeafletMap } from '../../../hooks/useLeafletMap.jsx'; // Corrected import path
import {
  API_BASE,
  createGrave,
  deleteGrave,
  fetchGraves,
  fetchBurialApplications,
  fetchReportAnalytics,
  fetchBurialApplication,
  notifyApplicationIssue,
  reviewBurialDocument,
  completeDocumentReview,
  fetchAvailableAppointmentSlots,
  autoScheduleNextAppointment,
  rescheduleAppointment,
  cancelAppointment,
  fetchUsers,
  createUser,
  getProfile,
  updateUser,
  fetchColumbariums,
  updateColumbarium,
  transferColumbarium,
  createColumbarium,
  createColumbariumSection,
  fetchCemeterySections,
  fetchCemeteries,
  fetchBurialPlots,
  fetchBurialPlotSummary,
  generateBurialPlotLayout,
  createCemeterySection,
  updateCemeterySection,
  deleteCemeterySection,
  fetchCemeteryPathways,
  createCemeteryPathway,
  updateCemeteryPathway,
  deleteCemeteryPathway
} from '../../../api.js';
import CustomDatePicker from '../../CustomDatePicker.jsx';
import SecureDocumentPreview from '../../shared/SecureDocumentPreview.jsx';
import UserSettings from '../../UserSettings.jsx';
import rawAnotherMapData from '../../../../anothermap.json';
import { buildSavedSectionPlotFeatures, getSavedSectionStatusColor, legacyTwoSidedCorners, useFirstToFourthGridEdges } from '../../../utils/savedSectionLayout.js';

const ANOTHER_CEMETERY_CENTER = [13.931237218126718, 121.62076352291137];
const FAST_PROCESSING_TARGET_MS = 15 * 60 * 1000;
const PLOT_STATUS_COLORS = {
  available: '#1687C9',
  occupied: '#075985',
  maintenance: '#DC3545',
};
const SECTION_UTILIZATION_COLORS = { low: '#1687C9', moderate: '#64748B', high: '#DC3545' };
// Staff and planning maps share status colors so switching roles is consistent.
const PLANNING_PLOT_COLORS = PLOT_STATUS_COLORS;
// Keep the overview calm; individual grave dividers become useful up close.
const planningPlotWeight = zoom => zoom >= 22 ? 0.65 : zoom >= 20 ? 0.3 : 0;
const UNKNOWN_PLOT_COLOR = '#CBD5E1';

function getRecordCemetery(record) {
  if (!record || typeof record !== 'object') return null;
  const candidates = [
    record.cemeteryMap,
    record.cemetery_map,
    record.cemetery_code,
    record.cemetery_name,
    record.cemetery?.code,
    record.cemetery?.name,
    record.assigned_plot_info?.cemetery_code,
    record.assigned_plot_info?.cemetery_name,
    record.assigned_plot?.cemetery_code,
    record.plot?.cemetery_code,
    record.burial_location,
    record.location,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').toLowerCase();
    if (value.includes('new')) return 'new';
    if (value.includes('old')) return 'old';
  }
  const plotId = String(record.plot_id || record.grave_id || record.assigned_plot_info?.plot_id || '').toLowerCase();
  if (/^(new|ncp|nwc)[-_]/.test(plotId)) return 'new';
  if (/^(old|ocp|owc)[-_]/.test(plotId)) return 'old';
  return null;
}

function belongsToCemeteryOrIsUnassigned(record, cemetery) {
  const recordCemetery = getRecordCemetery(record);
  return recordCemetery === null || recordCemetery === cemetery;
}

// The exported New Cemetery GeoJSON contains duplicate geometries with
// different style metadata. Drawing both copies duplicates every section,
// generated plot, and pathway hit area on the planning map.
const anotherMapData = (() => {
  const seen = new Set();
  return {
    ...rawAnotherMapData,
    features: (rawAnotherMapData.features || []).filter(feature => {
      const key = JSON.stringify(feature.geometry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
})();

const RBAC_PERMISSION_OPTIONS = [
  ['manage_users', 'Manage users'],
  ['assign_roles', 'Assign roles'],
  ['manage_permissions', 'Manage permissions'],
  ['manage_applications', 'Manage applications'],
  ['review_documents', 'Review document completeness'],
  ['manage_burial_records', 'Manage burial records'],
  ['manage_appointments', 'Manage appointments'],
  ['manage_gis', 'Manage GIS information'],
  ['manage_zoning', 'Manage zoning and sections'],
  ['manage_plots', 'Manage plots and columbarium'],
  ['allocate_plots', 'Allocate plots'],
  ['manage_grave_status', 'Manage grave status'],
  ['generate_reports', 'Generate reports'],
];

const USER_ROLE_LABELS = { mayor: 'CMO Super Administrator', staff: 'Cemetery Staff', planning: 'CPDO Administrator', user: 'Citizen', admin: 'Administrator' };

const siteData = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { type: 'boundary' }, geometry: oldCemeteryBoundary },
    { type: 'Feature', properties: { id: 'A', name: 'section A' }, geometry: { type: 'Polygon', coordinates: [[[121.6203214791338, 13.93855488284199], [121.6205836356741, 13.93870262747862], [121.6205599091991, 13.93874216581273], [121.6202991675655, 13.93860249552575], [121.6203214791338, 13.93855488284199]]] } },
    { type: 'Feature', properties: { id: 'B', name: 'section B' }, geometry: { type: 'Polygon', coordinates: [[[121.6203585162256, 13.93849364973904], [121.620619326257, 13.93863210524747], [121.6205960742709, 13.93867897263909], [121.6203320005097, 13.93853997960028], [121.6203585162256, 13.93849364973904]]] } },
    { type: 'Feature', properties: { id: 'C', name: 'section C' }, geometry: { type: 'Polygon', coordinates: [[[121.6203918539242, 13.93843281684503], [121.6206526371996, 13.9385704710939], [121.6206298176826, 13.93861144757171], [121.6203683462329, 13.93847625955412], [121.6203918539242, 13.93843281684503]]] } },
    { type: 'Feature', properties: { id: 'D', name: 'section D' }, geometry: { type: 'Polygon', coordinates: [[[121.6204229893675, 13.9383686592039], [121.6206906474492, 13.93850328632113], [121.6206657355948, 13.93854946151564], [121.6204018509775, 13.93841084974111], [121.6204229893675, 13.9383686592039]]] } },
    { type: 'Feature', properties: { id: 'E', name: 'section E' }, geometry: { type: 'Polygon', coordinates: [[[121.620458866835, 13.93830488512019], [121.6207246560416, 13.93843918736268], [121.6206990834441, 13.93848257222731], [121.6204354676256, 13.938346065936], [121.620458866835, 13.93830488512019]]] } },
    { type: 'Feature', properties: { id: 'F', name: 'section F' }, geometry: { type: 'Polygon', coordinates: [[[121.6204926576898, 13.93824001947731], [121.6207581789731, 13.93837881378557], [121.6207372737701, 13.938416721725], [121.6204693004073, 13.93828306627575], [121.6204926576898, 13.93824001947731]]] } },
    { type: 'Feature', properties: { id: 'G', name: 'section G' }, geometry: { type: 'Polygon', coordinates: [[[121.6207752074491, 13.93834197643966], [121.6205138194776, 13.93820770218513], [121.6205327819279, 13.93817321488939], [121.6207929600694, 13.93830395172877], [121.6207752074491, 13.93834197643966]]] } },
    { type: 'Feature', properties: { id: 'H', name: 'section H' }, geometry: { type: 'Polygon', coordinates: [[[121.6208044845237, 13.93828290291656], [121.6205460499875, 13.93814866899483], [121.6205664342077, 13.93811419562238], [121.6208288200862, 13.93823858571403], [121.6208044845237, 13.93828290291656]]] } },
    { type: 'Feature', properties: { id: 'I', name: 'section I' }, geometry: { type: 'Polygon', coordinates: [[[121.6205805688525, 13.93807695086402], [121.6208376068272, 13.93821696851735], [121.6208629281162, 13.93817737084802], [121.6206036455713, 13.93803629148019], [121.6205805688525, 13.93807695086402]]] } },
    { type: 'Feature', properties: { id: 'J', name: 'section J' }, geometry: { type: 'Polygon', coordinates: [[[121.6206105969996, 13.9380139951728], [121.6208746647334, 13.93815336837249], [121.6208978005792, 13.93811108737267], [121.6206368598003, 13.93797154249795], [121.6206105969996, 13.9380139951728]]] } },
    { type: 'Feature', properties: { id: 'K', name: 'section K' }, geometry: { type: 'Polygon', coordinates: [[[121.6206700242037, 13.93790621219462], [121.6209336626595, 13.93804440680938], [121.6209112588027, 13.93808784284815], [121.620648278562, 13.93795135801644], [121.6206700242037, 13.93790621219462]]] } },
    { type: 'Feature', properties: { id: 'L', name: 'section L' }, geometry: { type: 'Polygon', coordinates: [[[121.620706076701, 13.93784107389464], [121.6209663616919, 13.93798271996177], [121.6209440725993, 13.93802530582063], [121.6206816294046, 13.93788791211609], [121.620706076701, 13.93784107389464]]] } },
    { type: 'Feature', properties: { id: 'M', name: 'section M' }, geometry: { type: 'Polygon', coordinates: [[[121.6207401390505, 13.93777573012798], [121.6210046380642, 13.93791655736139], [121.6209795767243, 13.93795582643999], [121.6207175814478, 13.93782014619143], [121.6207401390505, 13.93777573012798]]] } },
    { type: 'Feature', properties: { id: 'N', name: 'section N' }, geometry: { type: 'Polygon', coordinates: [[[121.6207738097278, 13.93771875273085], [121.6210368182704, 13.9378529697783], [121.621013724712, 13.93789440987628], [121.6207527579764, 13.93775982722373], [121.6207738097278, 13.93771875273085]]] } }
  ],
};

function getSectionColor(id) {
  const colors = ['#1687C9', '#ce1126', '#0B67A0', '#ef4444', '#1687C9', '#b91c1c', '#1687C9'];
  return colors[id.charCodeAt(0) % colors.length];
}

function normalizeSectionName(section) {
  if (!section) return '';
  let text = String(section).trim();
  text = text.replace(/^Section\s+(?=Expansion Area)/i, '');
  text = text.replace(/^Expansion Area/i, 'Section');
  if (text.length === 1 && /[A-Za-z]/.test(text)) return `Section ${text.toUpperCase()}`;
  const upper = text.replace(/^(sec(?:tion)?\s*)/i, 'Section ');
  const match = upper.match(/^Section\s*([A-Za-z])$/i);
  if (match) return `Section ${match[1].toUpperCase()}`;
  return upper;
}

function formatElapsedDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalMinutes = Math.floor(milliseconds / 60000);
  if (milliseconds > 0 && totalMinutes === 0) return '<1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} hr` : `${days} d`;
}

function formatProcessingDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function getMapType(section) {
  return 'old';
}

// Google Earth copies coordinates as degrees/minutes/seconds, while GeoJSON
// stores decimal longitude/latitude. Accept one pasted pair per corner.
function parseGoogleEarthCoordinatePair(value) {
  const matches = [...String(value).matchAll(/(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]?\s*([NSEW])/gi)];
  if (matches.length !== 2) return null;
  const converted = matches.map(match => {
    const degrees = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3]);
    const hemisphere = match[4].toUpperCase();
    if (minutes >= 60 || seconds >= 60) return null;
    const decimal = degrees + minutes / 60 + seconds / 3600;
    if (decimal > (hemisphere === 'N' || hemisphere === 'S' ? 90 : 180)) return null;
    return { hemisphere, decimal: hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal };
  });
  if (converted.includes(null)) return null;
  const latitude = converted.find(item => item.hemisphere === 'N' || item.hemisphere === 'S');
  const longitude = converted.find(item => item.hemisphere === 'E' || item.hemisphere === 'W');
  return latitude && longitude ? { lat: latitude.decimal.toFixed(8), lng: longitude.decimal.toFixed(8) } : null;
}

const processSlots = (slots) => slots.map(s => {
  let cMap = s.cemetery_map || s.cemeteryMap;
  if (s.id && s.id.includes('-new-')) cMap = 'new'; // Auto-repair corrupted records
  if (s.id && s.id.includes('-old-')) cMap = 'old'; // Auto-repair corrupted records
  return {
    ...s,
    cemeteryMap: cMap || 'old'
  };
});

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
    // A map may contain separate polygons with the same section label (for
    // example, New Cemetery's two Section R areas). Geometry must be part of
    // the key or the second area reuses plots drawn at the first area.
    const cacheKey = `${sectionId}-${rows}-${cemeteryMap}-${JSON.stringify(sectionPolygon.coordinates)}`;
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
        const baseName = sectionId.toLowerCase().startsWith('section') ? sectionId : `Section ${sectionId}`;
        const leftFrontCoord = [leftPts[i][1], leftPts[i][0]]; 
        const rightFrontCoord = [rightPts[i][1], rightPts[i][0]];
        const leftPlot = turf.polygon([[leftPts[i], leftPts[i+1], centerPts[i+1], centerPts[i], leftPts[i]]], {
            "plotNumber": i + 1, "side": "Front", "name": `${baseName}-C${i + 1}`, "section": sectionId, "row": 1, "column": i + 1, "frontCoord": leftFrontCoord, "cemeteryMap": cemeteryMap // Added cemeteryMap
        });
        const rightPlot = turf.polygon([[centerPts[i], centerPts[i+1], rightPts[i+1], rightPts[i], centerPts[i]]], {
            "plotNumber": i + 1, "side": "Back", "name": `${baseName}-C${i + (rows + 1)}`, "section": sectionId, "row": 2, "column": i + 1, "frontCoord": rightFrontCoord, "cemeteryMap": cemeteryMap // Added cemeteryMap
        });
        gravePlots.push(leftPlot);
        gravePlots.push(rightPlot);
    }
    const result = { "type": "FeatureCollection", "features": gravePlots };
    gravePlotsCache[cacheKey] = result;
    return result;
}

const getIcon = (id, panel) => {
  const defaultProps = { viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" };
  if (id === 'cemetery-map') return <svg {...defaultProps}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>;
  if (panel === 'panel-settings') return <svg {...defaultProps}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
  if (id === 'transfer-plot' || panel === 'panel-transfer-plot') return <svg {...defaultProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
  
  if (id === 'columbarium') return <svg {...defaultProps}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="2"></line><line x1="15" y1="22" x2="15" y2="2"></line><line x1="4" y1="10" x2="20" y2="10"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>;
  if (id === 'columbarium-records') return <svg {...defaultProps}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="2"></line><line x1="15" y1="22" x2="15" y2="2"></line><line x1="4" y1="10" x2="20" y2="10"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>;
  if (id === 'approvals') return <svg {...defaultProps}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
  if (id === 'mayor-dash') return <svg {...defaultProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>;
  if (id === 'planning') return <svg {...defaultProps}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>;
  if (id === 'graves') return <svg {...defaultProps}><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="7" y1="9" x2="17" y2="9"></line><line x1="7" y1="13" x2="17" y2="13"></line><line x1="7" y1="17" x2="13" y2="17"></line></svg>;
  if (id === 'users') return <svg {...defaultProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
  if (id === 'reports') return <svg {...defaultProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
  if (id === 'archive' || id === 'planning-archive') return <svg {...defaultProps}><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>;
  if (id === 'admin-dash') return <svg {...defaultProps}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>;
  if (id === 'planning-dash') return <svg {...defaultProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>;
  return null;
};

/**
 * Compatibility workspace retained while office features are migrated into the
 * dedicated admin modules. It deliberately owns its state per mounted office,
 * so switching offices cannot leak transient state between roles.
 */
export function LegacyAdminWorkspace({ active, role, roleInfo: currentRoleInfo, onLogout, theme, onToggleTheme, onShowLanding }) {
  const currentYear = new Date().getFullYear();
  const appRole = normalizeAppRole(role);
  const basePanels = navConfigs[appRole] || navConfigs.staff || [];
  const panels = useMemo(() => {
    let p = [...basePanels];

    // Inject Dashboard for Admin
    if (appRole === 'staff' && !p.some(item => item.id === 'admin-dash')) {
      p.unshift({ id: 'admin-dash', label: 'Admin Dashboard', ico: '📊', panel: 'panel-admin-dash' });
    }

    // Inject Dashboard for Planning
    if (appRole === 'planning' && !p.some(item => item.id === 'planning-dash')) {
      p.unshift({ id: 'planning-dash', label: 'Planning Dashboard', ico: '📈', panel: 'panel-planning-dash' });
    }

    if (appRole === 'planning' && !p.some(item => item.id === 'columbarium')) {
      const insertIdx = p.findIndex(item => item.id === 'graves');
      const newItems = [
        { id: 'columbarium-records', label: 'Niche Records', ico: '🏛', panel: 'panel-columbarium-records' },
        { id: 'columbarium', label: 'Apartment Niches', ico: '🗄️', panel: 'panel-columbarium' }
      ];
      if (insertIdx !== -1) {
        p.splice(insertIdx + 1, 0, ...newItems);
      } else {
        p.push(...newItems);
      }
    }
    return p;
  }, [basePanels, appRole]);

  const [selectedPanel, setSelectedPanel] = useState(panels[0]?.panel || 'panel-planning');
  const isPlanningRole = appRole === 'planning';
  const isStaffRole = appRole === 'staff';
  const isMayorRole = appRole === 'mayor';
  const [graveData, setGraveData] = useState([]);
  const [cemeteries, setCemeteries] = useState([]);
  const [sharedMapSections, setSharedMapSections] = useState([]);
  const [staffMapReady, setStaffMapReady] = useState(false);
  const [staffMapRenderState, setStaffMapRenderState] = useState('loading');
  const [planningMapRenderState, setPlanningMapRenderState] = useState('loading');
  const [staffMapLoadError, setStaffMapLoadError] = useState('');
  const [sharedMapPathways, setSharedMapPathways] = useState([]);
  const [groundPlots, setGroundPlots] = useState([]);
  const [plotManagerTarget, setPlotManagerTarget] = useState(null);
  const [groundPlotSummary, setGroundPlotSummary] = useState({ total: 0, available: 0, occupied: 0, maintenance: 0, sections: [] });
  const [plotStatusFilter, setPlotStatusFilter] = useState('all');
  const [plotSectionFilter, setPlotSectionFilter] = useState('all');
  const [plotDataError, setPlotDataError] = useState('');
  const [groundPlotsLoading, setGroundPlotsLoading] = useState(false);
  const groundPlotsRef = useRef([]);
  const lucenaGraveData = useMemo(() => {
    return graveData.filter(g => {
      const lat = parseFloat(g.latitude || g.latlng?.[0] || 0);
      // Assuming Lucena City is within this latitude range (adjust if needed)
      return lat > 0 && lat < 14.0; 
    });
  }, [graveData]);

  const occupiedGraveCount = useMemo(() => lucenaGraveData.filter((grave) => grave.status === 'occupied').length, [lucenaGraveData]);
  const availableGraveCount = useMemo(() => lucenaGraveData.filter((grave) => grave.status === 'available').length, [lucenaGraveData]);
  const [newGrave, setNewGrave] = useState({
    grave_id: '',
    name: '',
    dates: '',
    location: '',
    status: 'available',
    latitude: 14.48,
    longitude: 120.897,
    notes: '',
  });
  const [error, setError] = useState('');
  const [columbariumSection, setColumbariumSection] = useState('Section A');
  const [nicheFocusTarget, setNicheFocusTarget] = useState(null);
  const [staffMapSearchTarget, setStaffMapSearchTarget] = useState(null);
  const [columbariumFilter, setColumbariumFilter] = useState('all');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [editingGraveId, setEditingGraveId] = useState(null);
  const [viewingGrave, setViewingGrave] = useState(null);
  const [assigningGraveId, setAssigningGraveId] = useState(null);
  const adminMapContainer = useRef(null); // This is correct for the DOM element
  const [activeColumbariumMap, setActiveColumbariumMap] = useState('old'); // 'old' or 'new'

  const planningMapContainer = useRef(null);
  const [approvedApps, setApprovedApps] = useState([]);
  const [assignedApps, setAssignedApps] = useState([]);
  const [scheduledApps, setScheduledApps] = useState([]);
  const [completedApps, setCompletedApps] = useState([]);
  const [cancelledApps, setCancelledApps] = useState([]);
  const [allBurialApplications, setAllBurialApplications] = useState([]);
  const [archivedCancelledApps, setArchivedCancelledApps] = useState(() => JSON.parse(localStorage.getItem('gravetrak_archived_cancelled_apps') || '[]'));
  const [selectedCancelledApps, setSelectedCancelledApps] = useState([]);
  const [selectedPendingApps, setSelectedPendingApps] = useState([]);
  const [clearedRecords, setClearedRecords] = useState(() => JSON.parse(localStorage.getItem('gravetrak_cleared_records') || '[]'));
  const [cancelledNotifs, setCancelledNotifs] = useState(() => JSON.parse(localStorage.getItem('gravetrak_cancelled_notifs') || '[]'));
  const [supportMessages, setSupportMessages] = useState(() => JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]').filter(m => !m.resolved));
  const [viewSupportMsg, setViewSupportMsg] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [appTab, setAppTab] = useState('pending');
  const [applicationPages, setApplicationPages] = useState({});

  const allTransferRequests = supportMessages.filter(m => m.message && m.message.includes('TRANSFER PLOT REQUEST'));
  const regularMessages = supportMessages.filter(m => !(m.message && m.message.includes('TRANSFER PLOT REQUEST')));
  
  // States for the assignment modal
  const [pendingApps, setPendingApps] = useState([]);
  const [applicationSearch, setApplicationSearch] = useState('');
  const [applicationFilters, setApplicationFilters] = useState({ from: '', to: '', order: 'oldest' });
  const changeApplicationFilters = patch => {
    setApplicationFilters(current => ({ ...current, ...patch }));
    setApplicationPages({});
    setSelectedPendingApps([]);
    setSelectedCancelledApps([]);
  };
  useEffect(() => {
    setSelectedPendingApps([]);
    setSelectedCancelledApps([]);
  }, [appTab, applicationPages]);
  const [officeSearchQuery, setOfficeSearchQuery] = useState('');
  const changeApplicationSearch = value => {
    setApplicationSearch(value);
    setApplicationPages({});
    setSelectedPendingApps([]);
    setSelectedCancelledApps([]);
  };
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const inboxRef = useRef(null);
  const isMountedRef = useRef(false);
  const passiveTimeoutsRef = useRef([]);

  // States for documents modal and notify modal
  const [isDocumentsModalOpen, setIsDocumentsModalOpen] = useState(false);
  const [selectedAppForDocs, setSelectedAppForDocs] = useState(null);
  const [docVerification, setDocVerification] = useState({});
  const [docRejectReasons, setDocRejectReasons] = useState({});
  const [rejectReason, setRejectReason] = useState('');
  const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);
  const [selectedAppForNotify, setSelectedAppForNotify] = useState(null);
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyRecipient, setNotifyRecipient] = useState('Loading recipient…');
  const [notifyBusy, setNotifyBusy] = useState(false);
  const notifyKey = useRef(null);

  // States for Interview Modal
  const [isInterviewModalOpen, setIsInterviewModalOpen] = useState(false);
  const [selectedAppForInterview, setSelectedAppForInterview] = useState(null);
  const [interviewDetails, setInterviewDetails] = useState({ date: '', time: '', duration_minutes: 5, location: "Mayor's Office", notes: '' });
  const [appointmentSlots, setAppointmentSlots] = useState([]);
  const [appointmentSlotError, setAppointmentSlotError] = useState('');

  // States for Columbarium Slot Modal
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [selectedSlotDetails, setSelectedSlotDetails] = useState(null);
  const [transferNote, setTransferNote] = useState('');
  const [isNicheTransferOpen, setIsNicheTransferOpen] = useState(false);
  const [isTransferringNiche, setIsTransferringNiche] = useState(false);
  const [isEditingSlotName, setIsEditingSlotName] = useState(false);
  const [editSlotName, setEditSlotName] = useState('');
  const [isManualAssignOpen, setIsManualAssignOpen] = useState(false);
  const [manualAssignFirstName, setManualAssignFirstName] = useState('');
  const [manualAssignLastName, setManualAssignLastName] = useState('');
  const [manualAssignMI, setManualAssignMI] = useState('');
  const [manualAssignSuffix, setManualAssignSuffix] = useState('');
  const [manualAssignDOB, setManualAssignDOB] = useState('');
  const [manualAssignDOD, setManualAssignDOD] = useState('');

  // States for Audit Logs and Records Table
  const [isAuditLogsModalOpen, setIsAuditLogsModalOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordSectionFilter, setRecordSectionFilter] = useState('All Sections');
  const [columbariumPage, setColumbariumPage] = useState(1);
  const [gravePage, setGravePage] = useState(1);
  // Removed recordTab state as this panel now exclusively shows columbarium records

  // States for Rule-Based Assign Confirmation
  const [isAssignConfirmOpen, setIsAssignConfirmOpen] = useState(false);
  const [assignConfirmData, setAssignConfirmData] = useState(null);

  // States for Reports
  const [reportTab, setReportTab] = useState('pending');
  const localReportDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const reportToday = localReportDate();
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [appliedReportFilter, setAppliedReportFilter] = useState(() => ({ period: 'overall' }));
  const [reportAnalytics, setReportAnalytics] = useState(null);
  const [submittedReportPage, setSubmittedReportPage] = useState(1);
  const submittedReportTableRef = useRef(null);
  const submittedReportRows = reportAnalytics?.records || [];
  const submittedReportPageCount = Math.max(1, Math.ceil(submittedReportRows.length / 10));
  const currentSubmittedReportPage = Math.min(submittedReportPage, submittedReportPageCount);
  const visibleSubmittedReportRows = role === 'mayor'
    ? submittedReportRows.slice((currentSubmittedReportPage - 1) * 10, currentSubmittedReportPage * 10)
    : submittedReportRows;
  useEffect(() => { setSubmittedReportPage(1); }, [reportAnalytics, role]);
  const changeSubmittedReportPage = page => {
    setSubmittedReportPage(Math.max(1, Math.min(page, submittedReportPageCount)));
    submittedReportTableRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  const [reportAnalyticsError, setReportAnalyticsError] = useState('');
  const [reportAnalyticsLoading, setReportAnalyticsLoading] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [reports, setReports] = useState([]);
  const [archivedReports, setArchivedReports] = useState(() => {
    const saved = localStorage.getItem('gravetrak_archived_reports');
    return saved ? JSON.parse(saved) : [];
  });
  const [archiveTab, setArchiveTab] = useState('columbarium');
  const [planningArchiveCategory, setPlanningArchiveCategory] = useState('sections');
  const [archivedPlanningSections, setArchivedPlanningSections] = useState([]);
  const [isPlanningArchiveLoading, setIsPlanningArchiveLoading] = useState(false);
  const [planningArchiveError, setPlanningArchiveError] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [newReport, setNewReport] = useState({ title: '', content: '' });
  
  // States for User Management
  const [users, setUsers] = useState([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [userFetchError, setUserFetchError] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [editingUser, setEditingUser] = useState(null);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [originalUser, setOriginalUser] = useState(null);
  const [userManager, setUserManager] = useState(null);
  const [userSaveError, setUserSaveError] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState(null);
  const userSaveLock = useRef(false);
  const managerCan = capability => Boolean(userManager && (userManager.permissions?.length
    ? userManager.permissions.includes(capability)
    : ['mayor', 'admin'].includes(userManager.role)));

  const [activeAdminCemetery, setActiveAdminCemetery] = useState('old'); // 'old' or 'new'
  const [staffMapStatusFilter, setStaffMapStatusFilter] = useState('all');
  const [staffMapSectionFilter, setStaffMapSectionFilter] = useState('all');
  const newCemeteryGeoJson = anotherMapData;
  
  const [isMayorAnalyticsModalOpen, setIsMayorAnalyticsModalOpen] = useState(false);
  const [compareMonthIndex, setCompareMonthIndex] = useState(new Date().getMonth() === 0 ? 11 : new Date().getMonth() - 1);
  const [liveAnalyticsData, setLiveAnalyticsData] = useState(null);
  const [activeMayorCemetery, setActiveMayorCemetery] = useState('old');

  const [activePlanningCemetery, setActivePlanningCemetery] = useState(() =>
    localStorage.getItem('gravetrak_planning_cemetery') === 'new' ? 'new' : 'old'
  );
  const [planningOverlaysReady, setPlanningOverlaysReady] = useState(false);
  const [planningReloadToken, setPlanningReloadToken] = useState(0);
  useEffect(() => {
    localStorage.setItem('gravetrak_planning_cemetery', activePlanningCemetery);
  }, [activePlanningCemetery]);
  const visibleGroundPlots = useMemo(() => groundPlots.filter((plot) => {
    if ((plot.cemetery_code || 'old') !== activePlanningCemetery) return false;
    if (plotSectionFilter !== 'all' && (plot.section_name || plot.section) !== plotSectionFilter) return false;
    if (plotStatusFilter !== 'all' && plot.status !== plotStatusFilter) return false;
    if (recordSearch) {
      const query = recordSearch.toLowerCase();
      return plot.plot_id.toLowerCase().includes(query) || (plot.location_description || '').toLowerCase().includes(query);
    }
    return true;
  }), [groundPlots, activePlanningCemetery, plotSectionFilter, plotStatusFilter, recordSearch]);
  const activeGroundPlotSummary = useMemo(() => {
    const rows = groundPlots.filter(plot => (plot.cemetery_code || 'old') === activePlanningCemetery);
    return {
      total: rows.length,
      available: rows.filter(plot => plot.status === 'available').length,
      occupied: rows.filter(plot => plot.status === 'occupied').length,
      maintenance: rows.filter(plot => plot.status === 'maintenance').length,
    };
  }, [groundPlots, activePlanningCemetery]);
  const groundPlotSectionOptions = useMemo(() => Array.from(new Set(
    groundPlots.filter(plot => (plot.cemetery_code || 'old') === activePlanningCemetery)
      .map(plot => plot.section_name || plot.section).filter(Boolean)
  )).sort(), [groundPlots, activePlanningCemetery]);
  // State to track which reports are expanded/opened
  const [expandedReports, setExpandedReports] = useState([]);

  // States for Drawing Tool
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [newSectionGeometry, setNewSectionGeometry] = useState(null);
  const unsavedSectionLayerRef = useRef(null);
  const [isSavingSection, setIsSavingSection] = useState(false);
  const [sectionFormError, setSectionFormError] = useState('');
  const [drawPointCount, setDrawPointCount] = useState(0);
  const [isNewSectionModalOpen, setIsNewSectionModalOpen] = useState(false);
  const [isSectionMethodOpen, setIsSectionMethodOpen] = useState(false);
  const [isCoordinateModalOpen, setIsCoordinateModalOpen] = useState(false);
  const [collapsedPlanningPanels, setCollapsedPlanningPanels] = useState({ capacity: false, tools: false, zones: false });
  const togglePlanningPanel = (panel) => setCollapsedPlanningPanels(current => ({ ...current, [panel]: !current[panel] }));
  const [sectionCorners, setSectionCorners] = useState(Array.from({ length: 4 }, () => ({ lat: '', lng: '' })));
  const [cemeterySections, setCemeterySections] = useState([]); // Fallback Initial State: Initialize as empty array
  const activeCemeterySections = useMemo(
    () => cemeterySections.filter(section => section.properties?.is_active !== false),
    [cemeterySections]
  );
  const planningSectionsByCemetery = useMemo(() => ({
    old: resolvePlanningSections(cemeterySections, siteData.features, 'old'),
    new: resolvePlanningSections(cemeterySections, (newCemeteryGeoJson || anotherMapData)?.features || [], 'new'),
  }), [cemeterySections, newCemeteryGeoJson]);
  const zonesSidebarSections = planningSectionsByCemetery[activePlanningCemetery];
  const [cemeterySectionsError, setCemeterySectionsError] = useState('');
  const [newSectionData, setNewSectionData] = useState({ name: '', zone_code: '', description: '', is_active: true, status: 'active', estimated_stack_height: 1, rows: 1, columns: 8, orientation: 'horizontal' });
  const [editingZone, setEditingZone] = useState(null);
  const [cemeteryPathways, setCemeteryPathways] = useState([]);
  const [isDrawingPathway, setIsDrawingPathway] = useState(false);
  const isDrawingPathwayRef = useRef(false);
  const [pathwayPointCount, setPathwayPointCount] = useState(0);
  const [newPathwayGeometry, setNewPathwayGeometry] = useState(null);
  const [isPathwayModalOpen, setIsPathwayModalOpen] = useState(false);
  const [isSavingPathway, setIsSavingPathway] = useState(false);
  const [newPathwayData, setNewPathwayData] = useState({ name: '', pathway_type: 'walkway', width_meters: 2, description: '' });
  const [editingPathway, setEditingPathway] = useState(null);
  const [selectedPathwayKey, setSelectedPathwayKey] = useState(null);
  const [selectedZoneName, setSelectedZoneName] = useState(null);
  const [planningSearchQuery, setPlanningSearchQuery] = useState('');
  const unsavedPathwayLayerRef = useRef(null);
  useEffect(() => {
    isDrawingPathwayRef.current = isDrawingPathway;
  }, [isDrawingPathway]);
  const pathwaysSidebarItems = useMemo(() => {
    const importedIds = new Set(cemeteryPathways.map(pathway => {
      const match = String(pathway.properties?.description || '').match(/\[legacy-path:([^\]]+)\]/);
      return match?.[1];
    }).filter(Boolean));
    const sourceFeatures = activePlanningCemetery === 'new'
      ? (anotherMapData?.features || []).filter(feature => feature.geometry?.type === 'LineString' && feature.properties?.name === 'path')
      : pathwaysGeoJson.features;
    const originalPaths = sourceFeatures.map((feature, index) => {
      const sourceId = `${activePlanningCemetery}-${feature.id || index}`;
      if (importedIds.has(sourceId)) return null;
      return {
        ...feature,
        id: `legacy-path-${sourceId}`,
        isLegacyPathway: true,
        legacySourceId: sourceId,
        properties: {
          ...feature.properties,
          name: `Existing Pathway ${index + 1}`,
          pathway_type: 'road',
          width_meters: 4,
          cemetery_code: activePlanningCemetery,
        },
      };
    }).filter(Boolean);
    return [...cemeteryPathways.filter(pathway => (pathway.properties?.cemetery_code || 'old') === activePlanningCemetery), ...originalPaths];
  }, [cemeteryPathways, activePlanningCemetery]);
  const planningSearchTerm = planningSearchQuery.trim().toLocaleLowerCase();
  const filteredPlanningZones = useMemo(() => !planningSearchTerm ? zonesSidebarSections : zonesSidebarSections.filter(zone => {
    const props = zone.properties || {};
    return [props.name, props.zone_code, props.description].some(value => String(value || '').toLocaleLowerCase().includes(planningSearchTerm));
  }), [zonesSidebarSections, planningSearchTerm]);
  const filteredPlanningPathways = useMemo(() => !planningSearchTerm ? pathwaysSidebarItems : pathwaysSidebarItems.filter(pathway => {
    const props = pathway.properties || {};
    return [props.name, props.pathway_type, props.description].some(value => String(value || '').toLocaleLowerCase().includes(planningSearchTerm));
  }), [pathwaysSidebarItems, planningSearchTerm]);
  const getPathwaySidebarId = useCallback((key) => `pathway-sidebar-${String(key).replace(/[^A-Za-z0-9_-]/g, '-')}`, []);
  const revealPathwayInSidebar = useCallback((key) => {
    setSelectedPathwayKey(String(key));
    setCollapsedPlanningPanels(current => ({ ...current, zones: false }));
    window.setTimeout(() => {
      document.getElementById(getPathwaySidebarId(key))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, [getPathwaySidebarId]);
  const zonesPanelRef = useRef(null);
  const [pendingZoneReveal, setPendingZoneReveal] = useState(null);
  const getZoneSidebarId = useCallback((name) => planningSectionSidebarId(name, activePlanningCemetery), [activePlanningCemetery]);
  const revealZoneInSidebar = useCallback((name, cemetery = activePlanningCemetery) => {
    const zone = findPlanningSection(planningSectionsByCemetery[cemetery] || [], name);
    if (!zone) return;
    const normalizedName = normalizeSectionName(zone.properties.name);
    setActivePlanningCemetery(cemetery);
    setPlanningSearchQuery('');
    setSelectedPathwayKey(null);
    setSelectedZoneName(normalizedName);
    setCollapsedPlanningPanels(current => ({ ...current, zones: false }));
    // A new request also lets repeated clicks re-center the same card.
    setPendingZoneReveal({ name: normalizedName, cemetery });
  }, [activePlanningCemetery, planningSectionsByCemetery]);
  useEffect(() => {
    if (!pendingZoneReveal || collapsedPlanningPanels.zones || activePlanningCemetery !== pendingZoneReveal.cemetery || selectedPanel !== 'panel-planning') return;
    // Wait for React to expand the panel and render the cleared search results.
    const frame = requestAnimationFrame(() => {
      const panel = zonesPanelRef.current;
      const card = document.getElementById(planningSectionSidebarId(pendingZoneReveal.name, pendingZoneReveal.cemetery));
      if (!panel || !card || !panel.contains(card)) return;
      const top = panel.scrollTop + card.getBoundingClientRect().top - panel.getBoundingClientRect().top
        - Math.max(0, (panel.clientHeight - card.offsetHeight) / 2);
      panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      setPendingZoneReveal(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingZoneReveal, collapsedPlanningPanels.zones, activePlanningCemetery, filteredPlanningZones, selectedPanel]);
  const [layoutZone, setLayoutZone] = useState(null);
  const [isGraveLayoutModalOpen, setIsGraveLayoutModalOpen] = useState(false);
  const [graveLayoutData, setGraveLayoutData] = useState({ rows: 4, columns: 8, floors: 1, orientation: 'horizontal' });
  const [isGeneratingGraveLayout, setIsGeneratingGraveLayout] = useState(false);
  const graveLayoutPreviewCount = useMemo(() => {
    const rows = Number(graveLayoutData.rows);
    const columns = Number(graveLayoutData.columns);
    const geometry = layoutZone?.geometry;
    const ring = geometry?.coordinates?.[0];
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || !Array.isArray(ring) || ring.length < 4) return 0;
    const vertices = ring.slice(0, -1);
    if (vertices.length === 4) return rows * columns;
    const longitudes = vertices.map(point => Number(point[0]));
    const latitudes = vertices.map(point => Number(point[1]));
    const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    let count = 0;
    for (let row = 1; row <= rows; row += 1) {
      const lat = maxLat - ((row - 0.5) / rows) * (maxLat - minLat);
      for (let column = 1; column <= columns; column += 1) {
        const lng = graveLayoutData.orientation === 'vertical'
          ? minLng + ((column - 0.5) / columns) * (maxLng - minLng)
          : minLng + ((row - 0.5) / rows) * (maxLng - minLng);
        const orientedLat = graveLayoutData.orientation === 'vertical'
          ? lat
          : maxLat - ((column - 0.5) / columns) * (maxLat - minLat);
        if (!window.turf?.booleanPointInPolygon || window.turf.booleanPointInPolygon(window.turf.point([lng, orientedLat]), geometry)) count += 1;
      }
    }
    return count;
  }, [graveLayoutData.rows, graveLayoutData.columns, graveLayoutData.orientation, layoutZone]);
  const toggleReportExpand = (id) => {
    setExpandedReports(prev => prev.includes(id) ? prev.filter(rId => rId !== id) : [...prev, id]);
  };
  const [uiScale, setUiScale] = useState(() => localStorage.getItem('gravetrak_ui_scale') || 'standard');
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('gravetrak_high_contrast') === 'true');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 768);

  // States for Top Level Toast Notifications
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const showToast = useCallback((message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      passiveTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      passiveTimeoutsRef.current = [];
    };
  }, []);

  const schedulePassiveTimeout = (callback, delay) => {
    const timeoutId = setTimeout(() => {
      passiveTimeoutsRef.current = passiveTimeoutsRef.current.filter((id) => id !== timeoutId);
      if (isMountedRef.current) callback();
    }, delay);
    passiveTimeoutsRef.current.push(timeoutId);
    return timeoutId;
  };

  const safeInvalidateMap = (mapInstance) => {
    if (!mapInstance) return;
    try {
      mapInstance.invalidateSize();
    } catch (_) {
      // Leaflet may be between layout transitions or teardown.
    }
  };

  const safeFlyToMap = (mapInstance, coords, zoom = 21) => {
    if (!mapInstance) return;
    const target = sanitizeLatLng(coords, null);
    if (!target) return;
    try {
      mapInstance.flyTo(target, zoom);
    } catch (_) {
      // Leaflet may be between panel transitions or teardown.
    }
  };

  // Function to activate drawing mode
  const removeUnsavedSectionLayer = () => {
    const layer = unsavedSectionLayerRef.current;
    const map = planningMapRef.current;
    if (layer && map?.__drawnItems?.hasLayer(layer)) map.__drawnItems.removeLayer(layer);
    unsavedSectionLayerRef.current = null;
    setDrawPointCount(0);
    setNewSectionGeometry(null);
  };

  const stopManualSectionDrawing = () => {
    const map = planningMapRef.current;
    if (map?.__sectionDrawingClickHandler) map.off('click', map.__sectionDrawingClickHandler);
    if (map) {
      map.__sectionDrawingClickHandler = null;
      map.__sectionDraftLatLngs = [];
    }
  };

  const cancelSectionDrawing = () => {
    const map = planningMapRef.current;
    stopManualSectionDrawing();
    if (map?.__activePolygonDrawer) {
      map.__activePolygonDrawer.disable();
      map.__activePolygonDrawer = null;
    }
    if (map?.__currentDrawControl) {
      map.removeControl(map.__currentDrawControl);
      map.__currentDrawControl = null;
    }
    removeUnsavedSectionLayer();
    setIsDrawingMode(false);
    setIsNewSectionModalOpen(false);
    setEditingZone(null);
    showToast('Section drawing cancelled. Nothing was saved.', 'info');
  };

  const renderSectionDraft = (map, points) => {
    if (unsavedSectionLayerRef.current && map.__drawnItems?.hasLayer(unsavedSectionLayerRef.current)) {
      map.__drawnItems.removeLayer(unsavedSectionLayerRef.current);
    }
    unsavedSectionLayerRef.current = null;
    if (!points.length) return;

    const draftGroup = L.featureGroup();
    const previewOptions = {
      color: '#1687C9',
      weight: 4,
      dashArray: points.length < 3 ? '8 6' : null,
      fillColor: '#1687C9',
      fillOpacity: points.length >= 3 ? 0.25 : 0,
      interactive: false,
    };
    const preview = points.length >= 3
      ? L.polygon(points, previewOptions)
      : L.polyline(points, previewOptions);
    draftGroup.addLayer(preview);

    points.forEach((point, index) => {
      const isFirst = index === 0;
      const marker = L.circleMarker(point, {
        radius: isFirst ? 8 : 6,
        color: '#FFFFFF',
        weight: 3,
        fillColor: isFirst ? '#F59E0B' : '#1687C9',
        fillOpacity: 1,
        opacity: 1,
        interactive: false,
      });
      marker.bindTooltip(String(index + 1), {
        permanent: true,
        direction: 'center',
        className: 'section-point-label',
        opacity: 1,
      });
      draftGroup.addLayer(marker);
    });

    map.__drawnItems.addLayer(draftGroup);
    unsavedSectionLayerRef.current = draftGroup;
  };

  const activateDrawing = () => {
    if (planningMapRef.current && L.polygon && L.polyline) {
      const map = planningMapRef.current;
      stopManualSectionDrawing();
      removeUnsavedSectionLayer();
      setEditingZone(null);
      setNewSectionData({ name: '', zone_code: '', description: '', is_active: true, status: 'active', estimated_stack_height: 1, rows: 1, columns: 8, orientation: 'horizontal' });
      if (map.__activePolygonDrawer) {
        map.__activePolygonDrawer.disable();
        map.__activePolygonDrawer = null;
      }
      map.__sectionDraftLatLngs = [];
      const handleDraftClick = (event) => {
        const target = event.originalEvent?.target;
        if (target?.closest?.('.map-fab, .cemetery-switcher-container, .leaflet-control')) return;
        map.__sectionDraftLatLngs.push(event.latlng);
        setDrawPointCount(map.__sectionDraftLatLngs.length);
        renderSectionDraft(map, map.__sectionDraftLatLngs);
      };
      map.__sectionDrawingClickHandler = handleDraftClick;
      map.on('click', handleDraftClick);
      setIsDrawingMode(true);
      showToast('Click as many boundary points as needed, then press Finish Section.', 'info');
    } else {
      console.error("Leaflet map or drawing library not ready.");
      showToast('Map drawing tool not available.', 'error');
    }
  };

  const redrawSectionBoundary = () => {
    const map = planningMapRef.current;
    if (!editingZone || !map || !L.polygon || !L.polyline) return showToast('Map drawing tool not available.', 'error');
    stopManualSectionDrawing();
    removeUnsavedSectionLayer();
    map.__sectionDraftLatLngs = [];
    const handleDraftClick = (event) => {
      const target = event.originalEvent?.target;
      if (target?.closest?.('.map-fab, .cemetery-switcher-container, .leaflet-control')) return;
      map.__sectionDraftLatLngs.push(event.latlng);
      setDrawPointCount(map.__sectionDraftLatLngs.length);
      renderSectionDraft(map, map.__sectionDraftLatLngs);
    };
    map.__sectionDrawingClickHandler = handleDraftClick;
    map.on('click', handleDraftClick);
    setIsNewSectionModalOpen(false);
    setIsDrawingMode(true);
    showToast('Draw the replacement boundary, then press Finish Section.', 'info');
  };

  const chooseSectionMethod = () => {
    setSelectedPanel('panel-planning');
    setCollapsedPlanningPanels(current => ({ ...current, tools: false }));
    setIsSectionMethodOpen(true);
  };

  const openCoordinateSection = () => {
    const map = planningMapRef.current;
    if (!map?.__drawnItems) return showToast('Map drawing tool not available.', 'error');
    stopManualSectionDrawing();
    removeUnsavedSectionLayer();
    setEditingZone(null);
    setNewSectionData({ name: '', zone_code: '', description: '', is_active: true, status: 'active', estimated_stack_height: 1, rows: 1, columns: 8, orientation: 'horizontal' });
    setSectionCorners(Array.from({ length: 4 }, () => ({ lat: '', lng: '' })));
    setIsCoordinateModalOpen(true);
  };

  const selectSectionMethod = (method) => {
    setIsSectionMethodOpen(false);
    if (method === 'coordinates') openCoordinateSection();
    else activateDrawing();
  };

  const previewCoordinateSection = () => {
    const points = sectionCorners.map(corner => ({ lat: Number(corner.lat), lng: Number(corner.lng) }));
    if (sectionCorners.some(corner => !String(corner.lat).trim() || !String(corner.lng).trim()) ||
        points.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180)) {
      return showToast('Enter valid latitude and longitude for all four corners.', 'error');
    }
    if (new Set(points.map(point => `${point.lat},${point.lng}`)).size !== 4) {
      return showToast('All four corners must be different.', 'error');
    }
    const ring = [...points.map(point => [point.lng, point.lat]), [points[0].lng, points[0].lat]];
    const geometry = { type: 'Polygon', coordinates: [ring] };
    try {
      const polygon = window.turf?.polygon([ring]);
      if (polygon && (window.turf.area(polygon) < 0.01 || window.turf.kinks?.(polygon)?.features?.length)) {
        return showToast('Corners form an invalid or crossing polygon. Enter them in boundary order.', 'error');
      }
      const boundary = cemeteries.find(cemetery => cemetery.code === activePlanningCemetery)?.boundary_geometry?.coordinates;
      if (polygon && Array.isArray(boundary) && boundary.length >= 3) {
        const closed = boundary[0][0] === boundary[boundary.length - 1][0] && boundary[0][1] === boundary[boundary.length - 1][1]
          ? boundary : [...boundary, boundary[0]];
        if (!window.turf.booleanWithin(polygon, window.turf.polygon([closed]))) {
          return showToast('This section must be inside the selected cemetery boundary.', 'error');
        }
      }
    } catch (_) {
      return showToast('Invalid polygon. Check the corner order and coordinates.', 'error');
    }
    const map = planningMapRef.current;
    if (!map?.__drawnItems) return showToast('Map drawing tool not available.', 'error');
    renderSectionDraft(map, points);
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 21 });
    setNewSectionGeometry(geometry);
    setIsCoordinateModalOpen(false);
    setIsNewSectionModalOpen(true);
  };

  const finishSectionDrawing = () => {
    const map = planningMapRef.current;
    const points = map?.__sectionDraftLatLngs || [];
    if (points.length < 3) {
      showToast('Add at least three points before finishing the section.', 'error');
      return;
    }
    const coordinates = points.map(point => [point.lng, point.lat]);
    coordinates.push([...coordinates[0]]);
    const geometry = { type: 'Polygon', coordinates: [coordinates] };
    const selectedCemetery = cemeteries.find(cemetery => cemetery.code === activePlanningCemetery);
    const boundaryCoordinates = selectedCemetery?.boundary_geometry?.coordinates;
    if (window.turf && Array.isArray(boundaryCoordinates) && boundaryCoordinates.length >= 3) {
      const first = boundaryCoordinates[0];
      const last = boundaryCoordinates[boundaryCoordinates.length - 1];
      const closedBoundary = first[0] === last[0] && first[1] === last[1] ? boundaryCoordinates : [...boundaryCoordinates, first];
      try {
        if (!window.turf.booleanWithin(window.turf.polygon(geometry.coordinates), window.turf.polygon([closedBoundary]))) {
          showToast('This section must be inside the selected cemetery boundary.', 'error');
          return;
        }
      } catch (_) {
        showToast('The polygon geometry is invalid. Adjust the points and try again.', 'error');
        return;
      }
    }
    stopManualSectionDrawing();
    setNewSectionGeometry(geometry);
    setIsDrawingMode(false);
    setIsNewSectionModalOpen(true);
  };

  const undoSectionPoint = () => {
    const map = planningMapRef.current;
    const points = map?.__sectionDraftLatLngs || [];
    if (!points.length) return;
    points.pop();
    setDrawPointCount(points.length);
    renderSectionDraft(map, points);
  };

  const clearPathwayDraft = () => {
    const map = planningMapRef.current;
    if (map?.__pathwayDrawingClickHandler) map.off('click', map.__pathwayDrawingClickHandler);
    map && (map.__pathwayDrawingClickHandler = null);
    map && (map.__pathwayDraftLatLngs = []);
    if (unsavedPathwayLayerRef.current && map?.__drawnItems?.hasLayer(unsavedPathwayLayerRef.current)) {
      map.__drawnItems.removeLayer(unsavedPathwayLayerRef.current);
    }
    unsavedPathwayLayerRef.current = null;
    setPathwayPointCount(0);
  };

  const renderPathwayDraft = (map, points) => {
    if (unsavedPathwayLayerRef.current && map.__drawnItems?.hasLayer(unsavedPathwayLayerRef.current)) {
      map.__drawnItems.removeLayer(unsavedPathwayLayerRef.current);
    }
    const group = L.featureGroup();
    if (points.length) group.addLayer(L.polyline(points, { color: '#0ea5e9', weight: 7, opacity: .9, dashArray: points.length < 2 ? '6 6' : null, lineCap: 'round', lineJoin: 'round', interactive: false }));
    points.forEach((point, index) => group.addLayer(L.circleMarker(point, { radius: index === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: index === 0 ? '#f59e0b' : '#0ea5e9', fillOpacity: 1, interactive: false })));
    map.__drawnItems.addLayer(group);
    unsavedPathwayLayerRef.current = group;
  };

  const activatePathwayDrawing = () => {
    const map = planningMapRef.current;
    if (!map || !L.polyline) return showToast('Map drawing tool not available.', 'error');
    if (isDrawingMode) cancelSectionDrawing();
    clearPathwayDraft();
    setEditingPathway(null);
    setNewPathwayData({ name: '', pathway_type: 'walkway', width_meters: 2, description: '' });
    map.__pathwayDraftLatLngs = [];
    const handler = (event) => {
      const target = event.originalEvent?.target;
      if (target?.closest?.('.map-fab, .cemetery-switcher-container, .leaflet-control')) return;
      map.__pathwayDraftLatLngs.push(event.latlng);
      setPathwayPointCount(map.__pathwayDraftLatLngs.length);
      renderPathwayDraft(map, map.__pathwayDraftLatLngs);
    };
    map.__pathwayDrawingClickHandler = handler;
    map.on('click', handler);
    isDrawingPathwayRef.current = true;
    setIsDrawingPathway(true);
    showToast('Click along the pathway, then press Finish Pathway.', 'info');
  };

  const undoPathwayPoint = () => {
    const map = planningMapRef.current;
    const points = map?.__pathwayDraftLatLngs || [];
    if (!points.length) return;
    points.pop();
    setPathwayPointCount(points.length);
    renderPathwayDraft(map, points);
  };

  const cancelPathwayDrawing = () => {
    clearPathwayDraft();
    isDrawingPathwayRef.current = false;
    setIsDrawingPathway(false);
    setIsPathwayModalOpen(false);
    setNewPathwayGeometry(null);
    setEditingPathway(null);
    showToast('Pathway drawing cancelled. Nothing was saved.', 'info');
  };

  const openEditPathwayModal = (pathway) => {
    const props = pathway.properties || {};
    setEditingPathway({
      id: pathway.id || props.id,
      isLegacy: Boolean(pathway.isLegacyPathway),
      legacySourceId: pathway.legacySourceId,
      geometry: pathway.geometry,
    });
    setNewPathwayGeometry(pathway.geometry);
    setNewPathwayData({
      name: props.name || 'Cemetery Pathway',
      pathway_type: props.pathway_type || 'road',
      width_meters: Number(props.width_meters || 4),
      description: props.description || '',
    });
    setIsPathwayModalOpen(true);
  };

  const redrawPathway = () => {
    const map = planningMapRef.current;
    if (!editingPathway || !map || !L.polyline) return showToast('Map drawing tool not available.', 'error');
    clearPathwayDraft();
    map.__pathwayDraftLatLngs = [];
    const handler = (event) => {
      const target = event.originalEvent?.target;
      if (target?.closest?.('.map-fab, .cemetery-switcher-container, .leaflet-control')) return;
      map.__pathwayDraftLatLngs.push(event.latlng);
      setPathwayPointCount(map.__pathwayDraftLatLngs.length);
      renderPathwayDraft(map, map.__pathwayDraftLatLngs);
    };
    map.__pathwayDrawingClickHandler = handler;
    map.on('click', handler);
    setIsPathwayModalOpen(false);
    isDrawingPathwayRef.current = true;
    setIsDrawingPathway(true);
    showToast('Draw the replacement route, then press Finish Pathway.', 'info');
  };

  const finishPathwayDrawing = () => {
    const map = planningMapRef.current;
    const points = map?.__pathwayDraftLatLngs || [];
    if (points.length < 2) return showToast('Add at least two points before finishing the pathway.', 'error');
    const uniquePoints = new Set(points.map(point => `${point.lat.toFixed(8)},${point.lng.toFixed(8)}`));
    if (uniquePoints.size < 2) return showToast('The pathway needs two different points.', 'error');
    const geometry = { type: 'LineString', coordinates: points.map(point => [point.lng, point.lat]) };
    // A pathway is an open LineString. Unlike a section Polygon, its last
    // point must not be forced back to the first point. The API performs the
    // cemetery-boundary validation when the completed route is saved.
    if (map.__pathwayDrawingClickHandler) map.off('click', map.__pathwayDrawingClickHandler);
    map.__pathwayDrawingClickHandler = null;
    setNewPathwayGeometry(geometry);
    isDrawingPathwayRef.current = false;
    setIsDrawingPathway(false);
    setIsPathwayModalOpen(true);
  };

  const savePathway = async () => {
    if (!newPathwayData.name.trim()) return showToast('Pathway name is required.', 'error');
    if (!newPathwayGeometry) return showToast('Draw the pathway before saving.', 'error');
    setIsSavingPathway(true);
    try {
      const description = editingPathway?.isLegacy
        ? `${newPathwayData.description || ''} [legacy-path:${editingPathway.legacySourceId}]`.trim()
        : newPathwayData.description;
      const payload = {
        cemetery: cemeteries.find(cemetery => cemetery.code === activePlanningCemetery)?.id,
        ...newPathwayData,
        description,
        width_meters: Number(newPathwayData.width_meters),
        geometry: newPathwayGeometry,
      };
      if (editingPathway && !editingPathway.isLegacy) {
        await updateCemeteryPathway(editingPathway.id, payload);
      } else {
        await createCemeteryPathway(payload);
      }
      const refreshed = await fetchCemeteryPathways();
      setCemeteryPathways(Array.isArray(refreshed?.features) ? refreshed.features : []);
      clearPathwayDraft();
      setNewPathwayGeometry(null);
      setEditingPathway(null);
      setIsPathwayModalOpen(false);
      showToast(`Pathway "${newPathwayData.name}" ${editingPathway ? 'updated' : 'saved'} successfully!`);
    } catch (err) { showToast(`Failed to save pathway: ${err.message}`, 'error'); }
    finally { setIsSavingPathway(false); }
  };

  const archivePathway = async (pathway) => {
    try {
      await updateCemeteryPathway(pathway.id || pathway.properties?.id, { is_active: false });
      setCemeteryPathways(current => current.filter(item => (item.id || item.properties?.id) !== (pathway.id || pathway.properties?.id)));
      showToast('Pathway archived successfully.');
    } catch (err) { showToast(`Unable to archive pathway: ${err.message}`, 'error'); }
  };

  const normalizeUserPayload = (payload) => {
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    if (!Array.isArray(payload) && !Array.isArray(payload?.results) && !Array.isArray(payload?.data)) {
      console.error('Unexpected users API payload shape:', payload);
    }

    return rows.map((user) => ({
      ...user,
      email: user.email || user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      role: String(user.role || 'user').toLowerCase(),
      contact_number: user.contact_number || '',
      is_active: user.is_active !== false,
    }));
  };

  const fetchAllUsers = async () => {
    setIsUsersLoading(true);
    setUserFetchError('');
    try {
      const [payload, manager] = await Promise.all([fetchUsers(), getProfile()]);
      setUserManager(manager);
      setUsers(normalizeUserPayload(payload));
    } catch (err) {
      console.error('User payload fetch failed:', {
        status: err.status,
        message: err.message,
        payload: err.data || err.response || err,
      });
      setUsers([]);
      const message = err.status === 401
        ? 'Unable to load users: authentication token was rejected.'
        : err.status === 403
          ? 'Unable to load users: this account is not authorized to view all users.'
          : `Unable to load users: ${err.message}`;
      setUserFetchError(message);
      showToast(message, 'error');
    } finally {
      setIsUsersLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPanel === 'panel-users') {
      fetchAllUsers();
    }
  }, [selectedPanel]);

  const handleEditUser = (user) => {
    setOriginalUser(user);
    setUserSaveError('');
    setEditingUser({ ...user, permissions: Array.isArray(user.permissions) ? user.permissions : [] });
    setIsEditUserModalOpen(true);
  };

  const handleSaveUserEdit = async () => {
    if (!editingUser || userSaveLock.current) return;
    const creating = !editingUser.id;
    if (creating && editingUser.password !== editingUser.password_confirmation) {
      setUserSaveError('Passwords do not match.');
      return;
    }

    userSaveLock.current = true;
    setUserSaveError('');
    setIsSavingUser(true);
    try {
      const payload = {
        email: editingUser.email,
        first_name: editingUser.first_name,
        last_name: editingUser.last_name,
        role: editingUser.role,
        contact_number: editingUser.contact_number || '',
        permissions: editingUser.permissions || [],
        is_active: editingUser.is_active,
      };
      const savedUser = creating
        ? await createUser({ ...payload, password: editingUser.password })
        : await updateUser(editingUser.id, buildUserPatch(originalUser, payload));
      await fetchAllUsers();
      showToast(`User ${editingUser.first_name} ${editingUser.last_name} ${creating ? 'created' : 'updated'} successfully.`);
      
      const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Cemetery Staff';
      try {
      const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
      logs.unshift({
        id: Date.now(),
        date: new Date().toLocaleString(),
        user: userName,
        action: creating ? 'Created User' : 'Edited User Profile',
        details: `${creating ? 'Created' : 'Edited'} user: ${editingUser.first_name} ${editingUser.last_name} (ID: ${savedUser.id})`
      });
      localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
      } catch { /* A local audit-storage failure must not report a successful save as failed. */ }
      setIsEditUserModalOpen(false);
      setEditingUser(null);
      setOriginalUser(null);
    } catch (err) {
      console.error('User update failed:', {
        status: err.status,
        message: err.message,
        payload: err.data || err.response || err,
      });
      showToast(`Failed to update user: ${err.message}`, 'error');
      setUserSaveError(err.message);
    } finally {
      userSaveLock.current = false;
      setIsSavingUser(false);
    }
  };

  const handleCancelUserEdit = () => {
    if (userSaveLock.current) return;
    setIsEditUserModalOpen(false);
    setEditingUser(null);
    setOriginalUser(null);
    setUserSaveError('');
  };

  const handleSetUserActive = async (user, isActive) => {
    if (userSaveLock.current) return;
    userSaveLock.current = true;
    setUpdatingUserId(user.id);
    try {
      await updateUser(user.id, { is_active: isActive });
      await fetchAllUsers();
      showToast(`${user.first_name || user.email} ${isActive ? 'activated' : 'deactivated'} successfully.`, 'info');
    } catch (err) {
      console.error('User active-state update failed:', {
        status: err.status,
        message: err.message,
        payload: err.data || err.response || err,
      });
      showToast(`Failed to update user status: ${err.message}`, 'error');
    } finally {
      userSaveLock.current = false;
      setUpdatingUserId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = String(userSearchQuery || '').trim().toLowerCase();
    const roleFilter = String(userRoleFilter || 'all').trim().toLowerCase();
    const showAllRoles = roleFilter === 'all' || roleFilter === 'all roles';

    return users.filter((user) => {
      const roleValue = String(user.role || 'user').trim().toLowerCase();
      const roleMatch = showAllRoles || roleValue === roleFilter;
      if (!roleMatch) return false;
      if (!query) return true;

      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
      const email = String(user.email || user.username || '').toLowerCase();
      return fullName.includes(query) || email.includes(query);
    });
  }, [users, userSearchQuery, userRoleFilter]);

// Pagination for Users (10 per page)
const USER_PAGE_SIZE = 10;
const [userPage, setUserPage] = useState(1);
const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
const paginatedUsers = filteredUsers.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE);

  useEffect(() => { setUserPage(1); }, [filteredUsers]);

// State for Custom Confirmation Modal
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', isDestructive: true, onConfirm: null });
  const showConfirm = useCallback((title, message, onConfirm, isDestructive = true) => {
    setConfirmDialog({ isOpen: true, title, message, isDestructive, onConfirm });
  }, []);

  const loadApps = useCallback(() => {
    fetchBurialApplications()
      .then((data) => {
        if (Array.isArray(data)) {
          const demoStatuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
          const demoInterviews = JSON.parse(localStorage.getItem('gravetrak_demo_interviews') || '{}');
          
          const mergedData = data.map(app => {
            // Approval/assignment/completion must come from the saved API record.
            let st = demoStatuses[String(app.id)] === 'cancelled' ? 'cancelled' : app.status;
            let display = app.status_display || st;
            
            if (st === 'approved') display = 'Approved';
            else if (st === 'documents_complete') display = 'Ready for Scheduling';
            else if (st === 'rejected') display = 'Disapproved';
            else if (['scheduled', 'for_interview'].includes(st)) display = 'Scheduled';
            else if (st === 'slot_assigned' || st === 'fully_approved') display = 'Approved & Assigned';
            else if (st === 'completed') display = 'Completed';
            else if (st === 'action_required') display = 'Action Required';
            else if (['pending_review', 'pending', 'review'].includes(st.toLowerCase())) display = 'In Review';
            
            let calcAge = app.deceased_age;
            if (app.deceased_date_of_birth) {
              const bDate = new Date(app.deceased_date_of_birth);
              const eDate = app.deceased_date_of_death ? new Date(app.deceased_date_of_death) : new Date();
              let age = eDate.getFullYear() - bDate.getFullYear();
              const m = eDate.getMonth() - bDate.getMonth();
              if (m < 0 || (m === 0 && eDate.getDate() < bDate.getDate())) {
                age--;
              }
              if (!isNaN(age) && age >= 0) calcAge = age;
            }

            const interview = demoInterviews[String(app.id)];
            return { 
              ...app, 
              status: st, 
              status_display: display,
              deceased_age: calcAge !== null && calcAge !== undefined && calcAge !== '' ? calcAge.toString() : '',
              interview_date: interview?.date || app.interview_date,
              interview_time: interview?.time || app.interview_time,
              interview_location: interview?.location || app.interview_location
            };
          });
          
          mergedData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          setAllBurialApplications(mergedData);
          const pending = mergedData.filter(app => ['pending_review', 'action_required', 'pending', 'review'].includes((app.status || 'pending').toLowerCase()));
          const approved = mergedData.filter(app => ['approved', 'documents_complete'].includes((app.status || 'pending').toLowerCase()));
          const scheduled = mergedData.filter(app => ['scheduled', 'for_interview'].includes((app.status || 'pending').toLowerCase()));
          const assigned = mergedData.filter(app => ['slot_assigned', 'fully_approved'].includes((app.status || 'pending').toLowerCase()));
          const completed = mergedData.filter(app => ['slot_assigned', 'completed'].includes((app.status || '').toLowerCase()));
          const archivedIds = JSON.parse(localStorage.getItem('gravetrak_archived_cancelled_apps') || '[]').map(a => String(a.id));
          const cancelled = mergedData.filter(app => ['cancelled', 'rejected'].includes((app.status || 'pending').toLowerCase()) && !archivedIds.includes(String(app.id)));
          setPendingApps(pending);
          setApprovedApps(approved);
          setScheduledApps(scheduled);
          setAssignedApps(assigned);
          setCompletedApps(completed);
          setCancelledApps(cancelled);
        }
      })
      .catch(err => console.error(err));
  }, []);

  // One-Time Auto Reset of Data for Fresh Start with new Date Fields
  useEffect(() => {
    if (!localStorage.getItem('gravetrak_v3_reset_cache')) {
      localStorage.removeItem('gravetrak_columbarium');
      localStorage.removeItem('gravetrak_assigned_apps');
      localStorage.removeItem('gravetrak_cleared_records');
      localStorage.removeItem('gravetrak_cancelled_notifs');
      localStorage.removeItem('gravetrak_support_messages');
      localStorage.removeItem('gravetrak_archived_reports');
      localStorage.removeItem('gravetrak_reports');
      localStorage.removeItem('gravetrak_archived_cancelled_apps');
      localStorage.removeItem('gravetrak_demo_statuses');
      localStorage.removeItem('gravetrak_demo_interviews');
      localStorage.removeItem('gravetrak_audit_logs');
      localStorage.setItem('gravetrak_v3_reset_cache', 'true');
      window.location.reload();
    }
  }, []);

  const [columbariumSlots, setColumbariumSlots] = useState([]);
  const cpdoInventoryRows = useMemo(() => isPlanningRole
    ? buildInventory(groundPlots, columbariumSlots) : [], [isPlanningRole, groundPlots, columbariumSlots]);
  const planningInventory = useMemo(() => activeInventoryForZones(
    cpdoInventoryRows, zonesSidebarSections, activePlanningCemetery
  ), [cpdoInventoryRows, zonesSidebarSections, activePlanningCemetery]);
  const planningStacks = useMemo(() => buildStackInventory(planningInventory), [planningInventory]);
  const planningNicheCounts = useMemo(() => inventoryTotals(planningInventory).niche, [planningInventory]);
  const planningSectionCounts = useMemo(() => new Map(inventorySectionTotals(planningInventory, []).map(
    item => [normalizeSectionName(item.name), item]
  )), [planningInventory]);
  const submitOfficeSearch = useCallback(() => {
    const query = officeSearchQuery.trim().toLowerCase();
    if (!query) return;
    const matches = value => String(value || '').toLowerCase().includes(query);
    const applicationMatch = allBurialApplications.find(app => matches(app.application_id) || matches(app.deceased_name) || matches(app.applicant_name));
    const graveMatch = graveData.find(grave => matches(grave.grave_id) || matches(grave.name) || matches(grave.location));
    const nicheMatch = columbariumSlots.find(slot => matches(slot.id) || matches(slot.name) || matches(slot.section));

    if (applicationMatch) {
      setApplicationSearch(officeSearchQuery.trim());
      setSelectedPanel('panel-approvals');
      const applicationStatus = String(applicationMatch.status || '').toLowerCase();
      setAppTab(['completed', 'slot_assigned', 'fully_approved'].includes(applicationStatus)
        ? 'completed'
        : ['approved', 'documents_complete'].includes(applicationStatus)
        ? 'approved'
        : ['scheduled', 'for_interview'].includes(applicationStatus)
        ? 'scheduled'
        : 'pending');
      return;
    }
    if (graveMatch) {
      setRecordSearch(officeSearchQuery.trim());
      setSelectedPanel('panel-graves');
      return;
    }
    if (nicheMatch) {
      setActiveColumbariumMap(nicheMatch.cemeteryMap || 'old');
      setColumbariumSection(nicheMatch.section || 'Section A');
      setColumbariumFilter('all');
      setNicheFocusTarget({ ...nicheMatch });
      setSelectedPanel('panel-columbarium');
      return;
    }
    showToast(`No records found for “${officeSearchQuery.trim()}”.`, 'info');
  }, [officeSearchQuery, allBurialApplications, graveData, columbariumSlots, showToast]);

  const sectionColorGetterRef = useRef(() => SECTION_UTILIZATION_COLORS.low);
  const graveDataRef = useRef([]);
  const columbariumSlotsRef = useRef([]);
  const occupiedNicheColumnRef = useRef(new Set());
  const columbariumLayoutSyncRef = useRef(new Set());

  useEffect(() => {
    graveDataRef.current = graveData;
  }, [graveData]);

  useEffect(() => {
    columbariumSlotsRef.current = columbariumSlots;
    occupiedNicheColumnRef.current = new Set(columbariumSlots
      .filter(slot => ['occupied', 'reserved'].includes(slot.status))
      .map(slot => `${slot.cemeteryMap}:${normalizeSectionName(slot.section)}:${slot.col}`));
  }, [columbariumSlots]);

  useEffect(() => {
    if (!active || !isPlanningRole || !cemeterySections.length) return;
    const plotsBySection = new Map();
    for (const plot of groundPlots) {
      const key = String(plot.section_record);
      if (!plotsBySection.has(key)) plotsBySection.set(key, []);
      plotsBySection.get(key).push(plot);
    }
    const slotCounts = new Map();
    const slotCountKey = (cemetery, section) => JSON.stringify([cemetery, normalizeSectionName(section)]);
    for (const slot of columbariumSlots) {
      const key = slotCountKey(slot.cemeteryMap, slot.section);
      slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
    }
    cemeterySections.forEach(section => {
      const props = section.properties || {};
      if (props.is_active === false) return;
      const sectionId = section.id || props.id;
      const plots = plotsBySection.get(String(sectionId)) || [];
      // Wait for confirmed dimensions; do not invent a two-sided layout while
      // the multi-step section save is still generating its map positions.
      const cemeteryMap = props.cemetery_code || 'old';
      const layout = getSectionLayout(section, plots);
      if (!layout || ![1, 2].includes(layout.rows)) return;
      const { rows, columns } = layout;
      const floors = Number(props.estimated_stack_height || 1);
      const currentSlotCount = slotCounts.get(slotCountKey(cemeteryMap, props.name)) || 0;
      const expectedCount = columns * rows * floors;
      const signature = `${sectionId}:${rows}:${columns}:${floors}:${currentSlotCount}`;
      if (currentSlotCount === expectedCount || columbariumLayoutSyncRef.current.has(signature)) return;
      columbariumLayoutSyncRef.current.add(signature);
      createColumbariumSection({ section: props.name, cemetery_map: cemeteryMap, floors, columns, rows })
        .then(rows => {
          const normalized = processSlots(Array.isArray(rows) ? rows : []);
          setColumbariumSlots(current => [
            ...current.filter(slot => !(
              normalizeSectionName(slot.section) === normalizeSectionName(props.name) &&
              slot.cemeteryMap === cemeteryMap
            )),
            ...normalized,
          ]);
        })
        .catch(error => {
          columbariumLayoutSyncRef.current.delete(signature);
          console.error(`Unable to synchronize columbarium layout for ${props.name}:`, error);
        });
    });
  }, [active, isPlanningRole, cemeterySections, groundPlots, columbariumSlots]);

  const getColumbariumSectionStats = useCallback((sectionId, cemeteryMap) => {
    const sectionName = normalizeSectionName(sectionId);
    const sectionSlots = columbariumSlotsRef.current.filter((slot) => normalizeSectionName(slot.section) === sectionName && slot.cemeteryMap === cemeteryMap);
    const total = sectionSlots.length || (cemeteryMap === 'new' ? 124 * 4 : 84 * 4);
    let occupied = sectionSlots.filter((slot) => slot.status === 'occupied').length;
    const reserved = sectionSlots.filter((slot) => slot.status === 'reserved').length;
    
    graveDataRef.current.forEach(g => {
      if (g.grave_id && g.grave_id.startsWith(sectionName + '-C')) {
         if (g.status === 'occupied') occupied++;
      }
    });

    return { total, occupied, reserved };
  }, []);

  const getPlotColor = useCallback((feature, cemeteryMap, palette = PLOT_STATUS_COLORS) => {
    const plotId = feature.properties.name;
    const isColFormat = plotId && plotId.includes('Section') && plotId.includes('-C');

    if (isColFormat) {
      const sectionName = plotId.split('-C')[0];
      const colNum = plotId.split('-C')[1];
      const normSec = normalizeSectionName(sectionName);
      let occupiedCount = occupiedNicheColumnRef.current.has(`${cemeteryMap}:${normSec}:${colNum}`) ? 1 : 0;
      
      // Also check graveDataRef for columbarium slots just in case
      graveDataRef.current.forEach(g => {
        if (g.grave_id === plotId && g.status === 'occupied' && g.cemeteryMap === cemeteryMap) {
          occupiedCount++;
        }
      });

      if (occupiedCount > 0) return palette.occupied;
      return palette.available;
    }
    for (let i = 0; i < groundPlotsRef.current.length; i++) {
      const g = groundPlotsRef.current[i];
      if (g.plot_id === plotId && (g.cemetery_code || 'old') === cemeteryMap) {
        return palette[g.status] || UNKNOWN_PLOT_COLOR;
      }
    }
    return UNKNOWN_PLOT_COLOR; // Spatial layout exists, but no persistent ground-plot record is linked yet.
  }, []);

  useEffect(() => {
    sectionColorGetterRef.current = (sectionId, cemeteryMap, sectionRecordId) => {
      const normalizedName = normalizeSectionName(sectionId).toLowerCase();
      const sectionPlots = groundPlotsRef.current.filter(plot =>
        (plot.cemetery_code || plot.cemetery?.code || 'old') === cemeteryMap
        && (normalizeSectionName(plot.section_name || plot.section).toLowerCase() === normalizedName
          || (plot.section_record != null && String(plot.section_record) === String(sectionRecordId ?? sectionId)))
      );
      let total = sectionPlots.length;
      let used = sectionPlots.filter(plot => String(plot.status || '').toLowerCase() === 'occupied').length;
      if (!total) {
        const stats = getColumbariumSectionStats(sectionId, cemeteryMap);
        total = stats.total;
        used = stats.occupied;
      }
      const utilization = total ? Math.min(100, (used / total) * 100) : 0;
      if (utilization >= 80) return SECTION_UTILIZATION_COLORS.high;
      if (utilization >= 50) return SECTION_UTILIZATION_COLORS.moderate;
      return SECTION_UTILIZATION_COLORS.low;
    };
  }, [getColumbariumSectionStats, groundPlots]);
  
  const onEachPlotFeature = useCallback((f, layer, mapType, cemeteryMapContext, sideRows = 42) => {
    layer.options.isGravePlot = true;

    bindPlotHover(layer);
    layer.on({
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        
        const plotId = f.properties.niche_column ? `${f.properties.section_name}-C${f.properties.niche_column}` : f.properties.name;
        const isColFormat = plotId && plotId.includes('Section') && plotId.includes('-C');
        
        let html = '';
        let clickedSectionName = f.properties.section || '';
        if (isColFormat) {
          const sectionNameStr = plotId.split('-C')[0];
          clickedSectionName = sectionNameStr;
          const colNum = plotId.split('-C')[1]; // Changed from plotId.split('-C')[1]
          const floorData = [4, 3, 2, 1].map(floor => {
            const slot = columbariumSlotsRef.current.find(s => 
               normalizeSectionName(s.section) === normalizeSectionName(sectionNameStr) && 
               String(s.floor) === String(floor) && 
               String(s.col) === String(colNum) && 
               s.cemeteryMap === cemeteryMapContext
            ) || { status: 'available', name: '' };
            return { floor, ...slot };
          });

          html = `<div style="min-width: 200px; cursor: default;" onclick="event.stopPropagation()">
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px; text-align: center; color: var(--text-primary);">${plotId}</div>
            <div style="display: flex; flex-direction: column; gap: 6px;">`;

          floorData.forEach(slot => {
            const statusColor = slot.status === 'occupied' ? 'var(--red)' : slot.status === 'maintenance' ? '#64748b' : slot.status === 'reserved' ? 'var(--amber)' : 'var(--emerald)';
            const occupantName = slot.name || (slot.status === 'maintenance' ? 'Under maintenance' : 'Empty Slot');
            html += `
              <div style="background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.05); padding: 6px 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;">
                  <div style="font-size: 11px; font-weight: bold; color: var(--text-muted);">Floor ${slot.floor}</div>
                  <div style="font-size: 12px; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis;" title="${occupantName}">${occupantName}</div>
                </div>
                <div style="font-size: 10px; background: ${statusColor}; color: white; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; flex-shrink: 0;">
                  ${slot.status}
                </div>
              </div>
            `;
          });

          html += `</div>
            <button class="btn btn-primary btn-sm" style="width: 100%; margin-top: 10px;" onclick="window.dispatchEvent(new CustomEvent('gravetrak_manage_section', { detail: { sectionName: '${sectionNameStr}', cemeteryMap: '${cemeteryMapContext}' } }));">Manage Graves</button>
            ${mapType === 'plan' ? `<button class="btn btn-ghost btn-sm" style="width: 100%; margin-top: 6px;" onclick="window.dispatchEvent(new CustomEvent('gravetrak_edit_legacy_section', { detail: { sectionName: '${sectionNameStr}', cemeteryMap: '${cemeteryMapContext}' } }));">Edit Boundary &amp; Layout</button>` : ''}
          </div>`;
        } else {
          const plot = groundPlotsRef.current.find(g => g.plot_id === plotId && (g.cemetery_code || 'old') === cemeteryMapContext) || { status: 'unrecorded' };
          clickedSectionName = plot.section_name || plot.section || clickedSectionName;
          const statusColor = plot.status === 'occupied' ? 'var(--red)' : plot.status === 'maintenance' ? 'var(--amber)' : plot.status === 'available' ? 'var(--emerald)' : '#64748b';
          
          html = `<div style="min-width: 160px; text-align: center; cursor: default;" onclick="event.stopPropagation()">
            <div style="font-weight: bold; margin-bottom: 4px; font-size: 14px; color: var(--text-primary);">${plotId.startsWith('Expansion') ? 'New Plot ' : 'Plot '}${plotId}</div>
            <div style="font-size: 12px; color: var(--text-primary); font-weight: 600; margin-bottom: 2px;">${plot.cemetery_name || (cemeteryMapContext === 'new' ? 'Lucena New Public Cemetery' : 'Lucena Old Public Cemetery')}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">${plot.section_name || plot.section || 'No section recorded'}</div>
            <div style="font-size: 10px; background: ${statusColor}; color: white; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; display: inline-block;">
              ${plot.status}
            </div>
          </div>`;
        }
        if (mapType === 'plan' && clickedSectionName) revealZoneInSidebar(clickedSectionName, cemeteryMapContext);
        
        if (layer._map) {
          L.popup().setLatLng(e.latlng).setContent(html).openOn(layer._map);
        } else {
          layer.bindPopup(html).openPopup();
        }
      }
    });
  }, [revealZoneInSidebar]);

  useEffect(() => {
    const handleManageSection = (e) => {
      const { sectionName, cemeteryMap } = e.detail; // Destructure detail
      setColumbariumSlots(current => {
        const exists = current.some(s => normalizeSectionName(s.section) === sectionName && s.cemeteryMap === cemeteryMap);
        if (!exists) { 
          const newSlots = [];
          const slotsCount = cemeteryMap === 'new' ? 132 : 84;
          for (let f = 1; f <= 4; f++) {
            for (let c = 1; c <= slotsCount; c++) {
              newSlots.push({ id: `${sectionName}-F${f}-C${c}`, section: sectionName, floor: f, col: c, status: 'available', name: '' });
            } 
          }
          return [...current, ...newSlots.map(s => ({...s, cemeteryMap}))];
        } 
        return current;
      });
      setActiveColumbariumMap(cemeteryMap); // Set active map
      setColumbariumSection(sectionName);
      setSelectedPanel('panel-columbarium');
    };
    window.addEventListener('gravetrak_manage_section', handleManageSection);
    return () => window.removeEventListener('gravetrak_manage_section', handleManageSection);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
      if (inboxRef.current && !inboxRef.current.contains(event.target)) {
        setInboxOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleStorageSync = (e) => {
      if (e.key && e.key.startsWith('gravetrak_')) {
        setSupportMessages(JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]').filter(m => !m.resolved));

        if (e.key === 'gravetrak_columbarium') {
          const updatedCol = JSON.parse(localStorage.getItem('gravetrak_columbarium') || '[]');
          if (updatedCol.length > 0) setColumbariumSlots(processSlots(updatedCol));
        } else if (e.key === 'gravetrak_audit_logs') {
          // Update audit logs if changed externally
          setAuditLogs(JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]'));
        } else if (e.key === 'gravetrak_cancelled_notifs') {
          const newCancelled = JSON.parse(localStorage.getItem('gravetrak_cancelled_notifs') || '[]');
          setCancelledNotifs(prev => {
            if (newCancelled.length > prev.length && newCancelled.length > 0) {
              const latest = newCancelled[0];
              setToast({ show: true, message: `Application Cancelled: ${latest.name} cancelled their request. Reason: ${latest.reason}`, type: 'error' });
              setTimeout(() => setToast(p => ({ ...p, show: false })), 6000);
            }
            return newCancelled;
          });
        } else if (e.key === 'gravetrak_new_app_trigger' && active) {
          loadApps();
          setToast({ show: true, message: 'New application received! Dashboard updated.', type: 'success' });
          setTimeout(() => setToast(p => ({ ...p, show: false })), 4000);
          } else if (e.key === 'gravetrak_new_service_request' && active) {
            setToast({ show: true, message: 'New Service Request received from user.', type: 'success' });
            setTimeout(() => setToast(p => ({ ...p, show: false })), 4000);
          } else if (e.key === 'gravetrak_new_transfer_request' && active) {
            setToast({ show: true, message: 'New Transfer Plot Request received from user.', type: 'success' });
            setTimeout(() => setToast(p => ({ ...p, show: false })), 4000);
          } else {
          setCancelledNotifs(JSON.parse(localStorage.getItem('gravetrak_cancelled_notifs') || '[]'));
        }
      }
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  useEffect(() => {
    localStorage.setItem('gravetrak_reports', JSON.stringify(reports));
  }, [reports]);

  useEffect(() => {
    localStorage.setItem('gravetrak_ui_scale', uiScale);
    const scaleMap = { 'standard': 1, 'medium': 1.08, 'large': 1.18 };
    const scale = scaleMap[uiScale] || 1;
    
    // Clean up old/previous scaling attempts to prevent conflicts
    document.documentElement.style.transform = '';
    document.documentElement.style.transformOrigin = '';
    document.documentElement.style.width = '';
    document.documentElement.style.height = '';
    document.documentElement.style.overflow = '';
    document.body.style.zoom = '';
    document.body.style.width = '';
    document.body.style.height = '';
    const oldStyleEl = document.getElementById('zoom-responsive-fix');
    if (oldStyleEl) oldStyleEl.remove();

    let styleEl = document.getElementById('gravetrak-zoom-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'gravetrak-zoom-style';
      document.head.appendChild(styleEl);
    }

    if (scale !== 1) {
      styleEl.innerHTML = `
        body { zoom: ${scale}; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }
        .screen, .modal-overlay, #screen-app, #screen-public { width: calc(100vw / ${scale}) !important; height: calc(100vh / ${scale}) !important; max-width: calc(100vw / ${scale}) !important; max-height: calc(100vh / ${scale}) !important; }
        .pub-sidebar, .sidebar { height: calc(100vh / ${scale}) !important; }
        @media (max-width: 768px) { .pub-sidebar, .sidebar { max-width: calc(85vw / ${scale}) !important; } }
      `;
    } else {
      styleEl.innerHTML = '';
    }

    const timeout = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(timeout);
  }, [uiScale]);

  useEffect(() => {
    localStorage.setItem('gravetrak_high_contrast', highContrast);
    if (highContrast) {
      document.body.classList.add('high-contrast-mode');
    } else {
      document.body.classList.remove('high-contrast-mode');
    }
  }, [highContrast]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarCollapsed(true);
      } else {
        setSidebarCollapsed(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
    return () => clearTimeout(timeout);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!active) return;

    // Force sync local storage kapag nag-switch account sa iisang browser
    setSupportMessages(JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]').filter(m => !m.resolved));
    setCancelledNotifs(JSON.parse(localStorage.getItem('gravetrak_cancelled_notifs') || '[]'));

    fetchGraves()
      .then(async (data) => {
        setGraveData(data);
      })
      .catch((err) => setError(err.message));

    if (isPlanningRole) {
      Promise.all([fetchCemeteries(), fetchBurialPlots(), fetchBurialPlotSummary()])
        .then(([cemeteryRows, plotRows, summary]) => {
          setCemeteries(Array.isArray(cemeteryRows) ? cemeteryRows : []);
          setGroundPlots(Array.isArray(plotRows) ? plotRows : []);
          setGroundPlotSummary(summary || { total: 0, available: 0, occupied: 0, maintenance: 0, sections: [] });
          setPlotDataError('');
        })
        .catch((err) => {
          setPlotDataError(`Ground plot data could not be loaded: ${err.message}`);
          setGroundPlots([]);
        });
    }

    loadApps();

    fetchColumbariums()
      .then(data => {
        // A successful API response, including an empty array, is authoritative.
        // Falling back to a browser cache here made deleted CPDO trial sections
        // reappear in Apartment Niches.
        if (Array.isArray(data)) {
          const backendSlots = processSlots(data);
          setColumbariumSlots(backendSlots);
          localStorage.setItem('gravetrak_columbarium', JSON.stringify(backendSlots));
        } else {
          setColumbariumSlots([]);
          setPlotDataError('Active niche records could not be loaded. Refresh Records to retry.');
        }
      })
      .catch((err) => {
        console.error("Failed to sync with database or load columbarium data:", err);
        setColumbariumSlots([]);
        setPlotDataError('Active niche records could not be loaded. Refresh Records to retry.');
      });

    const timeout = setTimeout(() => {
      if (isStaffRole) safeInvalidateMap(adminMapRef.current);
      if (isPlanningRole) safeInvalidateMap(planningMapRef.current);
    }, 120);
    return () => clearTimeout(timeout);
  }, [active, loadApps, isPlanningRole, isStaffRole]);

  useEffect(() => {
    if (!active || !isStaffRole) return undefined;
    let cancelled = false;
    setGroundPlotsLoading(true);
    setPlotDataError('');
    Promise.all([fetchBurialPlots(), fetchCemeterySections()])
      .then(([data, sections]) => {
        if (cancelled) return;
        setSharedMapSections(sections.features || []);
        if (!Array.isArray(data)) throw new Error('Unexpected ground plot response.');
        setGroundPlots(data);
      })
      .catch(error => {
        if (cancelled) return;
        setGroundPlots([]);
        setPlotDataError(`Ground plot data could not be loaded: ${error.message}`);
      })
      .finally(() => { if (!cancelled) setGroundPlotsLoading(false); });
    return () => { cancelled = true; };
  }, [active, isStaffRole]);

  useEffect(() => {
    if (columbariumSlots.length > 0) { // Only save if there are slots to prevent overwriting with empty array
      localStorage.setItem('gravetrak_columbarium', JSON.stringify(columbariumSlots));
    }
  }, [columbariumSlots]);

  useEffect(() => {
    localStorage.setItem('gravetrak_reports', JSON.stringify(reports));
  }, [reports]);

  useEffect(() => {
    localStorage.setItem('gravetrak_ui_scale', uiScale);
    const scaleMap = { 'standard': 1, 'medium': 1.08, 'large': 1.18 };
    const scale = scaleMap[uiScale] || 1;
    
    // Clean up old/previous scaling attempts to prevent conflicts
    document.documentElement.style.transform = '';
    document.documentElement.style.transformOrigin = '';
    document.documentElement.style.width = '';
    document.documentElement.style.height = '';
    document.documentElement.style.overflow = '';
    document.body.style.zoom = '';
    document.body.style.width = '';
    document.body.style.height = '';
    const oldStyleEl = document.getElementById('zoom-responsive-fix');
    if (oldStyleEl) oldStyleEl.remove();

    let styleEl = document.getElementById('gravetrak-zoom-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'gravetrak-zoom-style';
      document.head.appendChild(styleEl);
    }

    if (scale !== 1) {
      styleEl.innerHTML = `
        body { zoom: ${scale}; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }
        .screen, .modal-overlay, #screen-app, #screen-public { width: calc(100vw / ${scale}) !important; height: calc(100vh / ${scale}) !important; max-width: calc(100vw / ${scale}) !important; max-height: calc(100vh / ${scale}) !important; }
        .pub-sidebar, .sidebar { height: calc(100vh / ${scale}) !important; }
        @media (max-width: 768px) { .pub-sidebar, .sidebar { max-width: calc(85vw / ${scale}) !important; } }
      `;
    } else {
      styleEl.innerHTML = '';
    }

    const timeout = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(timeout);
  }, [uiScale]);

  useEffect(() => {
    localStorage.setItem('gravetrak_high_contrast', highContrast);
    if (highContrast) {
      document.body.classList.add('high-contrast-mode');
    } else {
      document.body.classList.remove('high-contrast-mode');
    }
  }, [highContrast]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarCollapsed(true);
      } else {
        setSidebarCollapsed(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
    return () => clearTimeout(timeout);
  }, [sidebarCollapsed]);

  // Fetch Catch Block: Fetch cemetery sections when the planning panel is active
  useEffect(() => {
    // Apartment Niches uses active CPDO zones as its section source.  Load the
    // same current zoning data when that panel is opened, not only after the
    // user has first visited the Planning Map or dashboard.
    if (active && ((isPlanningRole && ['panel-planning', 'panel-planning-dash', 'panel-columbarium', 'panel-graves'].includes(selectedPanel))
      || ((isStaffRole || isMayorRole) && selectedPanel === 'panel-columbarium'))) {
      let cancelled = false;

      const loadCemeterySections = async () => {
        try {
          setCemeterySectionsError('');
          const [sectionResult, pathwayResult] = await Promise.allSettled([
            fetchCemeterySections(),
            fetchCemeteryPathways(),
          ]);
          if (cancelled) return;
          if (sectionResult.status === 'rejected') throw sectionResult.reason;
          const data = sectionResult.value;
          const pathwayData = pathwayResult.status === 'fulfilled' ? pathwayResult.value : null;
          if (pathwayResult.status === 'rejected') console.warn('Saved pathways could not be loaded:', pathwayResult.reason);
          setCemeteryPathways((Array.isArray(pathwayData?.features) ? pathwayData.features : []).filter(feature => feature.properties?.is_active !== false));
          if (data && Array.isArray(data.features)) {
            setCemeterySections(data.features);
          } else if (Array.isArray(data)) {
            setCemeterySections(data);
          } else {
            throw new Error('Saved sections returned an invalid response.');
          }
          setPlanningOverlaysReady(true);
        } catch (err) {
          if (cancelled) return;
          console.error('Failed to fetch cemetery sections:', {
            status: err.status,
            message: err.message,
            payload: err.data || err.response || err,
          });
          setCemeterySections([]);
          setCemeteryPathways([]);
          setPlanningOverlaysReady(false);
          if (err.status === 404) {
            setCemeterySectionsError('Saved planning sections are unavailable. Please retry.');
          } else if (err.status === 401 || err.status === 403) {
            setCemeterySectionsError('Your session could not load saved planning sections. Please sign in again or retry.');
          } else {
            setCemeterySectionsError('Saved planning sections could not be loaded. Please retry.');
          }
        }
      };

      loadCemeterySections();
      return () => {
        cancelled = true;
        setPlanningOverlaysReady(false);
      };
    }
  }, [active, isPlanningRole, isStaffRole, isMayorRole, selectedPanel, planningReloadToken]);

  useEffect(() => {
    if (!active || !isStaffRole || selectedPanel !== 'panel-admin-map') return;
    let cancelled = false;
    setStaffMapReady(false);
    setStaffMapLoadError('');
    Promise.all([fetchCemeterySections(), fetchCemeteryPathways(), fetchBurialPlots()])
      .then(([sectionData, pathwayData, plotRows]) => {
        if (cancelled) return;
        setSharedMapSections(Array.isArray(sectionData?.features) ? sectionData.features : []);
        setSharedMapPathways((Array.isArray(pathwayData?.features) ? pathwayData.features : []).filter(feature => feature.properties?.is_active !== false));
        setGroundPlots(Array.isArray(plotRows) ? plotRows : []);
        setStaffMapReady(true);
      })
      .catch(err => {
        if (cancelled) return;
        setStaffMapLoadError('Unable to load map records. Please retry.');
        console.error('Unable to load CPDO map overlays for Cemetery Office:', err);
      });
    return () => { cancelled = true; setStaffMapReady(false); };
  }, [active, isStaffRole, selectedPanel, planningReloadToken]);

  useEffect(() => {
    if (!active || !isPlanningRole || selectedPanel !== 'panel-planning-archive') return;
    let cancelled = false;
    setIsPlanningArchiveLoading(true);
    setPlanningArchiveError('');
    fetchCemeterySections()
      .then(data => {
        if (cancelled) return;
        const features = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];
        setArchivedPlanningSections(features.filter(feature => feature.properties?.is_active === false && !feature.properties?.is_retired));
      })
      .catch(err => {
        if (cancelled) return;
        setArchivedPlanningSections([]);
        setPlanningArchiveError(`Archived sections could not be loaded: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setIsPlanningArchiveLoading(false);
      });
    return () => { cancelled = true; };
  }, [active, isPlanningRole, selectedPanel]);

  useEffect(() => {
    if (isPlanningRole && ['panel-planning', 'panel-planning-dash'].includes(selectedPanel)) return;
    if (planningMapRef.current?.__currentDrawControl) {
      planningMapRef.current.removeControl(planningMapRef.current.__currentDrawControl);
      planningMapRef.current.__currentDrawControl = null;
    }
    setIsDrawingMode(false);
    setNewSectionGeometry(null);
    setIsNewSectionModalOpen(false);
    setCemeterySections([]);
    setPlanningOverlaysReady(false);
    clearPathwayDraft();
    setCemeteryPathways([]);
    setIsDrawingPathway(false);
    setIsPathwayModalOpen(false);
    setCemeterySectionsError('');
  }, [isPlanningRole, selectedPanel]);

  // Filter grave data for admin map
  const filteredGraveData = graveData.filter((item) => {
    if (item.status === 'available' || item.status === 'reserved') return false; // Hide available and reserved dots on React map
    
    // Filter out stray markers from Cavite City mock data
    const lat = parseFloat(item.latitude || item.latlng?.[0] || 0);
    if (lat >= 14.0) return false;
    
    return true;
  });

  // Plot Records and the planning map intentionally share this BurialPlot dataset.
  const ITEMS_PER_PAGE = 50;
  const filteredGraveRecords = isPlanningRole ? visibleGroundPlots : lucenaGraveData.filter((grave) => {
    if (grave.status !== 'occupied') return false;
    if (recordSearch) {
      const query = recordSearch.toLowerCase();
      if (!grave.grave_id.toLowerCase().includes(query) && !(grave.name && grave.name.toLowerCase().includes(query))) return false;
    }
    return true;
  });

  // Pagination for grave records
  const paginatedGraveRecords = filteredGraveRecords.slice((gravePage - 1) * ITEMS_PER_PAGE, gravePage * ITEMS_PER_PAGE);
  const totalGravePages = Math.max(1, Math.ceil(filteredGraveRecords.length / ITEMS_PER_PAGE));

  const sectionFeatures = siteData.features.filter((feature) => feature.properties.id);

  const adminMapRef = useLeafletMap({
    containerRef: adminMapContainer,
    onRenderStateChange: setStaffMapRenderState,
    active: active && isStaffRole && selectedPanel === 'panel-admin-map' && staffMapReady,
    center: activeAdminCemetery === 'old' ? CEMETERY_CENTER : ANOTHER_CEMETERY_CENTER,
    markers: filteredGraveData,
    markerIcon: useCallback((grave) => makeIcon(grave.status), []),
    onMapReady: useCallback((map) => {
      // Keep section fills below plot cells even when SVG overlays are added later.
      // bringToFront only reorders paths within the same renderer, not SVG vs Canvas.
      const plotPane = map.createPane('staffPlotCells');
      plotPane.style.zIndex = '450';
      const mapCanvasRenderer = L.canvas({ pane: 'staffPlotCells' });
      const staffPlotCells = [];
      // Saved layouts and tombstones supersede the original browser-only grid.
      const savedPlotSectionIds = new Set(groundPlots.map(plot => String(plot.section_record)));
      const managedOldSections = new Set(sharedMapSections.flatMap(section => {
        const props = section.properties || {};
        if ((props.cemetery_code || 'old') !== 'old') return [];
        if (props.is_active !== false && !savedPlotSectionIds.has(String(section.id || props.id))) return [];
        return [props.name, props.legacy_source_name].filter(Boolean).map(name => normalizeSectionName(name).toLowerCase());
      }));
      const isManagedOldSection = feature => managedOldSections.has(normalizeSectionName(feature.properties?.id || feature.properties?.name).toLowerCase());
      const updateStaffPlotDetail = () => {
        const weight = planningPlotWeight(map.getZoom());
        staffPlotCells.forEach(layer => layer.setStyle({ weight }));
      };
      map.on('zoomend', updateStaffPlotDetail);
      map.once('unload', () => map.off('zoomend', updateStaffPlotDetail));
      const managedLegacyPathIds = new Set(sharedMapPathways.map(pathway => {
        const match = String(pathway.properties?.description || '').match(/\[legacy-path:([^\]]+)\]/);
        return match?.[1];
      }).filter(Boolean));
      const oldMapLayerGroup = L.layerGroup();
      const newMapLayerGroup = L.layerGroup();
      L.geoJSON(pathwaysGeoJson, {
          filter: (feature) => !managedLegacyPathIds.has(`old-${pathwaysGeoJson.features.indexOf(feature)}`),
          style: { color: '#6b7280', weight: 14, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
          interactive: false
      }).addTo(oldMapLayerGroup);
      L.geoJSON(pathwaysGeoJson, {
          filter: (feature) => !managedLegacyPathIds.has(`old-${pathwaysGeoJson.features.indexOf(feature)}`),
          style: { color: '#ffffff', weight: 3, opacity: 1.0, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' },
          interactive: false
      }).addTo(oldMapLayerGroup);
      
      // Load new map data for admin map
      // Integrate Another Cemetery Map
      const loadNewMapData = (data) => {
          L.geoJSON(data, {
            filter: (feature) => feature.geometry?.type === 'LineString' && feature.properties?.name === 'path' && !managedLegacyPathIds.has(`new-${feature.id || data.features.indexOf(feature)}`),
            style: { color: '#6b7280', weight: 14, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
            interactive: false,
          }).addTo(newMapLayerGroup);
          L.geoJSON(data, {
            filter: (feature) => !(feature.geometry?.type === 'LineString' && feature.properties?.name === 'path' && managedLegacyPathIds.has(`new-${feature.id || data.features.indexOf(feature)}`)),
            style: (feature) => {
              if (feature.geometry.type === 'LineString') {
                if (feature.properties && (feature.properties.type === 'boundary' || feature.properties.name === 'boundary')) {
                  return { color: '#64748b', weight: 4, opacity: 1.0 };
                }
                if (feature.properties?.name === 'path') {
                  return { color: '#ffffff', weight: 3, opacity: 1.0, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' };
                }
                return { color: '#64748b', weight: 3, opacity: 1.0 };
              }
              const sName = feature.properties.name || 'Unnamed Area';
              let sLabel = normalizeSectionName(sName).replace('Expansion Area ', 'Section ');
              const origLabel = sLabel.toLowerCase();
              if (origLabel === 'section n') sLabel = 'Section A';
              if (origLabel === 'section o') sLabel = 'Section B';
              return {
                fillColor: sectionColorGetterRef.current(sLabel, 'new'),
                fillOpacity: 0.6,
                color: '#475569',
                weight: 2, 
              };
            },
            onEachFeature: (feature, layer) => {
              if (feature.properties && feature.properties.name && feature.geometry && feature.geometry.type.includes('Polygon')) {
                const sectionName = feature.properties.name;
                const normalizedSectionName = normalizeSectionName(sectionName);
                let label = normalizedSectionName.replace('Expansion Area ', 'Section ');
                const origLabel = label.toLowerCase();
                if (origLabel === 'section n') label = 'Section A';
                if (origLabel === 'section o') label = 'Section B';
                layer.bindTooltip(label, { 
                  permanent: true, 
                  direction: 'center', 
                  className: 'leaflet-tooltip-own',
                  opacity: 0.9 
                });

                if (origLabel === 'section n' || origLabel === 'section o') {
                  const popupContent = document.createElement('div');
                  popupContent.innerHTML = `
                    <div style="text-align: center; min-width: 160px;">
                      <strong style="font-size: 14px; color: var(--text-primary);">${label}</strong><br>
                      <div style="margin: 10px 0; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 8px; border: 1px solid rgba(0,0,0,0.05);">
                        <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 2px;">Records & Capacity</span>
                        <div id="stats-container-${label.replace(/\s/g, '-') }-new" style="font-size: 13px; font-weight: 800; color: var(--text-primary);">
                          Loading stats...
                        </div>
                      </div>
                      <button class="btn btn-primary btn-sm" style="width: 100%;" id="btn-admin-manage-${label.replace(/\s/g, '-')}-new">Manage Section</button>
                    </div>
                  `;
                  layer.bindPopup(popupContent);
                  layer.on('popupopen', () => {
                    const stats = getColumbariumSectionStats(label, 'new');
                    const statsEl = document.getElementById(`stats-container-${label.replace(/\s/g, '-')}-new`);
                    if (statsEl) {
                      statsEl.innerHTML = `${stats.occupied} / ${stats.total} Slots Interred`;
                      statsEl.style.color = stats.occupied === stats.total ? 'var(--red)' : 'var(--text-primary)';
                    }
                    const btn = document.getElementById(`btn-admin-manage-${label.replace(/\s/g, '-')}-new`);
                    if (btn) {
                      btn.onclick = () => {
                        setColumbariumSlots(current => {
                          const exists = current.some(s => normalizeSectionName(s.section) === label && s.cemeteryMap === 'new');
                          if (!exists) {
                            const newSlots = [];
                            for (let f = 1; f <= 4; f++) {
                              for (let c = 1; c <= 124; c++) {
                                newSlots.push({ id: `${label}-F${f}-C${c}`, section: label, floor: f, col: c, status: 'available', name: '', cemeteryMap: 'new' });
                              }
                            }
                            return [...current, ...newSlots];
                          }
                          return current;
                        });
                        setColumbariumSection(label);
                        setActiveColumbariumMap('new');
                        setSelectedPanel('panel-columbarium');
                        map.closePopup();
                      };
                    }
                  });
                  
                  layer.on({
                      mouseover: function(e) { e.target.setStyle({ fillOpacity: 0.9 }); },
                      mouseout: function(e) { e.target.setStyle({ fillColor: sectionColorGetterRef.current(label, 'new'), weight: 2, color: '#475569', fillOpacity: 0.7 }); }
                  });

                  // Generate columbarium grids for new map sections using Canvas
                  const plotsGeoJSON = generateGravePlots(feature.geometry, label, 62, 'new');
                  L.geoJSON(plotsGeoJSON, {
                    renderer: mapCanvasRenderer,
                    style: (f) => { 
                      const fillColor = getPlotColor(f, 'new');
                      return { fillColor, fillOpacity: 0.7, color: '#d0e7f4', weight: planningPlotWeight(map.getZoom()) };
                    },
                    onEachFeature: (f, layer) => { staffPlotCells.push(layer); onEachPlotFeature(f, layer, 'admin', 'new', 62); }
                  }).addTo(newMapLayerGroup);
                } else {
                  // New map is static for now, no interactivity
                  layer.options.interactive = false;
                }
              } else if (feature.geometry && feature.geometry.type.includes('LineString')) {
              }
            } 
          }).addTo(newMapLayerGroup);
      };
      
      if (typeof anotherMapData === 'string') {
        fetch(anotherMapData).then(res => res.json()).then(loadNewMapData).catch(err => console.error("Error loading GeoJSON:", err));
      } else {
        loadNewMapData(anotherMapData);
      } //

      const sectionLayer = L.geoJSON(closeBoundaryFeatures(siteData), {
        smoothFactor: 0,
        filter: feature => feature.geometry?.type !== 'Polygon' || !isManagedOldSection(feature),
        style: (feature) => {
          if (feature.properties.type === 'boundary') {
              return { color: '#64748b', weight: 3, fillOpacity: 0 };
          }
          return {
            fillColor: sectionColorGetterRef.current(feature.properties.id, 'old'),
            weight: 2,
            color: '#475569',
            fillOpacity: 0.7,
          };
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.id) {
              const sectionName = `Section ${feature.properties.id}`;
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
                  <button class="btn btn-primary btn-sm" style="width: 100%;" id="btn-admin-manage-${feature.properties.id}">Manage Section</button>
                </div>
              `;
              layer.bindPopup(popupContent); 
              layer.on('popupopen', () => {
                const stats = getColumbariumSectionStats(feature.properties.id, 'old');
                const statsEl = document.getElementById(`stats-container-${feature.properties.id}`);
                if (statsEl) {
                  statsEl.innerHTML = `${stats.occupied} / ${stats.total} Slots Interred`;
                  statsEl.style.color = stats.occupied === stats.total ? 'var(--red)' : 'var(--text-primary)';
                }
                const btn = document.getElementById(`btn-admin-manage-${feature.properties.id}`);
                if (btn) {
                  btn.onclick = () => {
                    setColumbariumSlots(current => { 
                      const exists = current.some(s => normalizeSectionName(s.section) === sectionName);
                      if (!exists) {
                        const newSlots = [];
                        for (let f = 1; f <= 4; f++) {
                          for (let c = 1; c <= 84; c++) {
                            newSlots.push({ id: `${sectionName}-F${f}-C${c}`, section: sectionName, floor: f, col: c, status: 'available', name: '' });
                          }
                        } 
                        return [...current, ...newSlots];
                      }
                      return current;
                    });
                    setColumbariumSection(sectionName);
                    setSelectedPanel('panel-columbarium');
                    map.closePopup();
                  };
                }
              });
            layer.bindTooltip(`Section ${feature.properties.id}`, {
              permanent: true,
              direction: 'center',
              className: 'leaflet-tooltip-own',
            });
              
              layer.on({
                  mouseover: function(e) { e.target.setStyle({ fillOpacity: 0.9 }); },
                  mouseout: function(e) { e.target.setStyle({ fillColor: sectionColorGetterRef.current(feature.properties.id, 'old'), weight: 2, color: '#475569', fillOpacity: 0.7 }); }
              });
          }
        },
      }).addTo(oldMapLayerGroup);

      // Generate columbarium grids for ALL sections (Restored Old Map)
      siteData.features.forEach(feature => {
        if (feature.properties.id && feature.geometry.type === 'Polygon' && !isManagedOldSection(feature)) { // Old cemetery sections
          const plotsGeoJSON = generateGravePlots(feature.geometry, feature.properties.id, 42, 'old');
          L.geoJSON(plotsGeoJSON, {
            renderer: mapCanvasRenderer,
            style: (f) => {
              const fillColor = getPlotColor(f, 'old'); // Pass 'old' for old map plots
              return { fillColor, fillOpacity: 0.7, color: '#d0e7f4', weight: planningPlotWeight(map.getZoom()) };
            },
            onEachFeature: (f, layer) => { staffPlotCells.push(layer); onEachPlotFeature(f, layer, 'admin', 'old', 42); }
          }).addTo(oldMapLayerGroup);
        }
      });

      sharedMapSections.forEach(feature => {
        const props = feature.properties || {};
        if (!feature.geometry || props.is_active === false) return;
        const statusColor = getSavedSectionStatusColor(props.status);
        L.geoJSON(feature, {
          style: { fillColor: statusColor, color: statusColor, weight: 3, fillOpacity: 0.42 },
          onEachFeature: (_savedFeature, layer) => {
            layer.options.isSavedSection = true;
            layer.bindTooltip(`${props.zone_code || 'Zone'} — ${props.name}`, { direction: 'center', className: 'leaflet-tooltip-own' });
            layer.bindPopup(`<strong>${props.zone_code || 'Zone'} — ${props.name}</strong><br>Status: ${props.status === 'planned' ? 'Planning' : props.status === 'maintenance' ? 'Maintenance' : 'Active'}<br>Graves: ${props.total_plots || 0}<br>Floors per grave: ${props.estimated_stack_height || 1}`);
          },
        }).addTo(props.cemetery_code === 'new' ? newMapLayerGroup : oldMapLayerGroup);
      });
      sharedMapPathways.forEach(feature => {
        const props = feature.properties || {};
        if (!feature.geometry || props.is_active === false) return;
        const roadWidth = Math.max(10, Math.min(22, Number(props.width_meters || 4) * 3.5));
        const centerWidth = Math.max(2.5, Math.min(5, roadWidth * 0.22));
        const targetGroup = props.cemetery_code === 'new' ? newMapLayerGroup : oldMapLayerGroup;
        L.geoJSON(feature, {
          style: { color: '#6b7280', weight: roadWidth, opacity: 1, lineCap: 'round', lineJoin: 'round' },
          interactive: false,
        }).addTo(targetGroup);
        L.geoJSON(feature, {
          style: { color: '#ffffff', weight: centerWidth, opacity: 1, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' },
          onEachFeature: (_savedFeature, layer) => layer.bindPopup(`<strong>${props.name || 'Pathway'}</strong><br>Type: ${props.pathway_type || 'walkway'}<br>Width: ${props.width_meters || 2} m`),
        }).addTo(targetGroup);
      });
      const sharedPlotFeatures = buildSavedSectionPlotFeatures(sharedMapSections, groundPlots);
      L.geoJSON(sharedPlotFeatures, {
        renderer: mapCanvasRenderer,
        style: feature => {
          const status = feature.properties?.status;
          const props = feature.properties;
          const color = status === 'available' && props.niche_column
            ? getPlotColor({ properties: { name: `${props.section_name}-C${props.niche_column}` } }, props.cemetery_code)
            : PLOT_STATUS_COLORS[status] || UNKNOWN_PLOT_COLOR;
          return { fillColor: color, color: '#d0e7f4', weight: planningPlotWeight(map.getZoom()), fillOpacity: 0.78, opacity: 1 };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          layer.options.isGravePlot = true;
          if (props.niche_column) {
            onEachPlotFeature(feature, layer, 'admin', props.cemetery_code);
            return;
          }
          layer.bindPopup(`<strong>${props.plot_id}</strong><br>${props.section_name}<br>Floors: ${props.floors}<br>Section status: ${props.section_status}<br>Plot status: ${props.status}`);
        },
      }).eachLayer(layer => {
        const cemeteryCode = layer.feature?.properties?.cemetery_code;
        staffPlotCells.push(layer);
        (cemeteryCode === 'new' ? newMapLayerGroup : oldMapLayerGroup).addLayer(layer);
      });

      // Both cemeteries share the same map; the toggle only focuses the camera.
      oldMapLayerGroup.addTo(map);
      newMapLayerGroup.addTo(map);
      const raisePlotLayers = layer => {
        if (layer.options?.isGravePlot) layer.bringToFront?.();
        if (layer.eachLayer) layer.eachLayer(raisePlotLayers);
      };
      oldMapLayerGroup.eachLayer(raisePlotLayers);
      newMapLayerGroup.eachLayer(raisePlotLayers);

      if (activeAdminCemetery === 'new') {
        const newMapBounds = L.geoJSON(anotherMapData).getBounds();
        if (newMapBounds.isValid()) {
          map.fitBounds(newMapBounds, { padding: [18, 18] });
        } else {
          map.setView(ANOTHER_CEMETERY_CENTER, 19);
        }
      } else {
        const boundaryFeature = siteData.features.find((feature) => feature.properties.type === 'boundary');
        if (boundaryFeature) {
          const siteBounds = L.geoJSON(boundaryFeature).getBounds();
          map.fitBounds(siteBounds, { padding: [18, 18] });
        } else {
          map.setView(CEMETERY_CENTER, 19);
        }
      }

      return sectionLayer;
    }, [activeAdminCemetery, getColumbariumSectionStats, getPlotColor, onEachPlotFeature, sharedMapSections, sharedMapPathways, groundPlots]),
  });


  useEffect(() => {
    if (!active || !isStaffRole || selectedPanel !== 'panel-admin-map' || !staffMapReady
      || staffMapRenderState !== 'ready' || !staffMapSearchTarget) return;
    const map = adminMapRef.current;
    const slot = staffMapSearchTarget;
    if (!map || activeAdminCemetery !== slot.cemeteryMap) return;
    const catalogue = resolvePlanningSections(sharedMapSections,
      slot.cemeteryMap === 'new' ? anotherMapData.features || [] : siteData.features, slot.cemeteryMap);
    const section = findPlanningSection(catalogue, slot.section);
    let columnLayer = null;
    // Imported legacy layouts retain their verified niche-column mapping.
    const inspect = layer => {
      const props = layer.feature?.properties;
      if (layer.options?.isGravePlot && props?.niche_column
        && props.cemetery_code === slot.cemeteryMap
        && normalizeSectionName(props.section_name) === normalizeSectionName(slot.section)
        && Number(props.niche_column) === Number(slot.col) && layer.getBounds) columnLayer = layer;
      const match = String(props?.name || '').match(/^(.*)-C(\d+)$/);
      if (layer.options?.isGravePlot && match && props.cemeteryMap === slot.cemeteryMap
        && normalizeSectionName(match[1]) === normalizeSectionName(slot.section)
        && Number(match[2]) === Number(slot.col) && layer.getBounds) columnLayer = layer;
    };
    map.eachLayer(inspect);
    const sectionLayer = section?.geometry ? L.geoJSON(section) : null;
    const plotFeature = slot.kind === 'plot' ? buildSavedSectionPlotFeatures(sharedMapSections, groundPlots).features.find(feature => String(feature.properties.id) === String(slot.plotId)) : null;
    const plotBounds = plotFeature ? L.geoJSON(plotFeature).getBounds() : null;
    const bounds = plotBounds || columnLayer?.getBounds() || sectionLayer?.getBounds();
    if (!bounds?.isValid()) {
      showToast('This record has no mapped location yet. Check its section in Apartment Niches.', 'info');
      return;
    }
    const content = document.createElement('div');
    content.className = 'staff-map-search-result';
    const badge = document.createElement('span');
    badge.className = 'staff-search-result-badge';
    badge.textContent = plotBounds ? 'PLOT LOCATION' : columnLayer ? 'LOCATED COLUMN' : 'SECTION LOCATION';
    const title = document.createElement('strong');
    title.textContent = slot.name || slot.id;
    const location = document.createElement('p');
    location.textContent = slot.kind === 'section' || slot.kind === 'plot' ? `${slot.cemeteryMap === 'new' ? 'New' : 'Old'} Cemetery ? ${slot.section}` : `${slot.section} ? Floor ${slot.floor} ? Column ${slot.col}`;
    const detail = document.createElement('p');
    detail.textContent = plotBounds ? 'Marker shows the selected plot.' : slot.kind === 'section' ? 'Marker shows the selected section.' : columnLayer ? 'Marker shows the column containing this niche.' : 'Section location only. Exact position is not mapped.';
    detail.className = 'staff-search-location-note';
    content.append(badge, title, location, detail);
    const marker = L.marker(bounds.getCenter(), { title: slot.name || slot.id, icon: L.divIcon({ className: 'staff-search-pin', html: '<span class="staff-search-halo" aria-hidden="true"></span><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2C10.1 2 2 10.1 2 20c0 13 18 26 18 26s18-13 18-26C38 10.1 29.9 2 20 2Z" fill="#1687c9" stroke="white" stroke-width="2.5"/><circle cx="20" cy="19" r="7" fill="white"/><circle cx="20" cy="19" r="3" fill="#1687c9"/></svg>', iconSize: [40, 48], iconAnchor: [20, 46], popupAnchor: [0, -42] }), zIndexOffset: 1200 })
      .addTo(map).bindPopup(content, { maxWidth: 300, minWidth: 230, className: 'staff-search-popup' });
    const open = () => marker.openPopup();
    map.once('moveend', open);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: plotBounds || columnLayer ? 22 : 20, animate: false });
    marker.openPopup();
    return () => { map.off('moveend', open); marker.remove(); };
  }, [active, isStaffRole, selectedPanel, staffMapReady, staffMapRenderState, staffMapSearchTarget, activeAdminCemetery, sharedMapSections, groundPlots, adminMapRef, showToast]);

  const planningMapRef = useLeafletMap({
    containerRef: planningMapContainer,
    onRenderStateChange: setPlanningMapRenderState,
    active: active && isPlanningRole && selectedPanel === 'panel-planning' && planningOverlaysReady,
    zoomControl: false, // Leaflet.draw has its own zoom controls, so we disable the default one.
    center: activePlanningCemetery === 'old' ? CEMETERY_CENTER : ANOTHER_CEMETERY_CENTER,
    markers: filteredGraveData,
    onMapReady: useCallback((map) => {
      const mapCanvasRenderer = L.canvas();
      // Sections, plots and pathway hit areas must share one interactive
      // canvas. A separate plot canvas covers the section canvas and swallows
      // clicks even where its decorative cells are non-interactive.
      map.options.renderer = mapCanvasRenderer;
      const outlinePane = map.createPane('planning-section-outlines');
      outlinePane.style.zIndex = '425';
      outlinePane.style.pointerEvents = 'none';
      const sectionLabels = [];
      const sectionHitTargets = [];
      const planningCells = [];
      const cellWeight = () => planningPlotWeight(map.getZoom());
      const decorateSection = (feature, layer, name, group, cemeteryCode) => {
        sectionHitTargets.push({ ...feature, properties: {
          ...feature.properties, name: feature.properties?.name || name, cemetery_code: cemeteryCode,
        } });
        // Draw boundaries above the dense plot grid without intercepting clicks.
        L.geoJSON(feature, {
          pane: 'planning-section-outlines',
          interactive: false,
          style: { color: '#075985', weight: 1.25, opacity: 0.85, fill: false },
          onEachFeature: (_feature, outline) => { outline.options.isSavedSection = true; },
        }).addTo(group);
        const label = document.createElement('span');
        label.textContent = name;
        layer.bindTooltip(label, {
          permanent: true, direction: 'center', className: 'planning-section-label', opacity: 1,
        });
        sectionLabels.push(layer);
      };
      const updatePlanningDetail = () => {
        for (const layer of sectionLabels) {
          const bounds = layer.getBounds();
          const width = Math.abs(map.latLngToLayerPoint(bounds.getNorthEast()).x - map.latLngToLayerPoint(bounds.getSouthWest()).x);
          if (map.getZoom() >= 20 && width >= 140) layer.openTooltip();
          else layer.closeTooltip();
        }
        for (const cell of planningCells) cell.setStyle({ weight: cellWeight() });
      };
      map.on('zoomend', updatePlanningDetail);
      map.once('unload', () => map.off('zoomend', updatePlanningDetail));
      // Match legacy section IDs/names (including renamed sections) only when
      // a saved polygon and its linked plot records can supply the grid.
      const savedPlotSectionIds = new Set(groundPlots
        .filter(plot => Number.isFinite(Number(plot.latitude)) && Number.isFinite(Number(plot.longitude)))
        .map(plot => String(plot.section_record)));
      const savedLayoutSectionKeys = new Set();
      cemeterySections.forEach(section => {
        const props = section.properties || {};
        const ring = section.geometry?.coordinates?.[0];
        const hasLayout = section.geometry?.type === 'Polygon' && Array.isArray(ring) && ring.length >= 4
          && savedPlotSectionIds.has(String(section.id || props.id));
        // Archived sections must not reappear as a legacy grid.
        if (!hasLayout && props.is_active !== false) return;
        [props.name, props.legacy_source_name].filter(Boolean).forEach(name => {
          savedLayoutSectionKeys.add(`${props.cemetery_code || 'old'}:${normalizeSectionName(name).toLowerCase()}`);
        });
      });
      const hasSavedLayout = (name, cemeteryCode) => savedLayoutSectionKeys.has(
        `${cemeteryCode}:${normalizeSectionName(name).toLowerCase()}`
      );
      const managedLegacyPathIds = new Set(cemeteryPathways.map(pathway => {
        const match = String(pathway.properties?.description || '').match(/\[legacy-path:([^\]]+)\]/);
        return match?.[1];
      }).filter(Boolean));
      
      const oldMapLayerGroup = L.layerGroup();
      const newMapLayerGroup = L.layerGroup();

      L.geoJSON(pathwaysGeoJson, {
          filter: (feature) => !managedLegacyPathIds.has(`old-${pathwaysGeoJson.features.indexOf(feature)}`),
          style: { color: '#6b7280', weight: 14, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
          interactive: false
      }).addTo(oldMapLayerGroup);

      L.geoJSON(pathwaysGeoJson, {
          filter: (feature) => !managedLegacyPathIds.has(`old-${pathwaysGeoJson.features.indexOf(feature)}`),
          style: { color: '#ffffff', weight: 3, opacity: 1.0, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' },
          interactive: true,
          onEachFeature: (feature, layer) => {
            const key = `legacy-path-old-${pathwaysGeoJson.features.indexOf(feature)}`;
            layer.on('click', () => { if (!isDrawingPathwayRef.current) revealPathwayInSidebar(key); });
            layer.bindTooltip('Click to locate this pathway in the sidebar', { sticky: true });
          },
      }).addTo(oldMapLayerGroup);

      // Safely initialize Leaflet.draw with existence checks
      if (L.Control && L.Control.Draw) {
        const planningDrawnItems = new L.FeatureGroup();
        map.addLayer(planningDrawnItems);
        map.__drawnItems = planningDrawnItems; // Attach to map instance for external access

        const planningDrawControl = new L.Control.Draw({
          edit: { featureGroup: planningDrawnItems, poly: { allowIntersection: false } },
          draw: {
            polygon: {
              allowIntersection: false,
              showArea: true,
              drawError: { color: '#b00b00', message: 'Overlap not allowed' },
              shapeOptions: { color: '#1687C9' }
            },
            polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
          }
        });
        // Do NOT add drawControl to map here. It will be added by activateDrawing.
        // map.addControl(planningDrawControl); // Removed this line

        map.on(L.Draw.Event.CREATED, (event) => {
          const layer = event.layer;
          map.__activePolygonDrawer = null;
          const geometry = layer.toGeoJSON().geometry;
          const ring = geometry?.coordinates?.[0] || [];
          const uniquePoints = new Set(ring.slice(0, -1).map(point => `${point[0]},${point[1]}`));
          if (geometry?.type !== 'Polygon' || uniquePoints.size < 3) {
            showToast('Invalid section polygon. Draw at least three unique points.', 'error');
            setIsDrawingMode(false);
            return;
          }
          const selectedCemetery = cemeteries.find(cemetery => cemetery.code === activePlanningCemetery);
          const boundaryCoordinates = selectedCemetery?.boundary_geometry?.coordinates;
          if (window.turf && Array.isArray(boundaryCoordinates) && boundaryCoordinates.length >= 3) {
            const closedBoundary = boundaryCoordinates[0][0] === boundaryCoordinates[boundaryCoordinates.length - 1][0] && boundaryCoordinates[0][1] === boundaryCoordinates[boundaryCoordinates.length - 1][1]
              ? boundaryCoordinates : [...boundaryCoordinates, boundaryCoordinates[0]];
            try {
              const isInside = window.turf.booleanWithin(window.turf.polygon(geometry.coordinates), window.turf.polygon([closedBoundary]));
              if (!isInside) {
                showToast('This section must be inside the selected cemetery boundary.', 'error');
                setIsDrawingMode(false);
                return;
              }
            } catch (_) {
              showToast('The polygon geometry is invalid. Please draw the section again.', 'error');
              setIsDrawingMode(false);
              return;
            }
          }
          planningDrawnItems.addLayer(layer);
          unsavedSectionLayerRef.current = layer;
          setNewSectionGeometry(geometry);
          setIsNewSectionModalOpen(true);
          setIsDrawingMode(false); // Exit drawing mode after creation
          // Remove the draw control after drawing is complete
          if (map.__currentDrawControl) {
            map.removeControl(map.__currentDrawControl);
            map.__currentDrawControl = null;
          }
        });

        map.on(L.Draw.Event.DRAWSTART, () => setIsDrawingMode(true));
        map.on(L.Draw.Event.DRAWSTOP, () => {
          setIsDrawingMode(false);
          map.__activePolygonDrawer = null;
          // If drawing was stopped without creating a shape, remove the control
          if (map.__currentDrawControl) {
            map.removeControl(map.__currentDrawControl);
            map.__currentDrawControl = null;
          }
        });
      }
      
      const loadNewMapDataPlanning = (data) => {
          L.geoJSON(data, {
            filter: (feature) => feature.geometry?.type === 'LineString' && feature.properties?.name === 'path' && !managedLegacyPathIds.has(`new-${feature.id || data.features.indexOf(feature)}`),
            style: { color: '#6b7280', weight: 14, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
            interactive: false,
          }).addTo(newMapLayerGroup);
          L.geoJSON(data, {
            filter: (feature) => {
              if (feature.geometry?.type === 'LineString' && feature.properties?.name === 'path') {
                return !managedLegacyPathIds.has(`new-${feature.id || data.features.indexOf(feature)}`);
              }
              if (feature.geometry?.type === 'Polygon' && feature.properties?.name) {
                return !hasSavedLayout(feature.properties.name, 'new');
              }
              return true;
            },
            style: (f) => {
              if (f.geometry.type === 'LineString') {
                if (f.properties?.type === 'boundary' || f.properties?.name === 'boundary') return { color: '#2196F3', weight: 4 };
                if (f.properties?.name === 'path') return { color: '#ffffff', weight: 3, opacity: 1.0, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' };
                return { color: '#2196F3', weight: 4 };
              }
              const sLabel = normalizeSectionName(f.properties.name || '');
              return { fillColor: sectionColorGetterRef.current(sLabel, 'new'), fillOpacity: 0.18, color: '#075985', weight: 2 };
            },
            onEachFeature: (feature, layer) => {
              if (feature.geometry?.type === 'LineString' && feature.properties?.name === 'path') {
                const key = `legacy-path-new-${feature.id || data.features.indexOf(feature)}`;
                layer.on('click', () => { if (!isDrawingPathwayRef.current) revealPathwayInSidebar(key); });
                layer.bindTooltip('Click to locate this pathway in the sidebar', { sticky: true });
                return;
              }
              if (feature.properties?.name && feature.geometry?.type.includes('Polygon')) {
                const label = normalizeSectionName(feature.properties.name).replace('Expansion Area ', 'Section ');
                
                decorateSection(feature, layer, label, newMapLayerGroup, 'new');
                layer.bindPopup(`<strong>${label}</strong><br>Existing cemetery section<br><button class="btn btn-primary btn-sm" style="width:100%;margin-top:8px" onclick="window.dispatchEvent(new CustomEvent('gravetrak_edit_legacy_section',{detail:{sectionName:'${label}',cemeteryMap:'new'}}))">Edit Boundary & Layout</button>`);
                layer.on('click', () => {
                  if (!isDrawingPathwayRef.current && !map.__sectionDrawingClickHandler) revealZoneInSidebar(label, 'new');
                });
                
                const plots = generateGravePlots(feature.geometry, label, 62, 'new');
                L.geoJSON(plots, {
                    renderer: mapCanvasRenderer,
                    interactive: false,
                    style: (plot) => ({ fillColor: getPlotColor(plot, 'new', PLANNING_PLOT_COLORS), fillOpacity: 0.8, color: '#d0e7f4', weight: cellWeight(), opacity: 0.75 }),
                    onEachFeature: (_feature, cell) => planningCells.push(cell),
                }).addTo(newMapLayerGroup);
              }
            } 
          }).addTo(newMapLayerGroup);
      };
      
      if (newCemeteryGeoJson) {
        loadNewMapDataPlanning(newCemeteryGeoJson);
      } else if (anotherMapData) {
        if (typeof anotherMapData === 'string') {
          fetch(anotherMapData).then(res => res.json()).then(loadNewMapDataPlanning).catch(e => console.error(e));
        } else {
          loadNewMapDataPlanning(anotherMapData);
        }
      }

      const sectionLayer = L.geoJSON(closeBoundaryFeatures(siteData), {
        smoothFactor: 0,
        filter: (feature) => {
          if (feature.geometry?.type !== 'Polygon' || !feature.properties?.id) return true;
          const label = normalizeSectionName(`Section ${feature.properties.id}`);
          return !hasSavedLayout(label, 'old');
        },
        style: (feature) => {
          if (feature.properties.type === 'boundary') return { color: '#2196F3', weight: 3, fillOpacity: 0 };
          return { fillColor: sectionColorGetterRef.current(feature.properties.id, 'old'), weight: 2, color: '#075985', fillOpacity: 0.18 };
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.id) {
            layer.bindPopup(`<strong>Section ${feature.properties.id}</strong><br>Existing cemetery section<br><button class="btn btn-primary btn-sm" style="width:100%;margin-top:8px" onclick="window.dispatchEvent(new CustomEvent('gravetrak_edit_legacy_section',{detail:{sectionName:'Section ${feature.properties.id}',cemeteryMap:'old'}}))">Edit Boundary & Layout</button>`);
            layer.on('click', () => {
              if (!isDrawingPathwayRef.current && !map.__sectionDrawingClickHandler) revealZoneInSidebar(`Section ${feature.properties.id}`, 'old');
            });
            decorateSection(feature, layer, `Section ${feature.properties.id}`, oldMapLayerGroup, 'old');
          }
        },
      }).addTo(oldMapLayerGroup);

      siteData.features.forEach(feature => {
        if (feature.properties.id && feature.geometry.type === 'Polygon') {
          const label = normalizeSectionName(`Section ${feature.properties.id}`);
          if (hasSavedLayout(label, 'old')) return;
          const plotsGeoJSON = generateGravePlots(feature.geometry, feature.properties.id, 42, 'old');
          L.geoJSON(plotsGeoJSON, {
            renderer: mapCanvasRenderer,
            interactive: false,
            style: (f) => ({ fillColor: getPlotColor(f, 'old', PLANNING_PLOT_COLORS), fillOpacity: 0.8, color: '#d0e7f4', weight: cellWeight(), opacity: 0.75 }),
            onEachFeature: (_feature, cell) => planningCells.push(cell),
          }).addTo(oldMapLayerGroup);
        }
      });

      // Keep both cemetery groups attached.  The cemetery switcher relies on
      // this established behavior so the New Cemetery map remains available
      // immediately after switching views.
      oldMapLayerGroup.addTo(map);
      newMapLayerGroup.addTo(map);

      if (activePlanningCemetery === 'new') {
        const newMapSource = newCemeteryGeoJson || anotherMapData;
        const newMapBounds = L.geoJSON(newMapSource).getBounds();
        if (newMapBounds.isValid()) {
          map.fitBounds(newMapBounds, { padding: [18, 18] });
        } else {
          map.setView(ANOTHER_CEMETERY_CENTER, 19);
        }
      } else {
        const boundary = siteData.features.find(f => f.properties.type === 'boundary');
        if (boundary) {
          map.fitBounds(L.geoJSON(boundary).getBounds(), { padding: [18, 18] });
        } else {
          map.setView(CEMETERY_CENTER, 19);
        }
      }

      // Safe Marker Mapping: Render existing cemetery sections from state
      if (cemeterySections && Array.isArray(cemeterySections)) {
        cemeterySections.forEach(f => {
            if (f?.geometry?.type === 'Polygon' && f.geometry.coordinates?.[0]?.length >= 4 && f.properties?.is_active !== false) { // Archived sections stay recoverable in the list but are hidden from the active map
              const sectionStatusColor = getSavedSectionStatusColor(f.properties?.status);
              L.geoJSON(f, {
                style: { fillColor: sectionStatusColor, weight: 2, color: '#075985', fillOpacity: 0.18 },
                onEachFeature: (feature, layer) => {
                  const props = feature.properties || {};
                  layer.options.isSavedSection = true;
                  decorateSection(feature, layer, props.zone_code || props.name || 'Section', f.properties?.cemetery_code === 'old' ? oldMapLayerGroup : newMapLayerGroup, props.cemetery_code || 'old');
                  layer.on('click', () => {
                    if (!isDrawingPathwayRef.current && !map.__sectionDrawingClickHandler) revealZoneInSidebar(props.name, props.cemetery_code || 'old');
                  });
                  layer.bindPopup(`<strong>${props.zone_code || 'Zone'} — ${props.name}</strong><br>Cemetery: ${props.cemetery_code === 'new' ? 'Lucena New Public Cemetery' : 'Lucena Old Public Cemetery'}<br>Status: ${props.is_active === false ? 'Inactive' : 'Active'}<br>Ground plots: ${props.total_plots || 0}<br>Available: ${props.available_plots || 0}<br>Occupied: ${props.occupied_plots || 0}<br>Boundary: ${props.has_geometry ? 'Available' : 'Not available'}`);
                }
              }).addTo(f.properties?.cemetery_code === 'old' ? oldMapLayerGroup : newMapLayerGroup);
            }
        });
      }

      cemeteryPathways.forEach(feature => {
        if (!feature?.geometry || feature.properties?.is_active === false) return;
        const roadWidth = Math.max(10, Math.min(22, Number(feature.properties?.width_meters || 4) * 3.5));
        const centerWidth = Math.max(2.5, Math.min(5, roadWidth * 0.22));
        const targetGroup = feature.properties?.cemetery_code === 'new' ? newMapLayerGroup : oldMapLayerGroup;
        L.geoJSON(feature, { style: { color: '#6b7280', weight: roadWidth, opacity: 1, lineCap: 'round', lineJoin: 'round' }, interactive: false }).addTo(targetGroup);
        L.geoJSON(feature, {
          style: { color: '#ffffff', weight: centerWidth, opacity: 1, dashArray: '10, 15', lineCap: 'round', lineJoin: 'round' },
          onEachFeature: (savedFeature, layer) => {
            layer.on('click', () => { if (!isDrawingPathwayRef.current) revealPathwayInSidebar(feature.id || feature.properties?.id); });
            layer.bindPopup(`<strong>${savedFeature.properties?.name || 'Pathway'}</strong><br>Type: ${savedFeature.properties?.pathway_type || 'walkway'}<br>Width: ${savedFeature.properties?.width_meters || 2} m`);
          },
        }).addTo(targetGroup);
      });

      const sectionLayoutMetrics = new Map();
      const sectionById = new Map(cemeterySections.map(section => [String(section.id || section.properties?.id), section]));
      const plotsBySection = new Map();
      groundPlots.forEach(plot => {
        const key = String(plot.section_record);
        if (!plotsBySection.has(key)) plotsBySection.set(key, []);
        plotsBySection.get(key).push(plot);
      });
      cemeterySections.forEach(section => {
        const sectionId = section.id || section.properties?.id;
        const ring = section.geometry?.coordinates?.[0];
        if (!sectionId || !Array.isArray(ring) || ring.length < 4) return;
        const sectionPlots = plotsBySection.get(String(sectionId)) || [];
        let maxRow = Number(section.properties?.layout_rows) || 1;
        let maxColumn = Number(section.properties?.layout_columns) || 1;
        const plotGridPositions = new Map();
        sectionPlots.forEach(plot => {
          const match = String(plot.location_description || '').match(/Row\s+(\d+),\s*Column\s+(\d+)/i)
            || String(plot.plot_id || '').match(/R(\d+)-C(\d+)$/i);
          if (match) {
            const row = Number(match[1]), column = Number(match[2]);
            maxRow = Math.max(maxRow, row);
            maxColumn = Math.max(maxColumn, column);
            plotGridPositions.set(String(plot.id), { row, column });
          }
        });
        const vertices = ring.slice(0, -1);
        const lngs = vertices.map(point => Number(point[0]));
        const lats = vertices.map(point => Number(point[1]));
        const orientation = section.properties?.layout_orientation || 'horizontal';
        sectionLayoutMetrics.set(String(sectionId), {
          halfHeight: ((Math.max(...lats) - Math.min(...lats)) / (orientation === 'vertical' ? maxRow : maxColumn)) * 0.36,
          halfWidth: ((Math.max(...lngs) - Math.min(...lngs)) / (orientation === 'vertical' ? maxColumn : maxRow)) * 0.36,
          quadrilateral: vertices.length === 4 ? vertices : null,
          maxRow,
          maxColumn,
          plotGridPositions,
        });
      });

      groundPlots.forEach(plot => {
        if (!Number.isFinite(Number(plot.latitude)) || !Number.isFinite(Number(plot.longitude))) return;
        const cemeteryCode = plot.cemetery_code || 'old';
        const section = sectionById.get(String(plot.section_record));
        // Grave markers inherit their parent section's archive visibility.
        if (!section || section.properties?.is_active === false) return;
        const floors = Number(section?.properties?.estimated_stack_height || 1);
        const color = plot.status === 'available' && section.geometry?.plot_layout === 'legacy-two-sided'
          ? getPlotColor({ properties: { name: `${plot.section_name}-C${plot.plot_number}` } }, cemeteryCode, PLANNING_PLOT_COLORS)
          : PLANNING_PLOT_COLORS[plot.status] || UNKNOWN_PLOT_COLOR;
        const metrics = sectionLayoutMetrics.get(String(plot.section_record));
        if (!metrics || metrics.halfHeight <= 0 || metrics.halfWidth <= 0) return;
        const latitude = Number(plot.latitude), longitude = Number(plot.longitude);
        const matchesSection = plotSectionFilter === 'all' || (plot.section_name || plot.section) === plotSectionFilter;
        const matchesStatus = plotStatusFilter === 'all' || plot.status === plotStatusFilter;
        let graveCell;
        const gridPosition = metrics.plotGridPositions.get(String(plot.id));
        if (metrics.quadrilateral && gridPosition && section.geometry?.plot_layout === 'legacy-two-sided') {
          graveCell = L.polygon(legacyTwoSidedCorners(metrics.quadrilateral, gridPosition.row, gridPosition.column).map(point => [point[1], point[0]]), {
            renderer: mapCanvasRenderer, color: '#d0e7f4', weight: cellWeight(), fillColor: color,
            fillOpacity: matchesSection && matchesStatus ? 0.8 : 0.08, opacity: matchesSection && matchesStatus ? 1 : 0.18,
          });
        } else if (metrics.quadrilateral && gridPosition) {
          const [p0, p1, p2, p3] = metrics.quadrilateral;
          const orientation = section.properties?.layout_orientation || 'horizontal';
          const useFirstToFourth = useFirstToFourthGridEdges(metrics.quadrilateral, orientation);
          const interpolate = (start, end, amount) => [
            start[0] + (end[0] - start[0]) * amount,
            start[1] + (end[1] - start[1]) * amount,
          ];
          const rowStart = (gridPosition.row - 1) / metrics.maxRow;
          const rowEnd = gridPosition.row / metrics.maxRow;
          const leftStart = useFirstToFourth ? interpolate(p0, p3, rowStart) : interpolate(p3, p2, rowStart);
          const rightStart = useFirstToFourth ? interpolate(p1, p2, rowStart) : interpolate(p0, p1, rowStart);
          const leftEnd = useFirstToFourth ? interpolate(p0, p3, rowEnd) : interpolate(p3, p2, rowEnd);
          const rightEnd = useFirstToFourth ? interpolate(p1, p2, rowEnd) : interpolate(p0, p1, rowEnd);
          const columnStart = (gridPosition.column - 1) / metrics.maxColumn;
          const columnEnd = gridPosition.column / metrics.maxColumn;
          const corners = [
            interpolate(leftStart, rightStart, columnStart),
            interpolate(leftStart, rightStart, columnEnd),
            interpolate(leftEnd, rightEnd, columnEnd),
            interpolate(leftEnd, rightEnd, columnStart),
          ].map(point => [point[1], point[0]]);
          graveCell = L.polygon(corners, {
            renderer: mapCanvasRenderer,
            color: '#d0e7f4',
            weight: cellWeight(),
            fillColor: color,
            fillOpacity: matchesSection && matchesStatus ? 0.8 : 0.08,
            opacity: matchesSection && matchesStatus ? 1 : 0.18,
          });
        } else {
          graveCell = L.rectangle([
            [latitude - metrics.halfHeight, longitude - metrics.halfWidth],
            [latitude + metrics.halfHeight, longitude + metrics.halfWidth],
          ], {
            renderer: mapCanvasRenderer,
            color: '#d0e7f4',
            weight: cellWeight(),
            fillColor: color,
            fillOpacity: matchesSection && matchesStatus ? 0.8 : 0.08,
            opacity: matchesSection && matchesStatus ? 1 : 0.18,
          });
        }
        graveCell.bindPopup(`<strong>${plot.plot_id}</strong><br>${plot.location_description || plot.section_name || plot.section}<br>Floors: ${floors}<br>Status: ${plot.status}`);
        graveCell.on('click', () => {
          if (isDrawingPathwayRef.current || map.__sectionDrawingClickHandler) return;
          revealZoneInSidebar(plot.section_name || plot.section, cemeteryCode);
        });
        graveCell.addTo(cemeteryCode === 'old' ? oldMapLayerGroup : newMapLayerGroup);
        planningCells.push(graveCell);
      });
      updatePlanningDetail();

      // Add wide, nearly invisible hit areas after every grave layer so roads
      // remain easy to select without requiring a pixel-perfect click.
      const addPathwayHitArea = (feature, targetGroup, key, label) => {
        const hitArea = L.geoJSON(feature, {
          interactive: true,
          style: { color: '#0ea5e9', weight: 26, opacity: 0.01, lineCap: 'round', lineJoin: 'round' },
          onEachFeature: (_path, layer) => {
            layer.on('mouseover', () => {
              if (isDrawingPathwayRef.current) return;
              layer.setStyle({ color: '#64748b', weight: 28, opacity: 0.12 });
              const element = layer.getElement?.();
              if (element) element.style.cursor = 'pointer';
            });
            layer.on('mouseout', () => {
              if (!isDrawingPathwayRef.current) layer.setStyle({ color: '#64748b', weight: 26, opacity: 0.01 });
            });
            layer.on('click', (event) => {
              if (isDrawingPathwayRef.current) return;
              L.DomEvent.stopPropagation(event);
              revealPathwayInSidebar(key);
            });
            const tooltipContent = document.createElement('div');
            const tooltipName = document.createElement('strong');
            tooltipName.textContent = label;
            const tooltipHint = document.createElement('div');
            tooltipHint.textContent = 'Click to locate in Pathways';
            tooltipHint.style.fontSize = '10px';
            tooltipContent.append(tooltipName, tooltipHint);
            layer.bindTooltip(tooltipContent, { sticky: true, direction: 'top', opacity: 0.96 });
          },
        }).addTo(targetGroup);
        hitArea.eachLayer(layer => layer.bringToFront?.());
      };

      pathwaysGeoJson.features.forEach((feature, index) => {
        const sourceId = `old-${index}`;
        if (!managedLegacyPathIds.has(sourceId)) addPathwayHitArea(feature, oldMapLayerGroup, `legacy-path-${sourceId}`, `Existing Pathway ${index + 1}`);
      });
      (anotherMapData?.features || []).forEach((feature, index) => {
        if (feature.geometry?.type !== 'LineString' || feature.properties?.name !== 'path') return;
        const sourceId = `new-${feature.id || index}`;
        if (!managedLegacyPathIds.has(sourceId)) addPathwayHitArea(feature, newMapLayerGroup, `legacy-path-${sourceId}`, `Existing Pathway ${index + 1}`);
      });
      cemeteryPathways.forEach(feature => {
        if (!feature?.geometry || feature.properties?.is_active === false) return;
        addPathwayHitArea(
          feature,
          feature.properties?.cemetery_code === 'new' ? newMapLayerGroup : oldMapLayerGroup,
          feature.id || feature.properties?.id,
          feature.properties?.name || 'Cemetery Pathway'
        );
      });

      // Resolve both sections and pathways at the map container, independently
      // of canvas ordering. A section's interior takes priority over the broad
      // pathway proximity halo.
      const proximityPaths = [];
      pathwaysGeoJson.features.forEach((feature, index) => {
        const sourceId = `old-${index}`;
        if (!managedLegacyPathIds.has(sourceId)) proximityPaths.push({ feature, key: `legacy-path-${sourceId}`, label: `Existing Pathway ${index + 1}` });
      });
      (anotherMapData?.features || []).forEach((feature, index) => {
        if (feature.geometry?.type !== 'LineString' || feature.properties?.name !== 'path') return;
        const sourceId = `new-${feature.id || index}`;
        if (!managedLegacyPathIds.has(sourceId)) proximityPaths.push({ feature, key: `legacy-path-${sourceId}`, label: `Existing Pathway ${index + 1}` });
      });
      cemeteryPathways.forEach(feature => {
        if (feature?.geometry && feature.properties?.is_active !== false) proximityPaths.push({ feature, key: feature.id || feature.properties?.id, label: feature.properties?.name || 'Cemetery Pathway' });
      });

      const container = map.getContainer();
      const hoverTooltip = L.tooltip({ direction: 'top', offset: [0, -12], opacity: 0.96, className: 'pathway-hover-tooltip' });
      // Native pointer events can outlive a Leaflet map for one render frame
      // while React is replacing map overlays. Do not use Leaflet projection
      // methods after that map instance has been disposed.
      const isPathwayMapActive = () => Boolean(map._loaded && map._mapPane && container.isConnected);
      const findMapTarget = event => {
        const point = map.mouseEventToContainerPoint(event);
        const coordinate = map.containerPointToLatLng(point);
        return { point, target: findPlanningMapTarget({
          point, coordinate: [coordinate.lng, coordinate.lat], sections: sectionHitTargets, paths: proximityPaths,
          project: coordinate => map.latLngToContainerPoint([coordinate[1], coordinate[0]]),
        }) };
      };
      const isDrawingOnMap = () => Boolean(isDrawingPathwayRef.current || map.__sectionDrawingClickHandler || map.__activePolygonDrawer);
      const ignoresMapClick = event => event.target?.closest?.('.map-fab, .cemetery-switcher-container, .leaflet-control, .leaflet-popup');
      const handlePlanningPointerMove = event => {
        if (!isPathwayMapActive()) return;
        if (isDrawingOnMap()) {
          container.style.cursor = 'crosshair';
          if (map.hasLayer(hoverTooltip)) map.removeLayer(hoverTooltip);
          return;
        }
        if (ignoresMapClick(event)) return;
        const { target, point } = findMapTarget(event);
        container.style.cursor = target ? 'pointer' : '';
        if (!target) {
          if (map.hasLayer(hoverTooltip)) map.removeLayer(hoverTooltip);
          return;
        }
        const content = document.createElement('div');
        const name = document.createElement('strong');
        const isSection = target.type === 'section';
        name.textContent = isSection ? target.section.properties.name : target.pathway.label;
        const hint = document.createElement('div');
        hint.textContent = isSection ? 'Click to locate in Zones' : 'Click to locate in Pathways';
        hint.style.fontSize = '10px';
        content.append(name, hint);
        hoverTooltip.setContent(content).setLatLng(map.containerPointToLatLng(point));
        if (!map.hasLayer(hoverTooltip)) hoverTooltip.addTo(map);
      };
      const handlePlanningContainerClick = event => {
        if (!isPathwayMapActive() || isDrawingOnMap() || ignoresMapClick(event)) return;
        if (event.button !== 0 || map.dragging?.moved() || map.boxZoom?.moved()) return;
        const { target } = findMapTarget(event);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        if (target.type === 'section') {
          const props = target.section.properties;
          revealZoneInSidebar(props.name, props.cemetery_code);
        } else {
          revealPathwayInSidebar(target.pathway.key);
        }
      };
      container.addEventListener('pointermove', handlePlanningPointerMove, true);
      container.addEventListener('click', handlePlanningContainerClick, true);
      map.once('unload', () => {
        container.removeEventListener('pointermove', handlePlanningPointerMove, true);
        container.removeEventListener('click', handlePlanningContainerClick, true);
      });

      return sectionLayer;
    }, [sectionColorGetterRef, getColumbariumSectionStats, getPlotColor, onEachPlotFeature, newCemeteryGeoJson, activePlanningCemetery, cemeterySections, cemeteryPathways, cemeteries, groundPlots, plotSectionFilter, plotStatusFilter, revealPathwayInSidebar, revealZoneInSidebar]),
  });

  // Inilipat natin ang useEffect na ito DITO sa ibaba para siguradong exist na ang adminMapRef at planningMapRef
  useEffect(() => {
    if (!active) return;
    const updateMapColors = (mapRef) => {
      if (!mapRef.current) return;
      const colLookup = {};
      columbariumSlots.forEach(s => {
        if(['occupied', 'reserved'].includes(s.status)) {
          const key = `${normalizeSectionName(s.section)}-${s.col}-${s.cemeteryMap}`;
          colLookup[key] = (colLookup[key] || 0) + 1;
        }
      });
      const graveLookup = {};
      const plotLookup = new Map();
      groundPlots.forEach(plot => {
        const key = `${plot.cemetery_code || 'old'}:${plot.plot_id}`;
        graveLookup[key] = plot.status;
        plotLookup.set(key, plot);
      });

      mapRef.current.eachLayer((layer) => {
        const checkAndStyleLayer = (l) => {
            if (l.options && l.options.isGravePlot) {
                const plotId = l.feature.properties.name || l.feature.properties.plot_id;
                const cemeteryMapContext = l.feature.properties.cemeteryMap || l.feature.properties.cemetery_code || 'old';
                const palette = mapRef === planningMapRef ? PLANNING_PLOT_COLORS : PLOT_STATUS_COLORS;
                let fillColor = palette.available;
                if (plotId && plotId.includes('Section') && plotId.includes('-C')) {
                  const parts = plotId.split('-C');
                  const key = `${normalizeSectionName(parts[0])}-${parts[1]}-${cemeteryMapContext}`;
                  let occupiedCount = colLookup[key] || 0;
                  if (graveLookup[`${cemeteryMapContext}:${plotId}`] === 'occupied') occupiedCount++;
                  if (occupiedCount > 0) fillColor = palette.occupied;
                } else {
                  const status = graveLookup[`${cemeteryMapContext}:${plotId}`];
                  fillColor = palette[status] || UNKNOWN_PLOT_COLOR;
                }
                const plotRecord = plotLookup.get(`${cemeteryMapContext}:${plotId}`);
                const props = l.feature.properties;
                if (props.niche_column && plotRecord?.status === 'available'
                  && colLookup[`${normalizeSectionName(props.section_name)}-${props.niche_column}-${cemeteryMapContext}`]) fillColor = palette.occupied;
                const sectionFilter = mapRef === adminMapRef ? staffMapSectionFilter : plotSectionFilter;
                const statusFilter = mapRef === adminMapRef ? staffMapStatusFilter : plotStatusFilter;
                const matchesZone = sectionFilter === 'all' || (plotRecord && (plotRecord.section_name || plotRecord.section) === sectionFilter);
                const matchesStatus = statusFilter === 'all' || (plotRecord && plotRecord.status === statusFilter);
                const matchesCemetery = mapRef !== adminMapRef || cemeteryMapContext === activeAdminCemetery;
                const isVisible = matchesZone && matchesStatus && matchesCemetery;
                const isPlanningMap = mapRef === planningMapRef;
                applyPlotFilterStyle(l, {
                  fillColor,
                  color: '#d0e7f4',
                  weight: planningPlotWeight(mapRef.current.getZoom()),
                  fillOpacity: isVisible ? (isPlanningMap ? 0.8 : 0.78) : (isPlanningMap ? 0.06 : 0.38),
                  opacity: isVisible ? 1 : (isPlanningMap ? 0.12 : 0.45),
                }, isVisible);
            } else if (!l.options?.isSavedSection && l.feature && l.feature.properties && l.feature.geometry && l.feature.geometry.type.includes('Polygon')) {
                const props = l.feature.properties;

                if (props.id) {
                    l.setStyle({ fillColor: sectionColorGetterRef.current(props.name || props.id, props.cemetery_code || 'old', props.id) });
                } else if (props.name) {
                    let sName = props.name || '';
                    let sLabel = normalizeSectionName(sName).replace('Expansion Area ', 'Section ');
                    if (sLabel.toLowerCase() === 'section n') sLabel = 'Section A';
                    if (sLabel.toLowerCase() === 'section o') sLabel = 'Section B';
                    
                    if (sLabel === 'Section A' || sLabel === 'Section B') {
                        l.setStyle({ fillColor: sectionColorGetterRef.current(sLabel, 'new') });
                    }
                }
            }
            
            if (l.eachLayer) {
                l.eachLayer(checkAndStyleLayer);
            }
        };
        checkAndStyleLayer(layer);
      });
    };
    if (isStaffRole) updateMapColors(adminMapRef);
    if (isPlanningRole) updateMapColors(planningMapRef);
  }, [groundPlots, columbariumSlots, plotSectionFilter, plotStatusFilter, staffMapSectionFilter, staffMapStatusFilter, activeAdminCemetery, staffMapRenderState, planningMapRenderState, selectedPanel, active, isStaffRole, isPlanningRole, adminMapRef, planningMapRef]);

  useEffect(() => {
    groundPlotsRef.current = groundPlots;
  }, [groundPlots]);


  useEffect(() => {
    if (active && panels.length > 0 && !panels.some(item => item.panel === selectedPanel)) {
      setSelectedPanel(panels[0]?.panel || 'panel-admin-map');
    }
  }, [active, appRole, panels, selectedPanel]);

  const info = currentRoleInfo || roleInfo[appRole] || roleInfo.staff;
  // CPDO zoning is the source of truth for which apartment-niche sections
  // are navigable.  Slot records supply capacity and occupants, but cannot
  // introduce a section that is not an active section on the cemetery map.
  const zonedSectionOptionsByCemetery = useMemo(() => Object.fromEntries(
    ['old', 'new'].map(code => [code, planningSectionsByCemetery[code]
      .map(section => section.properties.name).sort(compareInventorySections)])
  ), [planningSectionsByCemetery]);
  const sectionOptions = useMemo(() => {
    return zonedSectionOptionsByCemetery[activeColumbariumMap] || [];
  }, [zonedSectionOptionsByCemetery, activeColumbariumMap]);
  const zonedColumbariumSlots = useMemo(() => columbariumSlots.filter(slot =>
    (zonedSectionOptionsByCemetery[slot.cemeteryMap] || []).some(section =>
      normalizeSectionName(section) === normalizeSectionName(slot.section)
    )
  ), [columbariumSlots, zonedSectionOptionsByCemetery]);
  useEffect(() => {
    if (!sectionOptions.length) return;
    const isCurrentSectionMapped = sectionOptions.some(section =>
      normalizeSectionName(section) === normalizeSectionName(columbariumSection)
    );
    if (!isCurrentSectionMapped) setColumbariumSection(sectionOptions[0]);
  }, [sectionOptions, columbariumSection]);
  const sectionStatusCounts = useMemo(() => {
    const counts = new Map();
    for (const slot of columbariumSlots) {
      if (slot.cemeteryMap !== activeColumbariumMap) continue;
      const key = normalizeSectionName(slot.section);
      const sectionCounts = counts.get(key) || { available: 0, occupied: 0, maintenance: 0 };
      if (slot.status in sectionCounts) sectionCounts[slot.status] += 1;
      counts.set(key, sectionCounts);
    }
    return counts;
  }, [columbariumSlots, activeColumbariumMap]);
  const selectedColumbariumSlots = useMemo(() => columbariumSlots.filter(slot =>
    normalizeSectionName(slot.section) === normalizeSectionName(columbariumSection) && slot.cemeteryMap === activeColumbariumMap
  ), [columbariumSlots, columbariumSection, activeColumbariumMap]);
  const colCount = Math.max(1, ...selectedColumbariumSlots.map(slot => Number(slot.col) || 0));
  const floorCount = Math.max(1, ...selectedColumbariumSlots.map(slot => Number(slot.floor) || 0));
  const isLegacyDoubleSidedLayout = colCount === 84 || colCount === 124 || colCount === 132;
  const matchingPlanningSection = cemeterySections.find(section =>
    normalizeSectionName(section.properties?.name) === normalizeSectionName(columbariumSection) &&
    (section.properties?.cemetery_code || 'old') === activeColumbariumMap
  );
  const matchingSectionId = matchingPlanningSection?.id || matchingPlanningSection?.properties?.id;
  const matchingGroundPlots = groundPlots.filter(plot => String(plot.section_record) === String(matchingSectionId));
  const configuredSectionLayout = getSectionLayout(matchingPlanningSection, matchingGroundPlots);
  const isDoubleSidedLayout = configuredSectionLayout
    ? configuredSectionLayout.rows === 2
    : colCount > 1 && (isLegacyDoubleSidedLayout || colCount % 2 === 0);
  const slotsPerSide = isDoubleSidedLayout ? colCount / 2 : colCount;
  const floorLabels = useMemo(() => Array.from({ length: floorCount }, (_, index) => floorCount - index), [floorCount]);
  const slotNumbers = useMemo(() => Array.from({ length: colCount }, (_, index) => index + 1), [colCount]);
  const columbariumSlotGroups = useMemo(() => isDoubleSidedLayout
    ? [slotNumbers.slice(0, slotsPerSide), slotNumbers.slice(slotsPerSide, colCount)]
    : [slotNumbers], [isDoubleSidedLayout, slotNumbers, slotsPerSide, colCount]);
  const nicheLayouts = useMemo(() => {
    const layouts = new Map();
    for (const section of cemeterySections) {
      const props = section.properties || {};
      const plots = groundPlots.filter(plot => String(plot.section_record) === String(section.id || props.id));
      const layout = getSectionLayout(section, plots);
      if (layout) layouts.set(`${props.cemetery_code || 'old'}:${normalizeSectionName(props.name)}`, layout);
    }
    return layouts;
  }, [cemeterySections, groundPlots]);
  const getSlotPosition = slot => getNichePosition(slot, nicheLayouts.get(`${slot.cemeteryMap || slot.cemetery_map || 'old'}:${normalizeSectionName(slot.section)}`));
  const getColumbariumSide = slot => getSlotPosition(slot).side;
  const getColumbariumDisplayCol = slot => getSlotPosition(slot).column;

  const staffSearchSections = useMemo(() => [
    ...resolvePlanningSections(sharedMapSections, siteData.features, 'old'),
    ...resolvePlanningSections(sharedMapSections, anotherMapData.features, 'new'),
  ], [sharedMapSections]);
  const staffMapPlots = groundPlots.filter(plot => (plot.cemetery_code || plot.cemetery?.code || 'old') === activeAdminCemetery);
  const staffMapSections = [...new Set(staffMapPlots.map(plot => plot.section_name || plot.section).filter(Boolean))].sort(compareInventorySections);
  const staffMapCounts = staffMapPlots.reduce((counts, plot) => { const key = String(plot.status || '').toLowerCase(); if (Object.hasOwn(counts, key)) counts[key]++; return counts; }, { available: 0, occupied: 0, maintenance: 0 });
  const staffMapUnrecordedCount = Math.max(0, staffMapPlots.length - staffMapCounts.available - staffMapCounts.occupied - staffMapCounts.maintenance);
  const staffMapVisibleCount = staffMapPlots.filter(plot => {
    const statusMatch = staffMapStatusFilter === 'all' || plot.status === staffMapStatusFilter;
    const sectionMatch = staffMapSectionFilter === 'all' || (plot.section_name || plot.section) === staffMapSectionFilter;
    return statusMatch && sectionMatch;
  }).length;

  const handleCreateGrave = async () => {
    try {
      const created = await createGrave(newGrave);
      setGraveData((current) => [...current, created]);
      setNewGrave({
        grave_id: '',
        name: '',
        dates: '',
        location: '',
        status: 'available',
        latitude: 14.48,
        longitude: 120.897,
        notes: '',
      });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteGrave = async (id) => {
    try {
      await deleteGrave(id);
      setGraveData((current) => current.filter((grave) => grave.id !== id));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddColumbarium = () => { 
    const currentSections = sectionOptions;
    let newSectionName;

    if (activeColumbariumMap === 'old') {
      let nextLetter = 'A';
      if (currentSections.length > 0) {
        const lastSection = currentSections.filter(s => s.startsWith('Section ')).pop();
        if (lastSection) {
          const lastLetter = lastSection.replace('Section ', '');
          nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);
        }
      }
      newSectionName = `Section ${nextLetter}`;
    } else { // activeColumbariumMap === 'new'
      let nextNumber = 1;
      if (currentSections.length > 0) {
        const lastSection = currentSections.filter(s => s.startsWith('New Section ')).pop();
        if (lastSection) {
          const match = lastSection.match(/New Section (\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }
      }
      newSectionName = `New Section ${nextNumber}`;
    }
    
    const countPerSection = activeColumbariumMap === 'new' ? 132 : 84;
    showConfirm('Add New Section', `Are you sure you want to add a new building/section (${newSectionName}) with ${countPerSection * 4} new slots?`, () => {
      const newSlots = [];
      for (let f = 1; f <= 4; f++) {
        for (let c = 1; c <= countPerSection; c++) {
          newSlots.push({
            id: `${newSectionName}-F${f}-C${c}`,
            section: newSectionName,
            floor: f,
            col: c,
            status: 'available',
            name: '',
            cemeteryMap: activeColumbariumMap
          });
        }
      }
      newSlots.forEach(s => createColumbarium(s).catch(() => {}));
      setColumbariumSlots(current => [...current, ...newSlots]);
      setColumbariumSection(newSectionName);
      showToast(`Success! ${newSectionName} has been added with 336 available slots.`);
      
      const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
      const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
      logs.unshift({
        id: Date.now(),
        date: new Date().toLocaleString(),
        user: userName,
        action: `Added New Building/Section to ${activeColumbariumMap} map`,
        details: `Created ${newSectionName} with ${countPerSection * 4} new available columbarium slots.`
      });
      localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
    }, false);
  };

  const handleColumbariumFilterChange = (filter) => {
    setColumbariumFilter(filter);
  };

  const handleSlotClick = useCallback((slotId, floor, slot, status, name, section, cemeteryMap) => {
    const sec = section || columbariumSection;
    if (isPlanningRole) {
      setPlotManagerTarget({ cemetery: cemeteryMap || activeColumbariumMap, kind: 'niche', id: slotId });
      return;
    }
    if (status === 'maintenance') {
      showToast('This niche is under maintenance. CPDO must complete maintenance before occupant changes.', 'error');
      return;
    }
    setSelectedSlotDetails({ id: slotId, floor, col: slot, status, name, section: sec, cemeteryMap: cemeteryMap || activeColumbariumMap }); // Store cemeteryMap
    setTransferNote('');
    setIsNicheTransferOpen(false);
    setIsSlotModalOpen(true);
    setIsEditingSlotName(false);
    setIsManualAssignOpen(false);
    setManualAssignFirstName('');
    setManualAssignLastName('');
  }, [columbariumSection, activeColumbariumMap, isPlanningRole]);

  const beginNicheTransfer = () => {
    if (!selectedSlotDetails || selectedSlotDetails.status !== 'occupied') return;
    const cemetery = selectedSlotDetails.cemeteryMap;
    const availableSections = Array.from(new Set(
      columbariumSlots
        .filter(slot => slot.cemeteryMap === cemetery && slot.status === 'available' && slot.id !== selectedSlotDetails.id)
        .map(slot => slot.section)
    )).sort((a, b) => a.localeCompare(b));
    const sourceSectionHasSpace = availableSections.some(section =>
      normalizeSectionName(section) === normalizeSectionName(selectedSlotDetails.section)
    );
    setActiveColumbariumMap(cemetery);
    setColumbariumSection(sourceSectionHasSpace ? selectedSlotDetails.section : (availableSections[0] || selectedSlotDetails.section));
    setColumbariumFilter('available');
    setNicheFocusTarget(null);
    setIsNicheTransferOpen(true);
    setIsSlotModalOpen(false);
    setSelectedPanel('panel-columbarium');
  };

  const handleNicheTransferDestination = useCallback((slotId, floor, col, status, name) => {
    if (!selectedSlotDetails || !isNicheTransferOpen || isTransferringNiche) return;
    if (status !== 'available') {
      showToast('Please choose an available niche.', 'error');
      return;
    }
    const target = columbariumSlots.find(slot =>
      slot.id === slotId && slot.cemeteryMap === activeColumbariumMap
      && normalizeSectionName(slot.section) === normalizeSectionName(columbariumSection)
      && slot.status === 'available'
    );
    if (!target) {
      showToast('That niche is no longer available. Refresh the Apartment Niches list and try again.', 'error');
      return;
    }

    showConfirm(
      'Transfer Occupant',
      `Move ${selectedSlotDetails.name} from ${selectedSlotDetails.id} to ${target.id}? The source niche will become available.`,
      async () => {
        setIsTransferringNiche(true);
        try {
          const result = await transferColumbarium(selectedSlotDetails.id, target.id);
          setColumbariumSlots(current => current.map(slot => {
            if (slot.id === selectedSlotDetails.id) return { ...slot, name: result.source.name, status: result.source.status };
            if (slot.id === target.id) return { ...slot, name: result.destination.name, status: result.destination.status };
            return slot;
          }));
          setSelectedSlotDetails(null);
          setIsNicheTransferOpen(false);
          showToast(`Occupant transferred to ${target.id}.`);
        } catch (error) {
          showToast(error.message || 'The niche transfer could not be completed.', 'error');
        } finally {
          setIsTransferringNiche(false);
        }
      },
      false
    );
  }, [selectedSlotDetails, isNicheTransferOpen, isTransferringNiche, columbariumSlots, activeColumbariumMap, columbariumSection, showConfirm, showToast]);

  const handleSaveNewSection = async () => {
    if (isSavingSection) return;
    setSectionFormError('');
    if (!newSectionData.name.trim() || !newSectionData.zone_code.trim()) {
      setSectionFormError('Zone name and zone code are required.');
      return;
    }
    if (newSectionData.name.trim().length > 50) {
      setSectionFormError('Zone name must be 50 characters or fewer.');
      return;
    }
    const requestedName = normalizeSectionName(newSectionData.name.trim()).toLowerCase();
    const duplicateSavedName = findSectionConflict(cemeterySections, {
      cemetery: activePlanningCemetery, name: requestedName, excludeId: editingZone?.id,
    });
    if (duplicateSavedName) {
      setSectionFormError(`Section name is already used by ${duplicateSavedName.properties?.name} in this cemetery.`);
      return;
    }
    const mapSections = activePlanningCemetery === 'new' ? anotherMapData.features : siteData.features;
    const duplicateMappedName = resolvePlanningSections(cemeterySections, mapSections, activePlanningCemetery).find(feature => {
      if (!feature.isLegacySidebar) return false;
      if (feature.geometry?.type !== 'Polygon') return false;
      const mapName = feature.properties?.name;
      const normalized = normalizeSectionName(mapName).replace('Expansion Area ', 'Section ').toLowerCase();
      return normalized === requestedName && normalized !== normalizeSectionName(editingZone?.legacySourceName).toLowerCase();
    });
    if (duplicateMappedName) {
      setSectionFormError('This name is already used by another mapped section in the selected cemetery.');
      return;
    }
    const zoneCode = newSectionData.zone_code.trim().toUpperCase();
    if (zoneCode.length > 32) {
      setSectionFormError('Zone code must be 32 characters or fewer.');
      return;
    }
    const duplicateZone = findSectionConflict(cemeterySections, {
      cemetery: activePlanningCemetery, zoneCode, excludeId: editingZone?.id,
    });
    if (duplicateZone) {
      setSectionFormError(`Zone code ${zoneCode} is already used by ${duplicateZone.properties?.name || 'another section'} in this cemetery. Please choose a different code.`);
      return;
    }
    if (!editingZone && !newSectionGeometry) {
      showToast('Draw the section boundary before saving.', 'error');
      return;
    }
    const layoutRows = Number(newSectionData.rows);
    const layoutOrientation = newSectionData.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const layoutColumns = Number(newSectionData.columns);
    const layoutFloors = Number(newSectionData.estimated_stack_height);
    if (![1, 2].includes(layoutRows) || !Number.isInteger(layoutColumns) || layoutColumns < 1 || layoutColumns > 132 || layoutRows * layoutColumns > 500) {
      showToast('Choose 1 or 2 rows and 1–132 columns.', 'error');
      return;
    }
    if (!Number.isInteger(layoutFloors) || layoutFloors < 1 || layoutFloors > 10) {
      showToast('Stack height must be between 1 and 10 floors.', 'error');
      return;
    }
    let remountPlanningMapAfterSave = false;
    setIsSavingSection(true);
    try {
      const dataToSave = {
        cemetery: cemeteries.find(cemetery => cemetery.code === activePlanningCemetery)?.id || null,
        name: newSectionData.name.trim(),
        legacy_source_name: editingZone?.legacySourceName || '',
        zone_code: newSectionData.zone_code.trim().toUpperCase(),
        description: newSectionData.description,
        is_active: newSectionData.is_active,
        status: newSectionData.status,
        estimated_stack_height: newSectionData.estimated_stack_height,
        geometry: newSectionGeometry || editingZone?.geometry || {},
      };
      if (editingZone && !editingZone.isLegacy) {
        const boundaryChanged = JSON.stringify(newSectionGeometry || {}) !== JSON.stringify(editingZone.geometry || {});
        const plotLayoutChanged = !editingZone.hasPlots || boundaryChanged || (editingZone.isQuadrilateral && editingZone.plotCount !== layoutRows * layoutColumns) || layoutRows !== editingZone.rows || layoutColumns !== editingZone.columns || layoutOrientation !== editingZone.orientation;
        const floorsChanged = layoutFloors !== editingZone.floors;
        if (plotLayoutChanged && editingZone.hasProtectedPlots) {
          throw new Error('Boundary, rows, columns, and orientation cannot be changed while this section has occupied or assigned graves. Floors can still be increased safely.');
        }
        await updateCemeterySection(editingZone.id, dataToSave);
        if (plotLayoutChanged) {
          // Fully unmount Leaflet before replacing its complete polygon data.
          // Updating coordinates while the canvas renderer is active can leave
          // the map in a blank/white teardown state.
          remountPlanningMapAfterSave = true;
          setSelectedPanel('panel-planning-dash');
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await generateBurialPlotLayout({ section: editingZone.id, rows: layoutRows, columns: layoutColumns, floors: layoutFloors, orientation: layoutOrientation, replace_existing: editingZone.hasPlots });
        }
        if (plotLayoutChanged || floorsChanged) {
          const resizedColumbariumSlots = await createColumbariumSection({ section: newSectionData.name.trim(), cemetery_map: activePlanningCemetery, floors: layoutFloors, columns: layoutColumns, rows: layoutRows });
          const normalizedSlots = processSlots(Array.isArray(resizedColumbariumSlots) ? resizedColumbariumSlots : []);
          setColumbariumSlots(current => [...current.filter(slot => !(slot.section === newSectionData.name.trim() && slot.cemeteryMap === activePlanningCemetery)), ...normalizedSlots]);
        }
        showToast(`Zone "${newSectionData.name}" and its grave layout updated successfully!`);
      } else {
        let createdSection;
        let recoveredExistingSection = false;
        try {
          createdSection = await createCemeterySection(dataToSave);
        } catch (createError) {
          // A previous multi-step save may have created the section and grave
          // grid before the columbarium request failed. Recover that same
          // section on retry instead of trapping the user in a duplicate error.
          const existingData = await fetchCemeterySections(activePlanningCemetery);
          const existingFeatures = Array.isArray(existingData?.features) ? existingData.features : [];
          createdSection = existingFeatures.find(feature =>
            feature.properties?.name?.trim().toLowerCase() === newSectionData.name.trim().toLowerCase() &&
            feature.properties?.zone_code?.trim().toUpperCase() === newSectionData.zone_code.trim().toUpperCase()
          );
          if (!createdSection) throw createError;
          recoveredExistingSection = true;
        }
        const createdSectionId = createdSection?.id || createdSection?.properties?.id;
        if (!createdSectionId) throw new Error('The saved section ID was not returned by the API.');
        if (!recoveredExistingSection || Number(createdSection.properties?.total_plots || 0) === 0) {
          await generateBurialPlotLayout({
            section: createdSectionId,
            rows: layoutRows,
            columns: layoutColumns,
            floors: layoutFloors,
            orientation: layoutOrientation,
            replace_existing: false,
          });
        }
        const createdColumbariumSlots = await createColumbariumSection({
          section: newSectionData.name.trim(),
          previous_section: editingZone?.isLegacy ? editingZone.originalName : '',
          cemetery_map: activePlanningCemetery,
          rows: layoutRows,
          floors: layoutFloors,
          columns: layoutColumns,
        });
        const normalizedNewSlots = processSlots(Array.isArray(createdColumbariumSlots) ? createdColumbariumSlots : []);
        setColumbariumSlots(current => {
          const slotMap = new Map(current.map(slot => [`${slot.id}:${slot.cemeteryMap}`, slot]));
          normalizedNewSlots.forEach(slot => slotMap.set(`${slot.id}:${slot.cemeteryMap}`, slot));
          return Array.from(slotMap.values());
        });
        showToast(`${editingZone?.isLegacy ? 'Existing section upgraded' : 'Zone created'}: "${newSectionData.name}" now has an editable layout and ${normalizedNewSlots.length} niche slots.`);
      }
      setIsNewSectionModalOpen(false);
      setEditingZone(null);
      removeUnsavedSectionLayer();
      setNewSectionData({ name: '', zone_code: '', description: '', is_active: true, status: 'active', estimated_stack_height: 1, rows: 1, columns: 8, orientation: 'horizontal' });
      setCemeterySectionsError('');
      const [refreshed, refreshedPlots, refreshedSummary, refreshedSlots] = await Promise.all([
        fetchCemeterySections(),
        fetchBurialPlots(),
        fetchBurialPlotSummary(),
        fetchColumbariums(),
      ]);
      // Commit the mutually dependent section geometry/orientation and plot
      // coordinates together, preventing an intermediate invalid map frame.
      setCemeterySections(Array.isArray(refreshed?.features) ? refreshed.features : []);
      setGroundPlots(Array.isArray(refreshedPlots) ? refreshedPlots : []);
      setGroundPlotSummary(refreshedSummary || { total: 0, available: 0, occupied: 0, maintenance: 0, sections: [] });
      if (Array.isArray(refreshedSlots)) {
        const normalizedSlots = processSlots(refreshedSlots);
        setColumbariumSlots(normalizedSlots);
        localStorage.setItem('gravetrak_columbarium', JSON.stringify(normalizedSlots));
      }
      if (editingZone?.originalName && normalizeSectionName(columbariumSection) === normalizeSectionName(editingZone.originalName)) {
        setColumbariumSection(newSectionData.name.trim());
      }
    } catch (err) {
      const saveError = `Could not complete section save: ${err.message}`;
      setCemeterySectionsError(saveError);
      setSectionFormError(saveError);
      showToast(`Failed to create section: ${err.message}`, 'error');
    } finally {
      setIsSavingSection(false);
      if (remountPlanningMapAfterSave) {
        schedulePassiveTimeout(() => setSelectedPanel('panel-planning'), 120);
      }
    }
  };

  const openCreateZoneModal = () => {
    chooseSectionMethod();
  };

  const openEditZoneModal = (feature) => {
    const props = feature.properties || {};
    const sectionId = feature.id || props.id;
    const sourceFeatures = (props.cemetery_code || 'old') === 'new' ? anotherMapData.features : siteData.features;
    const matchingLegacy = sourceFeatures.find(source =>
      source.geometry?.type === 'Polygon' &&
      (JSON.stringify(source.geometry) === JSON.stringify(feature.geometry) ||
        normalizeSectionName(source.properties?.name || `Section ${source.properties?.id || ''}`) === normalizeSectionName(props.name))
    );
    const legacySourceName = props.legacy_source_name || (matchingLegacy
      ? normalizeSectionName(matchingLegacy.properties?.name || `Section ${matchingLegacy.properties?.id || ''}`).replace('Expansion Area ', 'Section ')
      : '');
    const sectionPlots = groundPlots.filter(plot => String(plot.section_record) === String(sectionId));
    const { rows, columns } = getSectionLayout(feature, sectionPlots) || { rows: 2, columns: 8 };
    const floors = Number(props.estimated_stack_height || 1);
    const orientation = props.layout_orientation || 'horizontal';
    const hasProtectedPlots = sectionPlots.some(plot => plot.status !== 'available' || plot.assigned_to || plot.occupied_by_application)
      || columbariumSlots.some(slot => slot.cemeteryMap === activePlanningCemetery
        && normalizeSectionName(slot.section) === normalizeSectionName(props.name)
        && (slot.status !== 'available' || slot.name));
    setEditingZone({ id: sectionId, originalName: props.name || '', legacySourceName, geometry: feature.geometry || {}, rows, columns, floors, orientation, hasPlots: sectionPlots.length > 0, hasProtectedPlots, plotCount: sectionPlots.length, isQuadrilateral: feature.geometry?.coordinates?.[0]?.slice(0, -1).length === 4 });
    setNewSectionGeometry(feature.geometry || null);
    setNewSectionData({
      name: props.name || '', zone_code: props.zone_code || '', description: props.description || '',
      is_active: props.is_active !== false, status: props.status || 'active',
      estimated_stack_height: props.estimated_stack_height || 1,
      rows, columns, orientation,
    });
    setIsNewSectionModalOpen(true);
  };

  const openLegacyZoneModal = (sectionName, cemeteryMap) => {
    const normalizedName = normalizeSectionName(sectionName);
    const saved = cemeterySections.find(section =>
      (section.properties?.cemetery_code || 'old') === cemeteryMap &&
      (normalizeSectionName(section.properties?.name) === normalizedName || normalizeSectionName(section.properties?.legacy_source_name) === normalizedName)
    );
    if (saved) {
      setActivePlanningCemetery(cemeteryMap);
      openEditZoneModal(saved);
      return;
    }

    const newMapSource = newCemeteryGeoJson || (typeof anotherMapData === 'object' ? anotherMapData : null);
    const sourceFeatures = cemeteryMap === 'new' ? (newMapSource?.features || []) : siteData.features;
    const source = sourceFeatures.find(feature =>
      feature.geometry?.type === 'Polygon' &&
      normalizeSectionName(feature.properties?.name || `Section ${feature.properties?.id || ''}`).replace('Expansion Area ', 'Section ') === normalizedName
    );
    if (!source) {
      showToast('The selected existing section could not be loaded.', 'error');
      return;
    }

    const codePart = normalizedName.replace(/^Section\s+/i, '').replace(/[^A-Za-z0-9]+/g, '-').toUpperCase();
    const codePrefix = `${cemeteryMap === 'new' ? 'NEW' : 'OLD'}-${codePart}`;
    let availableCode = codePrefix;
    let codeSuffix = 2;
    const usedCodes = new Set(cemeterySections
      .filter(section => (section.properties?.cemetery_code || 'old') === cemeteryMap)
      .map(section => String(section.properties?.zone_code || '').trim().toUpperCase()));
    while (usedCodes.has(availableCode)) availableCode = `${codePrefix}-${codeSuffix++}`;
    const columns = cemeteryMap === 'new' ? 62 : 42;
    setActivePlanningCemetery(cemeteryMap);
    setEditingZone({
      id: null,
      isLegacy: true,
      originalName: normalizedName,
      legacySourceName: normalizedName,
      geometry: source.geometry,
      rows: 2,
      columns,
      floors: 4,
      orientation: 'horizontal',
      hasPlots: false,
      hasProtectedPlots: false,
      plotCount: 0,
      isQuadrilateral: source.geometry?.coordinates?.[0]?.slice(0, -1).length === 4,
    });
    setNewSectionGeometry(source.geometry);
    setNewSectionData({
      name: normalizedName,
      zone_code: availableCode,
      description: 'Existing cemetery section upgraded for CPDO management.',
      is_active: true,
      status: 'active',
      estimated_stack_height: 4,
      rows: 2,
      columns,
      orientation: 'horizontal',
    });
    setSectionFormError('');
    setIsNewSectionModalOpen(true);
  };

  useEffect(() => {
    const handleLegacyEdit = event => {
      openLegacyZoneModal(event.detail?.sectionName, event.detail?.cemeteryMap || 'old');
    };
    window.addEventListener('gravetrak_edit_legacy_section', handleLegacyEdit);
    return () => window.removeEventListener('gravetrak_edit_legacy_section', handleLegacyEdit);
  }, [cemeterySections, groundPlots, activePlanningCemetery]);

  const toggleZoneActive = async (feature) => {
    const props = feature.properties || {};
    try {
      await updateCemeterySection(feature.id || props.id, { is_active: props.is_active === false });
      const refreshed = await fetchCemeterySections();
      setCemeterySections(Array.isArray(refreshed?.features) ? refreshed.features : []);
      showToast(`Zone ${props.is_active === false ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      showToast(`Unable to update zone: ${err.message}`, 'error');
    }
  };

  const refreshActiveInventory = async () => {
    const [sections, plots, niches, summary] = await Promise.all([
      fetchCemeterySections(), fetchBurialPlots(), fetchColumbariums(), fetchBurialPlotSummary(),
    ]);
    setCemeterySections(sections.features || []);
    setGroundPlots(plots);
    const activeSlots = processSlots(niches);
    setColumbariumSlots(activeSlots);
    localStorage.setItem('gravetrak_columbarium', JSON.stringify(activeSlots));
    setGroundPlotSummary(summary);
    setPlotDataError(''); setCemeterySectionsError('');
  };

  const archiveZone = (feature) => {
    const props = feature.properties || {};
    const zoneId = feature.id || props.id;
    showConfirm(
      'Archive Section',
      `Archive "${props.name || props.zone_code || 'this section'}"? Its geometry and records will be preserved and it can be restored later.`,
      async () => {
        try {
          await updateCemeterySection(zoneId, { is_active: false });
          await refreshActiveInventory();
          if (plotSectionFilter === props.name) setPlotSectionFilter('all');
          showToast(`Zone "${props.name || props.zone_code}" archived successfully.`);
        } catch (err) {
          showToast(`Unable to archive zone: ${err.message}`, 'error');
        }
      },
      false
    );
  };

  const restoreArchivedPlanningSection = async (feature) => {
    const props = feature.properties || {};
    const zoneId = feature.id || props.id;
    try {
      await updateCemeterySection(zoneId, { is_active: true });
      await refreshActiveInventory();
      setArchivedPlanningSections(current => current.filter(item => (item.id || item.properties?.id) !== zoneId));
      showToast(`Section "${props.name || props.zone_code}" restored successfully.`);
    } catch (err) {
      showToast(`Unable to restore section: ${err.message}`, 'error');
    }
  };

  const permanentlyDeleteArchivedSection = (feature) => {
    const props = feature.properties || {};
    const zoneId = feature.id || props.id;
    showConfirm(
      'Permanently Delete Section',
      `Permanently delete "${props.name || props.zone_code}" and its unused grave layout? This cannot be undone. Sections with occupied or assigned graves will be protected.`,
      async () => {
        try {
          const result = await deleteCemeterySection(zoneId);
          await refreshActiveInventory();
          setArchivedPlanningSections(current => current.filter(item => (item.id || item.properties?.id) !== zoneId));
          setGroundPlots(current => current.filter(plot => plot.section_record !== zoneId));
          const cemeteryCode = props.cemetery_code || 'old';
          setColumbariumSlots(current => current.filter(slot => !(
            slot.cemeteryMap === cemeteryCode &&
            normalizeSectionName(slot.section) === normalizeSectionName(props.name)
          )));
          const deletedItems = [
            result?.deleted_graves ? `${result.deleted_graves} unused graves` : '',
            result?.deleted_niches ? `${result.deleted_niches} available apartment niches` : '',
          ].filter(Boolean);
          showToast(`${props.name || props.zone_code} permanently deleted${deletedItems.length ? ` with ${deletedItems.join(' and ')}` : ''}.`);
        } catch (err) {
          showToast(`Unable to permanently delete section: ${err.message}`, 'error');
        }
      }
    );
  };

  const openGraveLayoutModal = (feature) => {
    const props = feature.properties || {};
    const sectionId = feature.id || props.id;
    const existingPlots = groundPlots.filter(plot => String(plot.section_record) === String(sectionId));
    let rows = existingPlots.length ? 1 : 4, columns = existingPlots.length ? 1 : 8;
    existingPlots.forEach(plot => {
      const match = String(plot.location_description || '').match(/Row\s+(\d+),\s*Column\s+(\d+)/i);
      if (match) {
        rows = Math.max(rows, Number(match[1]));
        columns = Math.max(columns, Number(match[2]));
      }
    });
    setLayoutZone(feature);
    setGraveLayoutData({ rows, columns, floors: Number(props.estimated_stack_height || 1), orientation: props.layout_orientation || 'horizontal' });
    setIsGraveLayoutModalOpen(true);
  };

  const handleGenerateGraveLayout = async () => {
    if (!layoutZone || isGeneratingGraveLayout) return;
    const rows = Number(graveLayoutData.rows);
    const columns = Number(graveLayoutData.columns);
    const floors = Number(graveLayoutData.floors);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 50 || columns > 50) {
      showToast('Rows and columns must each be whole numbers between 1 and 50.', 'error');
      return;
    }
    if (rows * columns > 500) {
      showToast('A layout can contain at most 500 grave positions.', 'error');
      return;
    }
    if (!Number.isInteger(floors) || floors < 1 || floors > 10) {
      showToast('Floors per grave must be a whole number between 1 and 10.', 'error');
      return;
    }
    setIsGeneratingGraveLayout(true);
    try {
      const result = await generateBurialPlotLayout({
        section: layoutZone.id || layoutZone.properties?.id,
        rows,
        columns,
        floors,
        orientation: graveLayoutData.orientation,
        replace_existing: Number(layoutZone.properties?.total_plots || 0) > 0,
      });
      const [refreshedSections, refreshedPlots, refreshedSummary] = await Promise.all([
        fetchCemeterySections(),
        fetchBurialPlots(),
        fetchBurialPlotSummary(),
      ]);
      setCemeterySections(Array.isArray(refreshedSections?.features) ? refreshedSections.features : []);
      setGroundPlots(Array.isArray(refreshedPlots) ? refreshedPlots : []);
      setGroundPlotSummary(refreshedSummary || { total: 0, available: 0, occupied: 0, maintenance: 0, sections: [] });
      setIsGraveLayoutModalOpen(false);
      setLayoutZone(null);
      showToast(`${result.graves_created} graves ${Number(layoutZone.properties?.total_plots || 0) > 0 ? 'updated' : 'created'} with ${result.floors_per_grave} floor${result.floors_per_grave === 1 ? '' : 's'} each.`);
    } catch (err) {
      showToast(`Unable to generate grave layout: ${err.message}`, 'error');
    } finally {
      setIsGeneratingGraveLayout(false);
    }
  };

  const handleCancelDrawing = () => {
    setManualAssignMI('');
    setManualAssignSuffix('');
    setManualAssignDOB('');
    setManualAssignDOD('');
  };

  const handleSaveSlotName = async () => {
    if (!editSlotName.trim()) {
      showToast("Name cannot be empty.", "error");
      return;
    }
    try { await updateColumbarium(selectedSlotDetails.id, { name: editSlotName.trim() }); } catch(e) {}
    setColumbariumSlots(current => current.map(s => 
          s.id === selectedSlotDetails.id ? { ...s, name: editSlotName.trim() } : s
    ));
    setSelectedSlotDetails(prev => ({ ...prev, name: editSlotName.trim() }));
    setIsEditingSlotName(false);
  };

  const handleEditGrave = (grave) => {
    setEditingGraveId(grave.id);
    console.log('Editing grave:', grave.grave_id);
    showToast(`Edit grave: ${grave.grave_id} - Updating functionality...`, 'info');
  };

  const handleViewGrave = (grave) => {
    setViewingGrave(grave);
    console.log('Viewing grave:', grave);
    showToast(`Viewing grave: ${grave.grave_id} - ${grave.name}`, 'info');
  };

  const handleAssignGrave = (grave) => {
    setAssigningGraveId(grave.id);
    console.log('Assigning grave:', grave.grave_id);
    showToast(`Plot ${grave.grave_id} is now ready for assignment.`, 'info');
  };

  const handleApproveApplication = async (id) => {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    try {
      const res = await fetch(`${API_BASE}/burial-applications/${id}/approve/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` },
        body: JSON.stringify({ reason: '' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || 'Unable to update application.');
      }
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    const appToApprove = pendingApps.find((a) => a.id === id);
    if (appToApprove) {
      setApprovedApps((current) => [{ ...appToApprove, status: 'approved', status_display: 'Approved' }, ...current]);
    }

    const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
    statuses[String(id)] = 'approved';
    localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));

    setPendingApps((current) => current.filter((app) => app.id !== id));
    showToast(`Application ${id} approved successfully.`);
  };

  const handleDisapproveApplication = async (id) => {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    try {
      const res = await fetch(`${API_BASE}/burial-applications/${id}/reject/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` },
        body: JSON.stringify({ reason: '' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || 'Unable to update application.');
      }
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    
    setPendingApps((current) => current.filter((app) => app.id !== id));

    const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
    statuses[String(id)] = 'rejected';
    localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));

    showToast(`Application ${id} rejected.`, 'info');
  };

  const handleOpenInterviewModal = (app) => {
    setSelectedAppForInterview(app);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = app.interview_date || tomorrow.toISOString().split('T')[0];
    setInterviewDetails({ date: defaultDate, time: app.interview_time || '', duration_minutes: 5, location: app.interview_location || app.interview_info?.location || "Mayor's Office", notes: app.interview_info?.notes || 'Please bring original copies of all uploaded documents.' });
    setAppointmentSlots([]);
    setAppointmentSlotError('');
    setIsInterviewModalOpen(true);
  };

  const submitInterviewSchedule = async () => {
    if (!interviewDetails.date || !interviewDetails.time) {
      showToast('Please select a date and time for the five-minute appointment.', 'error');
      return;
    }

    const id = selectedAppForInterview.id;
    const isReschedulingFromApproved = scheduledApps.some(app => app.id === id);
    const hasActiveAppointment = Boolean(
      selectedAppForInterview.interview_info?.id &&
      selectedAppForInterview.interview_info?.status !== 'cancelled'
    );
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    let scheduleResult;
    try {
      const payload = {
          scheduled_date: interviewDetails.date,
          scheduled_time: interviewDetails.time,
          duration_minutes: 5,
          location: interviewDetails.location,
          notes: interviewDetails.notes,
      };
      if (hasActiveAppointment) {
        const appointmentId = selectedAppForInterview.interview_info?.id;
        if (!appointmentId) throw new Error('Existing appointment record was not found. Refresh and try again.');
        const result = await rescheduleAppointment(appointmentId, payload);
        scheduleResult = { status: 'for_interview', schedule_id: result.appointment.id };
      } else {
        const res = await fetch(`${API_BASE}/burial-applications/${id}/schedule-interview/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || errData.error || 'Unable to save the interview schedule.');
        }
        scheduleResult = await res.json();
      }
    } catch (err) {
      showToast(`Scheduling failed: ${err.message}`, 'error');
      return;
    }

    const appToSchedule = pendingApps.find((a) => a.id === id) || approvedApps.find((a) => a.id === id) || scheduledApps.find((a) => a.id === id);
    if (appToSchedule) {
      const scheduledApp = {
        ...appToSchedule, 
        status: isReschedulingFromApproved ? 'documents_complete' : (scheduleResult?.status || 'for_interview'),
        status_display: isReschedulingFromApproved ? 'Rescheduled — Awaiting Confirmation' : 'Interview Scheduled',
        interview_date: interviewDetails.date,
        interview_time: interviewDetails.time,
        interview_location: interviewDetails.location,
        interview_info: { ...(appToSchedule.interview_info || {}), id: scheduleResult.schedule_id, scheduled_date: interviewDetails.date, scheduled_time: interviewDetails.time, duration_minutes: 5, location: interviewDetails.location, status: 'scheduled' }
      };
      if (isReschedulingFromApproved) {
        setApprovedApps(current => [scheduledApp, ...current.filter(app => app.id !== id)]);
        setScheduledApps(current => current.filter(app => app.id !== id));
      } else {
        setScheduledApps((current) => [scheduledApp, ...current.filter(app => app.id !== id)]);
        setApprovedApps((current) => current.filter((app) => app.id !== id));
      }
    }
    setPendingApps((current) => current.filter((app) => app.id !== id));

    const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
    statuses[String(id)] = isReschedulingFromApproved ? 'documents_complete' : 'for_interview';
    localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));

    const interviews = JSON.parse(localStorage.getItem('gravetrak_demo_interviews') || '{}');
    interviews[String(id)] = {
      date: interviewDetails.date,
      time: interviewDetails.time,
      location: interviewDetails.location
    };
    localStorage.setItem('gravetrak_demo_interviews', JSON.stringify(interviews));

    showToast(`Interview saved for ${interviewDetails.date}. In-app notification recorded for the linked applicant. External SMS delivery is not configured.`);
    setAppTab(isReschedulingFromApproved ? 'approved' : 'scheduled');
    setIsInterviewModalOpen(false);
    setSelectedAppForInterview(null);
  };

  const handleCancelInterview = (app) => {
    const appointmentId = app.interview_info?.id;
    if (!appointmentId) return showToast('Appointment record was not found. Refresh and try again.', 'error');
    showConfirm('Cancel Appointment', 'Cancel this appointment and return the application to the scheduling queue?', async () => {
      try {
        await cancelAppointment(appointmentId, 'Cancelled by CMO administrator.');
        const returnedApp = { ...app, status: 'documents_complete', status_display: 'Appointment Cancelled — Ready to Reschedule', interview_info: { ...app.interview_info, status: 'cancelled' } };
        setScheduledApps(current => current.filter(item => item.id !== app.id));
        setApprovedApps(current => [returnedApp, ...current.filter(item => item.id !== app.id)]);
        const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
        statuses[String(app.id)] = 'documents_complete';
        localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));
        setAppTab('approved');
        showToast('Appointment cancelled. Its slot is available again.', 'success');
      } catch (err) { showToast(`Cancellation failed: ${err.message}`, 'error'); }
    }, false);
  };

  const handleAutoAssignClick = async (app, cemeteryMap = 'old') => {
    let slotToAssign = null;
    let ruleDesc = '';
    let type = '';

    const availablePlots = graveData.filter(g => g.status === 'available' && (g.cemeteryMap === cemeteryMap || (cemeteryMap === 'old' && !g.cemeteryMap)));
    let freshSlots;
    try {
      freshSlots = processSlots(await fetchColumbariums());
      setColumbariumSlots(freshSlots);
    } catch (error) {
      showToast(`Unable to check current slot availability: ${error.message}`, 'error');
      return;
    }
    const availableColumbarium = availableNichesInAssignmentOrder(freshSlots, cemeteryMap);

    if (availableColumbarium.length > 0) {
      type = 'columbarium';
      slotToAssign = availableColumbarium[0];
      ruleDesc = `Fill available Floor 1 slots across ${cemeteryMap === 'old' ? 'Old' : 'New'} Cemetery before moving to Floor 2, then Floor 3 and onward.\nWithin each floor, start with Section A, then B, C and the remaining sections; custom sections follow the lettered sections. Use the lowest available column first.\n\nNext slot: ${slotToAssign.section}, Floor ${slotToAssign.floor}, Column ${slotToAssign.col}.`;
    } else if (availablePlots.length > 0) {
      type = 'grave';
      slotToAssign = availablePlots[0];
      ruleDesc = `Rule #1: Scan for available plots in ${cemeteryMap === 'old' ? 'Old' : 'New'} Cemetery (status = 'available').\nRule #2: Select the first available plot sequentially.\n\nResult: The system automatically located Grave Plot ${slotToAssign.grave_id} at ${slotToAssign.location}.`;
    } else {
      showToast(`Error: No available grave plots or columbarium slots found in ${cemeteryMap === 'old' ? 'Old' : 'New'} Cemetery.`, 'error');
      return;
    }

    setAssignConfirmData({ app, type, slotToAssign, ruleDesc, cemeteryMap });
    setIsAssignConfirmOpen(true);
  };

  const executeAutoAssign = async () => {
    if (!assignConfirmData) return;
    const { app, type, slotToAssign } = assignConfirmData;
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    try {
      if (type === 'columbarium') {
        const freshSlots = processSlots(await fetchColumbariums());
        setColumbariumSlots(freshSlots);
        const next = availableNichesInAssignmentOrder(freshSlots, assignConfirmData.cemeteryMap)[0];
        if (!next || String(next.id) !== String(slotToAssign.id)) {
          throw new Error('Slot availability changed. Click Assign again to review the next available slot.');
        }
      }
      const response = await fetch(API_BASE + '/burial-applications/' + app.id + '/approve-and-assign/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Token ' + token },
        body: JSON.stringify({ type, target_id: slotToAssign.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || (Array.isArray(result) ? result.join(' ') : 'Approval and assignment could not be saved.'));
      const savedApp = result.application;
      const savedLocation = result.location;
      if (type === 'columbarium') {
        setColumbariumSlots(current => current.map(s => s.id === savedLocation.id ? processSlots([savedLocation])[0] : s));
        setActiveColumbariumMap(savedLocation.cemetery_map);
        setColumbariumSection(savedLocation.section);
        setSelectedPanel('panel-columbarium');
      } else {
        setGraveData(current => current.map(g => g.id === savedLocation.id ? savedLocation : g));
      }
      setPendingApps(current => current.filter(a => String(a.id) !== String(app.id)));
      setApprovedApps(current => current.filter(a => String(a.id) !== String(app.id)));
      setScheduledApps(current => current.filter(a => String(a.id) !== String(app.id)));
      setAssignedApps(current => [savedApp, ...current.filter(a => String(a.id) !== String(app.id))]);
      setCompletedApps(current => [savedApp, ...current.filter(a => String(a.id) !== String(app.id))]);
      setAllBurialApplications(current => current.map(a => String(a.id) === String(app.id) ? savedApp : a));
      // Retire only this application's stale browser override after a confirmed save.
      try {
        const localStatuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
        delete localStatuses[String(app.id)];
        localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(localStatuses));
        const localAssigned = JSON.parse(localStorage.getItem('gravetrak_assigned_apps') || '[]');
        localStorage.setItem('gravetrak_assigned_apps', JSON.stringify(localAssigned.filter(id => String(id) !== String(app.id))));
      } catch {
        // Browser cache cleanup must not report a successful backend save as a failure.
      }
      showToast('Final approval and location assignment saved. Reports will include this approval.', 'success');
    } catch (err) {
      showToast(err.message || 'Approval and assignment could not be saved.', 'error');
    } finally {
      setIsAssignConfirmOpen(false);
      setAssignConfirmData(null);
    }
  };

  const handleViewDocuments = async (app) => {
    try {
      const fullApp = await fetchBurialApplication(app.id);
      setSelectedAppForDocs(fullApp);
      setDocVerification(Object.fromEntries((fullApp.documents || []).map(doc => [doc.document_type_display, doc.verification_status])));
      setDocRejectReasons(Object.fromEntries((fullApp.documents || []).map(doc => [doc.document_type_display, doc.verification_note || ''])));
      setRejectReason('');
      setIsDocumentsModalOpen(true);
    } catch (err) {
      showToast(`Failed to load documents: ${err.message}`, 'error');
    }
  };

  const handleDocumentReview = async (doc, verificationStatus) => {
    const remarks = docRejectReasons[doc.document_type_display] || '';
    try {
      await reviewBurialDocument(doc.id, verificationStatus, remarks);
      const refreshed = await fetchBurialApplication(selectedAppForDocs.id);
      setSelectedAppForDocs(refreshed);
      setDocVerification(prev => ({ ...prev, [doc.document_type_display]: verificationStatus }));
      showToast(verificationStatus === 'complete' ? 'Document marked complete.' : 'Document marked Needs Correction. Finalize the review to notify the applicant.', 'success');
    } catch (err) {
      showToast(`Document review failed: ${err.message}`, 'error');
    }
  };

  const handleCompleteDocumentReview = async () => {
    if (!selectedAppForDocs?.document_completeness?.ready_for_further_processing && !selectedAppForDocs?.document_completeness?.needs_correction_count) {
      showToast('All required documents must be complete first.', 'error');
      return;
    }

    try {
      const result = await completeDocumentReview(selectedAppForDocs.id);
      if (result.status === 'action_required') {
        setPendingApps(current => current.map(app => app.id === selectedAppForDocs.id ? { ...app, status: result.status } : app));
        setIsDocumentsModalOpen(false);
        setSelectedAppForDocs(null);
        showToast(result.detail, 'success');
        return;
      }
      const readyApp = {
        ...selectedAppForDocs,
        status: result.status || 'documents_complete',
        status_display: result.status_display || 'Documents Complete — Ready for Scheduling',
      };
      setPendingApps(current => current.filter(app => app.id !== readyApp.id));
      setApprovedApps(current => [readyApp, ...current.filter(app => app.id !== readyApp.id)]);
      const demoStatuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
      demoStatuses[String(readyApp.id)] = 'documents_complete';
      localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(demoStatuses));
      setIsDocumentsModalOpen(false);
      setSelectedAppForDocs(null);
      handleOpenInterviewModal(readyApp);
      showToast('Document review completed. Please set the interview schedule.', 'success');
    } catch (err) {
      showToast(`Unable to finish document review: ${err.message}`, 'error');
    }
  };

  const handleOpenNotifyModal = async (app) => {
    setSelectedAppForNotify(app);
    setNotifyMessage('');
    notifyKey.current = crypto.randomUUID();
    setNotifyRecipient('Loading recipient…');
    setIsNotifyModalOpen(true);
    try {
      const result = await fetchNotificationRecipient(app.id);
      setNotifyRecipient(result.recipient);
    } catch (error) {
      setNotifyRecipient('Recipient unavailable');
      showToast(error.message, 'error');
    }
  };

  const handleSendNotification = async () => {
    if (notifyBusy || !selectedAppForNotify || !notifyMessage.trim() || notifyMessage.trim().length > 1000) return;
    setNotifyBusy(true);
    try {
      const result = await notifyApplicationIssue(selectedAppForNotify.id, notifyMessage, notifyKey.current);
      showToast(result.detail + (result.sms_status === 'invalid_recipient' ? ' Applicant mobile number is missing or invalid.' : ''), 'success');
      setIsNotifyModalOpen(false);
      setSelectedAppForNotify(null);
      setNotifyMessage('');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setNotifyBusy(false);
    }
  };

  const handleExportMasterCSV = () => {
    let csvString = '';
    const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

    csvString += '--- COLUMBARIUM RECORDS ---\n';
    csvString += ['Slot ID', 'Section', 'Floor', 'Column', 'Status', 'Occupant Name'].join(',') + '\n';
    columbariumSlots.forEach(slot => {
      csvString += [escapeCsv(slot.id), escapeCsv(slot.section), escapeCsv(slot.floor), escapeCsv(slot.col), escapeCsv(slot.status), escapeCsv(slot.name)].join(',') + '\n';
    });
    csvString += '\n\n';

    csvString += '--- GRAVE RECORDS ---\n';
    csvString += ['Grave ID', 'Name', 'Location', 'Dates', 'Status'].join(',') + '\n';
    graveData.forEach(grave => {
      csvString += [escapeCsv(grave.grave_id), escapeCsv(grave.name), escapeCsv(grave.location), escapeCsv(grave.dates), escapeCsv(grave.status)].join(',') + '\n';
    });
    csvString += '\n\n';

    csvString += '--- BURIAL APPLICATIONS ---\n';
    csvString += ['Application ID', 'Applicant', 'Deceased', 'Date Submitted', 'Status'].join(',') + '\n';
    const allApps = [...pendingApps, ...approvedApps, ...scheduledApps, ...assignedApps, ...cancelledApps];
    allApps.forEach(app => {
      csvString += [escapeCsv(app.application_id), escapeCsv(app.applicant_name), escapeCsv(app.deceased_name), escapeCsv(new Date(app.created_at).toLocaleDateString()), escapeCsv(app.status_display)].join(',') + '\n';
    });
    csvString += '\n\n';

    csvString += '--- SYSTEM REPORTS ---\n';
    csvString += ['Report ID', 'Date', 'Author', 'Title', 'Status', 'Content'].join(',') + '\n';
    reports.forEach(report => {
      csvString += [escapeCsv(report.id), escapeCsv(report.date), escapeCsv(report.author), escapeCsv(report.title), escapeCsv(report.status), escapeCsv(report.content)].join(',') + '\n';
    });
    csvString += '\n\n';

    csvString += '--- ARCHIVED COLUMBARIUM RECORDS ---\n';
    if (clearedRecords.length === 0) {
      csvString += 'No archived columbarium records.\n';
    } else {
      csvString += ['Archive Date', 'Slot ID', 'Occupant Name', 'Transfer Note'].join(',') + '\n';
      clearedRecords.forEach(rec => {
        csvString += [escapeCsv(new Date(rec.id).toLocaleString()), escapeCsv(rec.slotId), escapeCsv(rec.name), escapeCsv(rec.note)].join(',') + '\n';
      });
    }
    csvString += '\n\n';

    csvString += '--- ARCHIVED REPORTS ---\n';
    if (archivedReports.length === 0) {
      csvString += 'No archived reports.\n';
    } else {
      csvString += ['Report ID', 'Date', 'Author', 'Title', 'Status', 'Content'].join(',') + '\n';
      archivedReports.forEach(report => {
        csvString += [escapeCsv(report.id), escapeCsv(report.date), escapeCsv(report.author), escapeCsv(report.title), escapeCsv('archived'), escapeCsv(report.content)].join(',') + '\n';
      });
    }
    csvString += '\n\n';

    csvString += '--- AUDIT LOGS ---\n';
    const logsToExport = auditLogs.length > 0 ? auditLogs : JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
    if (logsToExport.length === 0) {
      csvString += 'No logs available.\n';
    } else {
      csvString += ['Date & Time', 'User', 'Action', 'Details'].join(',') + '\n';
      logsToExport.forEach(log => {
        csvString += [escapeCsv(log.date), escapeCsv(log.user), escapeCsv(log.action), escapeCsv(log.details)].join(',') + '\n';
      });
    }

    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `GraveTrak_Master_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
    const newLogs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
    newLogs.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      user: userName,
      action: 'Exported Master Data',
      details: 'Exported a combined CSV file of all system records (Graves, Columbarium, Apps, Reports, Logs).'
    });
    localStorage.setItem('gravetrak_audit_logs', JSON.stringify(newLogs));
    setAuditLogs(newLogs);

    showToast('Master system data exported successfully as CSV.');
  };

  // These overview panels use the full slot total across both cemeteries.
  const nicheOverview = useMemo(() => {
    const result = { available: 0, byCemetery: new Map() };
    for (const slot of columbariumSlots) {
      if (!result.byCemetery.has(slot.cemeteryMap)) result.byCemetery.set(slot.cemeteryMap, { total: 0, occupied: 0, available: 0 });
      const counts = result.byCemetery.get(slot.cemeteryMap);
      counts.total++;
      if (slot.status === 'occupied') counts.occupied++;
      if (slot.status === 'available') { counts.available++; result.available++; }
    }
    return result;
  }, [columbariumSlots]);
  const availableCountCol = nicheOverview.available;
  const { total: colTotalSlots, occupied: colTotalOccupied, available: colTotalAvailable } =
    nicheOverview.byCemetery.get(activeAdminCemetery) || { total: 0, occupied: 0, available: 0 };
  const colOccupancyPct = colTotalSlots > 0 ? Math.round((colTotalOccupied / colTotalSlots) * 100) : 0;

  const mayorPendingApps = useMemo(
    () => pendingApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [pendingApps, activeMayorCemetery]
  );
  const processedMayorApps = useMemo(
    () => [...approvedApps, ...scheduledApps, ...assignedApps],
    [approvedApps, scheduledApps, assignedApps]
  );
  const mayorApprovedApps = useMemo(
    () => approvedApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [approvedApps, activeMayorCemetery]
  );
  const mayorScheduledApps = useMemo(
    () => scheduledApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [scheduledApps, activeMayorCemetery]
  );
  const mayorAssignedApps = useMemo(
    () => assignedApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [assignedApps, activeMayorCemetery]
  );
  const mayorCompletedApps = useMemo(
    () => completedApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [completedApps, activeMayorCemetery]
  );
  const mayorCancelledApps = useMemo(
    () => cancelledApps.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery)),
    [cancelledApps, activeMayorCemetery]
  );
  const mayorApplications = useMemo(
    () => [...mayorPendingApps, ...mayorApprovedApps, ...mayorScheduledApps, ...mayorAssignedApps, ...mayorCompletedApps, ...mayorCancelledApps],
    [mayorPendingApps, mayorApprovedApps, mayorScheduledApps, mayorAssignedApps, mayorCompletedApps, mayorCancelledApps]
  );
  const mayorProcessingMetrics = useMemo(() => {
    const records = allBurialApplications.filter(app => belongsToCemeteryOrIsUnassigned(app, activeMayorCemetery));
    const getFastest = (endField) => records
      .map(app => {
        const elapsedMs = getElapsedMilliseconds(app.submitted_at || app.created_at, app[endField]);
        return elapsedMs === null ? null : { app, elapsedMs, completedAt: app[endField] };
      })
      .filter(Boolean)
      .sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || null;
    const approvedRecords = records.filter(app => app.approved_at);
    const completedRecords = records.filter(app => app.completed_at);
    return {
      averageApproval: getAverageApprovalTiming(records),
      fastestApproval: getFastest('approved_at'),
      fastestBurial: getFastest('completed_at'),
      approvedWithinTarget: approvedRecords.filter(app => {
        const elapsed = getElapsedMilliseconds(app.submitted_at || app.created_at, app.approved_at);
        return elapsed !== null && elapsed <= FAST_PROCESSING_TARGET_MS;
      }).length,
      completedWithinTarget: completedRecords.filter(app => {
        const elapsed = getElapsedMilliseconds(app.submitted_at || app.created_at, app.completed_at);
        return elapsed !== null && elapsed <= FAST_PROCESSING_TARGET_MS;
      }).length,
      totalApproved: approvedRecords.length,
      totalCompleted: completedRecords.length,
    };
  }, [allBurialApplications, activeMayorCemetery]);
  const mayorInventoryAnalytics = useMemo(() => {
    const counts = {
      old: { total: 0, occupied: 0, available: 0, nicheTotal: 0, nicheOccupied: 0, nicheAvailable: 0 },
      new: { total: 0, occupied: 0, available: 0, nicheTotal: 0, nicheOccupied: 0, nicheAvailable: 0 },
    };
    const addRecords = (records, isNiche = false) => {
      records.forEach(item => {
        const cemetery = getRecordCemetery(item) || 'old';
        const count = counts[cemetery];
        if (!count) return;
        const status = String(item.status || 'available').toLowerCase();
        count.total += 1;
        if (['occupied', 'reserved', 'assigned'].includes(status)) count.occupied += 1;
        if (status === 'available') count.available += 1;
        if (isNiche) {
          count.nicheTotal += 1;
          if (status === 'occupied') count.nicheOccupied += 1;
          if (status === 'available') count.nicheAvailable += 1;
        }
      });
    };
    addRecords(graveData);
    addRecords(groundPlots);
    addRecords(columbariumSlots, true);
    return {
      counts,
      capacity: ['old', 'new'].map(cemetery => {
        const count = counts[cemetery];
        return {
          cemetery,
          total: count.total,
          occupied: count.occupied,
          available: count.available,
          rate: count.total > 0 ? Math.round((count.occupied / count.total) * 100) : 0,
        };
      }),
    };
  }, [graveData, groundPlots, columbariumSlots]);
  const cemeteryCapacity = mayorInventoryAnalytics.capacity;
  const overallCapacity = cemeteryCapacity.find(row => row.cemetery === activeMayorCemetery)
    || { total: 0, occupied: 0, available: 0, rate: 0 };
  const overallOccupancyRate = overallCapacity.total > 0 ? Math.round((overallCapacity.occupied / overallCapacity.total) * 100) : 0;

  const mayorStatusDistribution = useMemo(() => [
    { label: 'In Review', value: mayorPendingApps.filter(app => ['pending_review', 'pending', 'review'].includes(String(app.status).toLowerCase())).length, color: 'var(--amber)' },
    { label: 'Needs Action', value: mayorPendingApps.filter(app => String(app.status).toLowerCase() === 'action_required').length, color: 'var(--red)' },
    { label: 'Ready / Approved', value: mayorApprovedApps.length, color: 'var(--accent)' },
    { label: 'Scheduled', value: mayorScheduledApps.length, color: 'var(--violet)' },
    { label: 'Assigned', value: mayorAssignedApps.length, color: 'var(--emerald)' },
    { label: 'Burial Completed', value: mayorCompletedApps.length, color: 'var(--accent)' },
    { label: 'Closed', value: mayorCancelledApps.length, color: 'var(--text-muted)' },
  ], [mayorPendingApps, mayorApprovedApps, mayorScheduledApps, mayorAssignedApps, mayorCompletedApps, mayorCancelledApps]);
  const mayorApplicationTotal = mayorStatusDistribution.reduce((sum, item) => sum + item.value, 0);
  const mayorStatusGradient = mayorApplicationTotal > 0 ? mayorStatusDistribution.reduce((gradient, item, index) => {
    const start = mayorStatusDistribution.slice(0, index).reduce((sum, entry) => sum + entry.value, 0) / mayorApplicationTotal * 100;
    const end = start + item.value / mayorApplicationTotal * 100;
    return `${gradient}${item.color} ${start}% ${end}%${index < mayorStatusDistribution.length - 1 ? ', ' : ''}`;
  }, '') : 'var(--border) 0% 100%';

  const pendingAging = useMemo(() => {
    const aging = [
    { label: '0–3 days', min: 0, max: 3, value: 0, color: 'var(--emerald)' },
    { label: '4–7 days', min: 4, max: 7, value: 0, color: 'var(--accent)' },
    { label: '8–14 days', min: 8, max: 14, value: 0, color: 'var(--amber)' },
    { label: '15+ days', min: 15, max: Infinity, value: 0, color: 'var(--red)' },
    ];
    mayorPendingApps.forEach(app => {
      const submitted = new Date(app.created_at || app.submitted_at || app.updated_at);
      if (Number.isNaN(submitted.getTime())) return;
      const days = Math.max(0, Math.floor((Date.now() - submitted.getTime()) / 86400000));
      const bucket = aging.find(item => days >= item.min && days <= item.max);
      if (bucket) bucket.value += 1;
    });
    return aging;
  }, [mayorPendingApps]);
  const pendingAgingMax = Math.max(1, ...pendingAging.map(item => item.value));

  const loadReportAnalytics = useCallback(async (filter = appliedReportFilter) => {
    setReportAnalyticsLoading(true);
    setReportAnalyticsError('');
    try {
      setReportAnalytics(await fetchReportAnalytics(filter));
    } catch (err) {
      setReportAnalyticsError(err.message || 'Unable to load report data.');
    } finally {
      setReportAnalyticsLoading(false);
    }
  }, [appliedReportFilter]);

  useEffect(() => {
    if (selectedPanel === 'panel-reports' && (role === 'mayor' || role === 'admin' || role === 'staff')) {
      loadReportAnalytics();
    }
  }, [selectedPanel, role, loadReportAnalytics]);

  const reportReady = isReportReady(reportAnalytics, { from: reportFrom, to: reportTo, loading: reportAnalyticsLoading, error: reportAnalyticsError });

  const applyReportPeriod = () => {
    if (!reportFrom && !reportTo) {
      setAppliedReportFilter({ period: 'overall' });
      return;
    }
    if (!reportFrom || !reportTo) return showToast('Select both From and To dates, or leave both empty for Overall.', 'error');
    if (reportFrom > reportTo) return showToast('Start date cannot be later than end date.', 'error');
    if (reportFrom > localReportDate() || reportTo > localReportDate()) return showToast('Report dates cannot be in the future.', 'error');
    setAppliedReportFilter({ period: 'custom', from: reportFrom, to: reportTo });
  };

  const formatReportDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const activeReportPeriodLabel = reportAnalytics?.period === 'overall'
    ? 'Overall records'
    : reportAnalytics
    ? `${formatReportDate(reportAnalytics.from)} – ${formatReportDate(reportAnalytics.to)}`
    : 'Loading reporting period…';
  const reportActivityChartItems = reportAnalytics ? (role === 'mayor' ? [
    { label: 'Submitted', value: reportAnalytics.metrics.applications_submitted, color: 'var(--accent)' },
    { label: 'Approved', value: reportAnalytics.metrics.applications_approved, color: 'var(--emerald)' },
    { label: 'Documents Verified', value: reportAnalytics.metrics.documents_verified, color: 'var(--violet)' },
    { label: 'Appointments', value: reportAnalytics.metrics.appointments_scheduled, color: 'var(--amber)' },
  ] : [
    { label: 'Burials', value: reportAnalytics.metrics.burials, color: 'var(--accent)' },
    { label: 'Appointments', value: reportAnalytics.metrics.appointments_scheduled, color: 'var(--amber)' },
    { label: 'Applications', value: reportAnalytics.metrics.applications_submitted, color: 'var(--violet)' },
  ]) : [];
  const reportActivityMax = Math.max(1, ...reportActivityChartItems.map(item => item.value));
  const reportInventory = reportAnalytics?.current_snapshot;
  const reportInventoryOccupied = reportInventory
    ? reportInventory.occupied_graves + reportInventory.occupied_plots + reportInventory.occupied_columbarium_slots
    : 0;
  const reportInventoryAvailable = reportInventory
    ? reportInventory.available_graves + reportInventory.available_plots + reportInventory.available_columbarium_slots
    : 0;
  const reportInventoryTotal = reportInventoryOccupied + reportInventoryAvailable;
  const reportOccupancyPercent = reportInventoryTotal ? Math.round((reportInventoryOccupied / reportInventoryTotal) * 100) : 0;
  const funeralHomeBreakdown = reportAnalytics?.funeral_home_breakdown || [];
  const funeralHomeMax = Math.max(1, ...funeralHomeBreakdown.map(item => item.count));

  const exportSelectedReport = async () => {
    if (!reportAnalytics || reportExporting) return;
    setReportExporting(true);
    try { await downloadReportWorkbook(reportAnalytics, role); }
    catch (error) { showToast('Unable to export the Excel report. Please try again.', 'error'); console.error(error); }
    finally { setReportExporting(false); }
  };

  const mayorStatCards = [
    { label: 'Total Applications', value: mayorApplications.length.toString(), note: 'For this cemetery and unassigned applications', accent: 'var(--accent)' },
    { label: 'Pending Reviews', value: mayorPendingApps.length.toString(), note: 'Awaiting your approval', accent: 'var(--amber)' },
    { label: 'Average Approval Time', value: formatElapsedDuration(mayorProcessingMetrics.averageApproval.averageMs), note: mayorProcessingMetrics.averageApproval.count ? `Submission to approval · ${mayorProcessingMetrics.averageApproval.count} timed application${mayorProcessingMetrics.averageApproval.count === 1 ? '' : 's'}` : 'No valid approval timing recorded yet', accent: 'var(--violet)' },
    { label: 'Available Capacity', value: overallCapacity.available.toLocaleString(), note: 'Ground plots and niches', accent: 'var(--emerald)' },
    { label: 'Cemetery Occupancy', value: `${overallOccupancyRate}%`, note: `Based on ${overallCapacity.total.toLocaleString()} inventory records`, accent: overallOccupancyRate >= 85 ? 'var(--red)' : 'var(--accent)' },
  ];

  // Robust date extractor supporting ranges and multiple formats
  const extractDate = (str) => {
    if (!str) return null;
    const s = String(str).trim();

    // ISO date YYYY-MM-DD
    const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];

    // MM/DD/YYYY or M/D/YYYY
    const mmdd = s.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (mmdd) {
      const [mm, dd, yyyy] = mmdd[1].split('/');
      return `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    // Range like '1945–2021' or '1945-2021' -> take end year
    const range = s.match(/(\d{4})\s*[–—-]\s*(\d{4})/);
    if (range) return `${range[2]}-01-01`;

    // Single year 'YYYY' -> Jan 1 of that year
    const year = s.match(/\b(19|20)\d{2}\b/);
    if (year) return `${year[0]}-01-01`;

    // Last resort: try native Date parsing and return YYYY-MM-DD
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  };

  // Analytics engine: aggregates approved applications
  const generateMayorLiveAnalytics = useCallback(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const monthlyCounts = new Array(12).fill(0);

    const safeAdd = (dateLike) => {
      if (!dateLike) return;
      const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
      if (!isNaN(d.getTime()) && d.getFullYear() === currentYear) {
        monthlyCounts[d.getMonth()] += 1;
      }
    };

    // Only count approved/scheduled/assigned applications
    processedMayorApps.forEach(app => {
      if (!app) return;
      const dstr = app.created_at || app.date || null;
      if (dstr) safeAdd(dstr);
    });

    const thisMonthIndex = now.getMonth();
    const thisMonthVal = monthlyCounts[thisMonthIndex] || 0;
    const compareIndex = (typeof compareMonthIndex === 'number') ? compareMonthIndex : (thisMonthIndex === 0 ? 11 : thisMonthIndex - 1);
    const compareMonthVal = monthlyCounts[compareIndex] || 0;

    let pctChange = null;
    if (compareMonthVal === 0) {
      pctChange = thisMonthVal === 0 ? 0 : null; // null indicates no baseline for percent
    } else {
      pctChange = Math.round(((thisMonthVal - compareMonthVal) / compareMonthVal) * 100);
    }

    const totalPlots = graveDataRef.current.filter(item => (getRecordCemetery(item) || 'old') === activeMayorCemetery).length
      + columbariumSlotsRef.current.filter(item => (getRecordCemetery(item) || 'old') === activeMayorCemetery).length;
    const occupiedPlots = graveDataRef.current.filter(g => (getRecordCemetery(g) || 'old') === activeMayorCemetery && g.status === 'occupied').length
      + columbariumSlotsRef.current.filter(s => (getRecordCemetery(s) || 'old') === activeMayorCemetery && s.status === 'occupied').length;
    const occupancyPct = totalPlots > 0 ? Math.round((occupiedPlots / totalPlots) * 100) : 0;

    const insights = []; // This will be an array of strings
    if (occupancyPct > 85) insights.push('Critical Capacity');
    if (compareMonthVal > 0 && thisMonthVal > compareMonthVal * 1.2) insights.push('Mortality Spike Detected');

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const result = {
      generated_at: new Date().toISOString(),
      totalPlots,
      occupiedPlots,
      occupancyPct,
      thisMonthIndex,
      thisMonthVal,
      compareIndex,
      compareMonthVal,
      pctChange,
      insights,
      monthlyCounts,
      mayorTrend: monthLabels.map((month, index) => ({ month, value: monthlyCounts[index] })),
      maxBurials: Math.max(...monthlyCounts, 5), // Ensure max is at least 5
    };

    setLiveAnalyticsData(result);
    console.debug('Mayor Live Analytics:', result);
    return result;
  }, [processedMayorApps, mayorPendingApps, graveData, columbariumSlots, compareMonthIndex, activeMayorCemetery]);

  // Initial load for Mayor's Dashboard
  useEffect(() => {
    if (role === 'mayor' && selectedPanel === 'panel-mayor-dash') {
      generateMayorLiveAnalytics();
    }
  }, [role, selectedPanel, generateMayorLiveAnalytics]);

  // Re-run analytics when compare month or panel changes
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // For display

  // Derived from liveAnalyticsData for the chart
  const mayorTrend = liveAnalyticsData?.mayorTrend || monthNames.map(m => ({ month: m, value: 0 }));
  const maxBurials = liveAnalyticsData?.maxBurials || 5;

  const mayorCemeteryInventory = mayorInventoryAnalytics.counts[activeMayorCemetery];
  const mayorCemeteryColTotalSlots = mayorCemeteryInventory.nicheTotal;
  const mayorCemeteryColTotalOccupied = mayorCemeteryInventory.nicheOccupied;
  const mayorCemeteryColTotalAvailable = mayorCemeteryInventory.nicheAvailable;
  const columbariumDistribution = [
    { label: 'Occupied', value: mayorCemeteryColTotalOccupied, color: 'var(--red)' },
    { label: 'Available', value: mayorCemeteryColTotalAvailable, color: 'var(--emerald)' },
  ];

  const autoFillReport = () => {
    if (reportAnalytics) {
      const metrics = reportAnalytics.metrics;
      const snapshot = reportAnalytics.current_snapshot;
      const content = `GRAVETRAK OPERATIONS REPORT
Reporting Period: ${activeReportPeriodLabel}
==================================================

PERIOD ACTIVITY
Applications Submitted: ${metrics.applications_submitted}
Applications Approved: ${metrics.applications_approved}
Applications Rejected: ${metrics.applications_rejected}
Documents Verified: ${metrics.documents_verified}
Appointments Scheduled: ${metrics.appointments_scheduled}
Burials: ${metrics.burials}

CURRENT INVENTORY SNAPSHOT (NOT DATE-FILTERED)
Available Graves: ${snapshot.available_graves}
Occupied Graves: ${snapshot.occupied_graves}
Available Plots: ${snapshot.available_plots}
Occupied Plots: ${snapshot.occupied_plots}
Available Columbarium Slots: ${snapshot.available_columbarium_slots}
Occupied Columbarium Slots: ${snapshot.occupied_columbarium_slots}

Generated by GraveTrak Analytics Engine
Date: ${new Date().toLocaleString()}`;
      setNewReport({ title: `Operations Report - ${activeReportPeriodLabel}`, content });
      return;
    }
    // This function should also use the same robust analytics logic
    const now = new Date();
    const currentM = now.getMonth();
    const currentY = now.getFullYear();
    const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const getCount = (m, y) => {
      let interments = 0;
      const allApprovedApps = [...approvedApps, ...scheduledApps, ...assignedApps];
      allApprovedApps.forEach(a => { const d = new Date(a.created_at); if(d && !isNaN(d.getTime()) && d.getMonth() === m && d.getFullYear() === y) interments++; });
      return interments;
    };

    const thisMonth = getCount(currentM, currentY);
    const lastMonthIdx = currentM === 0 ? 11 : currentM - 1;
    const lastMonthYear = currentM === 0 ? currentY - 1 : currentY;
    const lastMonth = getCount(lastMonthIdx, lastMonthYear);
    const diff = thisMonth - lastMonth;
    const pct = lastMonth > 0 ? Math.round((diff / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);

    const totalPlots = graveDataRef.current.length + columbariumSlotsRef.current.length;
    const totalOccupied = graveDataRef.current.filter(g => g.status === 'occupied').length + columbariumSlotsRef.current.filter(s => s.status === 'occupied').length;
    const occupancyRate = totalPlots > 0 ? (totalOccupied / totalPlots) : 0;

    let insight = occupancyRate > 0.85 ? "• CRITICAL: Overall cemetery capacity is at " + Math.round(occupancyRate*100) + "%. Expansion planning is urgent.\n" : "";
    insight += diff > 0 ? `• TREND: Interment activity increased by ${pct}% compared to ${monthNamesFull[lastMonthIdx]}.\n` : "• TREND: Monthly burial rates remain stable.\n";
    insight += mayorPendingApps.length > 5 ? `• OPERATIONS: There is a volume of ${mayorPendingApps.length} applications currently awaiting review.\n` : "";

    const content = `MONTHLY ANALYTICS REPORT: ${monthNamesFull[currentM].toUpperCase()} ${currentY}
==================================================

1. INTERMENT COMPARABILITY
--------------------------
Total Burials (This Month): ${thisMonth}
Total Burials (Last Month): ${lastMonth}
Variance: ${diff >= 0 ? '+' : ''}${diff} (${diff >= 0 ? 'Increase' : 'Decrease'} of ${Math.abs(pct)}%)

2. CAPACITY ANALYTICS
---------------------
Total System Capacity: ${totalPlots} slots
Current Occupancy: ${totalOccupied} (${Math.round(occupancyRate * 100)}%)
Remaining Availability: ${totalPlots - totalOccupied}

3. AUTOMATED INSIGHTS
---------------------
${insight || "• System is operating within normal parameters."}

Generated by GraveTrak Analytics Engine
Date: ${now.toLocaleString()}`;

    setNewReport({
      title: `Analytics Report - ${monthNamesFull[currentM]} ${currentY}`,
      content: content
    });
  };

  const mayorColDistributionTotal = columbariumDistribution.reduce((sum, item) => sum + item.value, 0);
  const mayorColGradient = mayorColDistributionTotal > 0 ? columbariumDistribution
    .reduce((acc, item, index) => {
      const start = columbariumDistribution
        .slice(0, index)
        .reduce((sum, prev) => sum + prev.value, 0) / mayorColDistributionTotal * 100;
      const end = start + item.value / mayorColDistributionTotal * 100;
      return acc + `${item.color} ${start}% ${end}%${index < columbariumDistribution.length - 1 ? ', ' : ''}`;
    }, '') : 'var(--border) 0% 100%';

  const handleArchiveCancelledApps = () => {
    if (selectedCancelledApps.length === 0) return;
    showConfirm('Archive Applications', `Are you sure you want to move ${selectedCancelledApps.length} cancelled application(s) to the archive?`, () => {
       const newArchived = [...archivedCancelledApps];
       selectedCancelledApps.forEach(appId => {
          if (!newArchived.some(a => String(a.id) === String(appId))) {
             const appToArchive = cancelledApps.find(a => String(a.id) === String(appId));
             if (appToArchive) newArchived.push(appToArchive);
          }
       });
       localStorage.setItem('gravetrak_archived_cancelled_apps', JSON.stringify(newArchived));
       setArchivedCancelledApps(newArchived);
       setCancelledApps(current => current.filter(a => !selectedCancelledApps.includes(a.id)));
       setSelectedCancelledApps([]);
       showToast(`${selectedCancelledApps.length} application(s) moved to archive.`);
    });
  };

  const handleBulkRejectPending = () => {
    if (selectedPendingApps.length === 0) return;
    showConfirm('Bulk Reject & Archive', `Are you sure you want to reject and archive ${selectedPendingApps.length} selected application(s)? This is useful for quickly removing spam or troll submissions.`, () => {
      const statuses = JSON.parse(localStorage.getItem('gravetrak_demo_statuses') || '{}');
      const reasons = JSON.parse(localStorage.getItem('gravetrak_demo_reasons') || '{}');
      const newArchived = [...archivedCancelledApps];
      const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
      
      selectedPendingApps.forEach(appId => {
        statuses[String(appId)] = 'rejected';
        reasons[String(appId)] = 'Rejected as spam / bulk cleared by admin.';
        
        const appToArchive = pendingApps.find(a => a.id === appId);
        if (appToArchive) {
            const archivedApp = { ...appToArchive, status: 'rejected' };
            if (!newArchived.some(a => String(a.id) === String(appId))) {
                newArchived.push(archivedApp);
            }
            fetch(`${API_BASE}/burial-applications/${appId}/reject/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` },
              body: JSON.stringify({ reason: 'Spam/Troll submission' }),
            }).catch(() => {});
        }
      });
      
      localStorage.setItem('gravetrak_demo_statuses', JSON.stringify(statuses));
      localStorage.setItem('gravetrak_demo_reasons', JSON.stringify(reasons));
      localStorage.setItem('gravetrak_archived_cancelled_apps', JSON.stringify(newArchived));
      
      setArchivedCancelledApps(newArchived);
      setPendingApps(current => current.filter(a => !selectedPendingApps.includes(a.id)));
      setSelectedPendingApps([]);
      showToast(`${selectedPendingApps.length} application(s) rejected and moved to Archive.`);
    });
  };

  const filteredPendingApps = selectApplicationList(pendingApps, applicationSearch, applicationFilters);
  const filteredApprovedApps = selectApplicationList(approvedApps, applicationSearch, applicationFilters);
  const filteredScheduledApps = selectApplicationList(scheduledApps, applicationSearch, applicationFilters);
  const filteredCompletedApps = selectApplicationList(completedApps, applicationSearch, applicationFilters);
  const filteredCancelledApps = selectApplicationList(cancelledApps, applicationSearch, applicationFilters);
  const filteredAllTransferRequests = selectApplicationList(allTransferRequests, applicationSearch, applicationFilters);
  const applicationsByTab = {
    pending: filteredPendingApps,
    approved: filteredApprovedApps,
    scheduled: filteredScheduledApps,
    completed: filteredCompletedApps,
    cancelled: filteredCancelledApps,
    transfer: filteredAllTransferRequests,
  };
  const applicationPageSize = 10;
  const paginatedApplications = Object.fromEntries(Object.entries(applicationsByTab).map(([tab, items]) => {
    const pages = Math.max(1, Math.ceil(items.length / applicationPageSize));
    const page = Math.min(applicationPages[tab] || 1, pages);
    return [tab, items.slice((page - 1) * applicationPageSize, page * applicationPageSize)];
  }));
  const currentApplicationList = applicationsByTab[appTab] || [];
  const currentApplicationPages = Math.max(1, Math.ceil(currentApplicationList.length / applicationPageSize));
  const currentApplicationPage = Math.min(applicationPages[appTab] || 1, currentApplicationPages);
  const setCurrentApplicationPage = page => setApplicationPages(current => ({ ...current, [appTab]: page }));

  const dashboardApproved = [...mayorApprovedApps, ...mayorScheduledApps, ...mayorAssignedApps].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const dashboardTransferRequests = allTransferRequests.filter(req => belongsToCemeteryOrIsUnassigned(req, activeMayorCemetery));

  const unreadSupportCount = regularMessages.filter(m => !m.isRead).length;
  const mayorNotificationCount = pendingApps.length + clearedRecords.length + cancelledNotifs.length + allTransferRequests.length;

  const todayStr = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
  const todaysInterviews = mayorScheduledApps
    .filter(app => app.interview_date === todayStr)
    .sort((a, b) => (a.interview_time || '').localeCompare(b.interview_time || ''));

  // Compute exactly 7 days from today for the maximum interview schedule date
  const maxInterviewDate = new Date();
  maxInterviewDate.setDate(maxInterviewDate.getDate() + 7);
  const maxInterviewDateString = maxInterviewDate.toISOString().split('T')[0];
  const recentGisActivity = [...activeCemeterySections].sort((a, b) =>
    new Date(b.properties?.updated_at || 0) - new Date(a.properties?.updated_at || 0)
  ).slice(0, 5).map(zone => ({
    label: `${zone.properties?.zone_code || 'Zone'} — ${zone.properties?.name || 'Unnamed zone'}`,
    detail: `${zone.properties?.is_active === false ? 'Inactive' : 'Active'} · ${zone.properties?.has_geometry ? 'Mapped boundary' : 'No boundary'} · ${zone.properties?.total_plots || 0} plots`,
    time: zone.properties?.updated_at ? new Date(zone.properties.updated_at).toLocaleString() : 'No update timestamp',
    tone: zone.properties?.is_active === false ? 'muted' : 'accent',
  }));

  return (
    <div className={`screen ${active ? 'active' : ''}`} id="screen-app">
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
          --emerald: #1687C9;
          --amber: #ef4444;
          --violet: #002d86;
        }
        body.high-contrast-mode {
          filter: contrast(130%) saturate(130%) brightness(0.95);
        }
        body.high-contrast-mode .btn, body.high-contrast-mode .filter-chip {
          border-width: 2px !important;
          font-weight: 800 !important;
        }
        .leaflet-control-attribution { display: none !important; }
        /* Google Maps Style UI Overrides */
        .panel-map-overlay, .legend-fab, .map-fab {
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1) !important;
          z-index: 1001 !important;
          backdrop-filter: blur(8px) !important;
        }
        .panel-map-overlay {
          position: absolute !important;
          bottom: 30px !important;
          left: 20px !important;
          top: auto !important;
          padding: 16px !important;
          border-radius: 16px !important;
        }
        .legend-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px 16px;
          max-height: 180px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .panel-map-header { display: none !important; }
        .color-key { border-radius: 50% !important; width: 10px !important; height: 10px !important; }
        .legend-title { font-size: 12px !important; font-weight: 800 !important; color: var(--text-primary) !important; margin-bottom: 12px !important; text-transform: uppercase; letter-spacing: 0.5px; }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
        }
        
        .map-action-pill {
          position: absolute !important;
          top: 80px !important;
          right: 16px !important;
          display: flex;
          flex-direction: column;
          background: rgba(15, 22, 41, 0.88) !important;
          backdrop-filter: blur(24px) !important;
          -webkit-backdrop-filter: blur(24px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 24px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
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
        .map-action-pill .pill-btn:last-child { border-bottom: none !important; }
        .map-action-pill .pill-btn:hover { background: rgba(255, 255, 255, 0.1) !important; color: var(--accent-light) !important; }
        .map-action-pill .pill-btn:active { background: var(--accent) !important; color: #ffffff !important; }
        .legend-fab {
          top: 16px !important;
          right: 16px !important;
          bottom: auto !important;
          padding: 12px 16px !important;
        }
        .map-fab {
          top: 16px !important;
          left: 16px !important;
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          border-radius: 28px !important;
          padding: 8px 20px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15) !important;
          backdrop-filter: blur(12px) !important;
        }
        #panel-admin-map .staff-map-toolbar {
          top: 16px !important; left: 16px !important; right: auto !important; bottom: auto !important;
          width: min(310px, calc(100vw - 32px)); min-width: 0; padding: 16px !important; border-radius: 16px !important;
          display: grid; gap: 12px; max-height: calc(100% - 32px); overflow: auto;
        }
        .staff-map-toolbar-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .staff-map-toolbar-heading > div { display: grid; gap: 3px; }
        .staff-map-toolbar-heading strong { color: var(--text-primary); font-size: 13px; }
        .staff-map-toolbar-heading span { color: var(--text-muted); font-size: 10px; }
        .staff-map-toolbar .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        .staff-map-clear { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; padding: 6px; }
        .staff-map-search input { width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 12px; outline: none; }
        .staff-map-search input:focus-visible, .staff-map-section-select select:focus-visible, .staff-map-toolbar button:focus-visible, .cemetery-switcher-container button:focus-visible, .map-action-pill button:focus-visible { outline: 3px solid var(--accent-light); outline-offset: 2px; }
        .staff-map-status-filters { display: flex; gap: 6px; flex-wrap: wrap; }
        #panel-admin-map .staff-map-status-filters .filter-chip { border: 1px solid var(--border); border-radius: 999px; background: var(--bg-card); color: var(--text-secondary); padding: 7px 10px; font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
        #panel-admin-map .staff-map-status-filters .filter-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
        .staff-map-section-select { display: grid; grid-template-columns: 52px minmax(0,1fr); gap: 8px; align-items: center; color: var(--text-secondary); font-size: 11px; }
        .staff-map-section-select select { min-width: 0; height: 36px; padding: 0 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 11px; }
        .staff-map-summary { display: flex; flex-wrap: wrap; gap: 7px 12px; padding-top: 10px; border-top: 1px solid var(--border); }
        .staff-map-summary span { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 10px; }
        .staff-map-summary i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
        .staff-map-summary i.available { background: ${PLOT_STATUS_COLORS.available}; }
        .staff-map-summary i.occupied { background: ${PLOT_STATUS_COLORS.occupied}; }
        .staff-map-summary i.maintenance { background: ${PLOT_STATUS_COLORS.maintenance}; }
        #panel-admin-map .staff-map-legend { left: 16px !important; right: auto !important; top: auto !important; bottom: 16px !important; width: 230px; }
        .staff-map-legend-total { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 10px; }
        .staff-map-section-legend { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
        .staff-map-section-legend-title { margin-bottom: 7px; color: var(--text-primary); font-size: 10px; font-weight: 800; }
        .staff-map-section-legend-note { margin: -3px 0 6px; color: var(--text-muted); font-size: 9px; }
        .staff-map-section-legend-row { display: flex; align-items: center; gap: 7px; padding: 3px 0; color: var(--text-secondary); font-size: 10px; }
        .staff-map-section-swatch { width: 12px; height: 12px; flex: 0 0 12px; border: 1px solid rgba(15,23,42,.28); border-radius: 3px; }
        #panel-admin-map .map-action-pill { top: 50% !important; transform: translateY(-50%); }
        #panel-planning .planning-capacity-fab {
          top: 16px !important; left: 16px !important; right: auto !important; bottom: auto !important;
          padding: 16px !important; border-radius: 12px !important;
        }
        #panel-planning .planning-draw-fab {
          top: auto !important; left: 16px !important; right: auto !important; bottom: 20px !important;
          padding: 10px !important; border-radius: 10px !important;
        }
        #panel-planning .planning-zones-fab {
          top: 72px !important; left: auto !important; right: 16px !important; bottom: auto !important;
          padding: 14px !important; border-radius: 12px !important;
        }
        #panel-planning .planning-error-fab {
          top: 72px !important; left: 16px !important; right: auto !important; bottom: auto !important;
          padding: 12px 14px !important; border-radius: var(--radius) !important;
        }
        #panel-planning .section-point-label {
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          color: #fff !important;
          font-size: 9px !important;
          font-weight: 800 !important;
          line-height: 1 !important;
          margin: 0 !important;
          padding: 0 !important;
          pointer-events: none !important;
        }
        #panel-planning .section-point-label::before { display: none !important; }
        .cemetery-switcher-container {
          position: absolute !important;
          top: 16px !important;
          right: 16px !important;
          z-index: 1010 !important;
          background: var(--bg-surface) !important;
          border: 1px solid var(--border) !important;
          padding: 4px !important;
          border-radius: 14px !important;
          display: flex !important;
          gap: 4px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.2) !important;
          backdrop-filter: blur(24px) !important;
        }
        .cemetery-switcher-container .btn {
          border-radius: 10px !important;
          border: none !important;
          font-size: 11px !important;
          font-weight: 800 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.5px !important;
          height: 34px !important;
          padding: 0 16px !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .cemetery-switcher-container .btn[aria-pressed='true'] { background: var(--accent) !important; color: #fff !important; }
        @media (max-width: 700px) {
          #panel-admin-map .staff-map-toolbar { top: 8px !important; left: 8px !important; width: min(290px, calc(100vw - 16px)); padding: 12px !important; gap: 9px; max-height: 48%; }
          #panel-admin-map .staff-map-legend { display: block !important; left: 8px !important; right: auto !important; bottom: 76px !important; width: 195px; max-height: 34%; overflow: auto; padding: 10px !important; }
          #panel-admin-map .cemetery-switcher-container { top: auto !important; right: auto !important; bottom: 16px !important; left: 50% !important; transform: translateX(-50%); max-width: calc(100% - 24px); }
          #panel-admin-map .cemetery-switcher-container .btn { padding: 0 11px !important; font-size: 10px !important; white-space: nowrap; }
          #panel-admin-map .map-action-pill { top: auto !important; right: 10px !important; bottom: 82px !important; transform: none; }
        }
        .responsive-app-grid {
          flex: 1;
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
          gap: 12px;
          align-items: center;
        min-width: 0;
      }
      .responsive-app-grid > div {
        min-width: 0;
        }
        .mayor-dash-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 16px;
          margin-bottom: 20px;
          align-items: stretch;
        }
        .mayor-dash-grid-2 {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 16px;
        }
        .app-card-wrapper {
          display: flex;
          gap: 16px;
          align-items: center;
          padding: 16px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .app-card-wrapper:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          border-color: var(--accent);
        }
        .mayor-stat-card {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          min-width: 0;
          overflow: hidden;
        }
        #panel-mayor-dash:not(.active) .mayor-stat-card { animation: none; }
        #panel-mayor-dash.active .mayor-stat-card { animation: mayor-card-enter .52s cubic-bezier(.2,.8,.2,1) both; }
        #panel-mayor-dash:not(.active) :is(.mayor-status-donut, .mayor-aging-track > div, .mayor-capacity-track > div, .mayor-trend-bar, .mayor-trend-value, .mayor-slots-donut, .mayor-status-row, .donut-legend-row) { animation: none; }
        #panel-mayor-dash.active .mayor-status-donut { animation: mayor-donut-enter .8s cubic-bezier(.2,.8,.2,1) both; }
        #panel-mayor-dash.active .mayor-aging-track > div { animation: mayor-bar-grow .8s cubic-bezier(.2,.8,.2,1) var(--aging-delay) both; }
        #panel-mayor-dash.active .mayor-capacity-track > div { animation: mayor-bar-grow .9s cubic-bezier(.2,.8,.2,1) var(--capacity-delay) both; }
        #panel-mayor-dash.active .mayor-stat-card:nth-child(2) { animation-delay: .07s; }
        #panel-mayor-dash.active .mayor-stat-card:nth-child(3) { animation-delay: .14s; }
        .mayor-stat-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 12px 24px rgba(0,0,0,0.12);
          border-color: var(--accent);
        }
        .mayor-analytics-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .mayor-analytics-card {
          padding: 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }
        .mayor-analytics-grid .mayor-analytics-card:nth-child(2) { animation-delay: .08s; }
        .mayor-analytics-grid .mayor-analytics-card:nth-child(3) { animation-delay: .16s; }
        .mayor-analytics-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
        }
        .mayor-analytics-title { color: var(--text-primary); font-size: 14px; font-weight: 800; }
        .mayor-analytics-subtitle { margin-top: 4px; color: var(--text-muted); font-size: 11px; }
        .mayor-analytics-badge {
          flex: 0 0 auto;
          padding: 5px 9px;
          border: 1px solid rgba(22,135,201,.2);
          border-radius: 999px;
          background: rgba(22,135,201,.09);
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
        }
        .mayor-analytics-badge.warning { border-color: rgba(245,158,11,.24); background: rgba(245,158,11,.1); color: var(--amber); }
        .mayor-status-layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; }
        .mayor-status-donut {
          display: grid;
          width: 126px;
          height: 126px;
          padding: 12px;
          place-items: center;
          border-radius: 50%;
          background: var(--status-gradient);
          box-shadow: 0 8px 24px rgba(22,135,201,.14);
          animation: mayor-donut-enter .8s cubic-bezier(.2,.8,.2,1) both;
        }
        .mayor-status-donut > div {
          display: flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          border-radius: 50%;
          background: var(--bg-card);
        }
        .mayor-status-donut strong { color: var(--text-primary); font-size: 24px; line-height: 1; }
        .mayor-status-donut span { margin-top: 5px; color: var(--text-muted); font-size: 9px; }
        .mayor-status-legend { display: grid; gap: 7px; min-width: 0; }
        .mayor-status-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 10px; }
        .mayor-status-row i { width: 8px; height: 8px; border-radius: 3px; }
        .mayor-status-row span { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }
        .mayor-status-row strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
        #panel-mayor-dash.active .mayor-status-row,
        #panel-mayor-dash.active .donut-legend-row { animation: mayor-legend-enter .38s ease-out both; }
        #panel-mayor-dash.active .mayor-status-row:nth-child(2),
        #panel-mayor-dash.active .donut-legend-row:nth-child(2) { animation-delay: .07s; }
        #panel-mayor-dash.active .mayor-status-row:nth-child(3),
        #panel-mayor-dash.active .donut-legend-row:nth-child(3) { animation-delay: .14s; }
        #panel-mayor-dash.active .mayor-status-row:nth-child(4),
        #panel-mayor-dash.active .donut-legend-row:nth-child(4) { animation-delay: .21s; }
        #panel-mayor-dash.active .mayor-status-row:nth-child(5),
        #panel-mayor-dash.active .donut-legend-row:nth-child(5) { animation-delay: .28s; }
        .mayor-trend-bar { transform-origin: bottom; }
        #panel-mayor-dash.active .mayor-trend-bar { animation: mayor-trend-rise .72s cubic-bezier(.2,.8,.2,1) var(--trend-delay, 0ms) both; }
        #panel-mayor-dash.active .mayor-trend-value:not(.is-empty) { animation: mayor-value-enter .42s ease-out var(--trend-delay, 0ms) both; }
        #panel-mayor-dash.active .mayor-slots-donut { animation: mayor-donut-enter .85s cubic-bezier(.2,.8,.2,1) both; }
        .mayor-aging-chart { display: grid; gap: 14px; min-height: 136px; align-content: center; }
        .mayor-aging-row { display: grid; grid-template-columns: 62px minmax(0, 1fr) 22px; gap: 9px; align-items: center; }
        .mayor-aging-row > span { color: var(--text-secondary); font-size: 10px; font-weight: 700; }
        .mayor-aging-row > strong { color: var(--text-primary); font-size: 11px; text-align: right; }
        .mayor-aging-track { height: 10px; overflow: hidden; border-radius: 999px; background: rgba(148,163,184,.16); }
        .mayor-aging-track > div {
          width: var(--aging-width);
          height: 100%;
          border-radius: inherit;
          background: var(--aging-color);
          transform-origin: left;
          animation: mayor-bar-grow .8s cubic-bezier(.2,.8,.2,1) var(--aging-delay) both;
        }
        .mayor-aging-footnote { margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 9px; line-height: 1.45; }
        .mayor-capacity-list { display: grid; gap: 20px; }
        .mayor-capacity-row { display: grid; gap: 9px; }
        .mayor-capacity-label { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .mayor-capacity-label > div { display: grid; gap: 3px; min-width: 0; }
        .mayor-capacity-label strong { color: var(--text-primary); font-size: 12px; }
        .mayor-capacity-label span { overflow: hidden; color: var(--text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
        .mayor-capacity-label b { color: var(--accent); font-size: 13px; }
        .mayor-capacity-track { height: 10px; overflow: hidden; border-radius: 999px; background: rgba(16,185,129,.13); }
        .mayor-capacity-track > div {
          width: var(--capacity-width);
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
          transform-origin: left;
          animation: mayor-bar-grow .9s cubic-bezier(.2,.8,.2,1) var(--capacity-delay) both;
        }
        .mayor-capacity-summary { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; padding-top: 13px; border-top: 1px solid var(--border); }
        .mayor-capacity-summary span { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 9px; }
        .mayor-capacity-summary i { width: 8px; height: 8px; border-radius: 2px; }
        .mayor-capacity-summary i.available { background: var(--emerald); }
        .mayor-capacity-summary i.occupied { background: var(--red); }
        @keyframes mayor-card-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mayor-legend-enter { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes mayor-trend-rise { from { opacity: .35; transform: scaleY(.08); } to { opacity: 1; transform: scaleY(1); } }
        @keyframes mayor-value-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mayor-donut-enter { from { opacity: 0; transform: scale(.76) rotate(-30deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
        @keyframes mayor-bar-grow { from { opacity: .25; transform: scaleX(0); } to { opacity: 1; transform: scaleX(1); } }
        @media (max-width: 1180px) {
          .mayor-analytics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .mayor-analytics-grid .mayor-analytics-card:last-child { grid-column: 1 / -1; }
        }
        @media (max-width: 720px) {
          .mayor-analytics-grid { grid-template-columns: 1fr; }
          .mayor-analytics-grid .mayor-analytics-card:last-child { grid-column: auto; }
          .mayor-status-layout { grid-template-columns: 1fr; justify-items: center; }
          .mayor-status-legend { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .mayor-stat-card, .mayor-status-donut, .mayor-aging-track > div, .mayor-capacity-track > div,
          .mayor-trend-bar, .mayor-trend-value, .mayor-slots-donut, .mayor-status-row, .donut-legend-row { animation: none !important; transition: none !important; }
        }
        .planning-dashboard-grid {
          display: grid;
          grid-template-columns: minmax(320px, 1.25fr) minmax(280px, .95fr) minmax(300px, 1fr);
          gap: 16px;
          align-items: stretch;
        }
        .planning-card {
          min-width: 0;
          padding: 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
        }
        .planning-card-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .planning-card-subtitle {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin-bottom: 16px;
        }
        .planning-capacity-list,
        .planning-forecast-list,
        .planning-alert-list {
          display: grid;
          gap: 12px;
        }
        .planning-forecast-item {
          padding: 13px;
          border-radius: var(--radius);
          background: rgba(255,255,255,.025);
          border: 1px solid rgba(255,255,255,.07);
        }
        .planning-forecast-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
          margin-bottom: 9px;
        }
        .planning-forecast-section {
          font-size: 13px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .planning-forecast-months {
          font-size: 11px;
          font-weight: 800;
          color: var(--accent-light);
          white-space: nowrap;
        }
        .planning-forecast-bar {
          height: 7px;
          background: rgba(255,255,255,.06);
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .planning-forecast-fill {
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
        }
        .planning-forecast-fill.warning {
          background: var(--accent);
        }
        .planning-forecast-fill.critical {
          background: var(--red);
        }
        .planning-forecast-note {
          font-size: 11px;
          color: var(--text-muted);
        }
        .planning-activity-list {
          display: grid;
          gap: 10px;
          max-height: 292px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .planning-activity-card {
          grid-column: span 2;
        }
        .planning-activity-item {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 10px;
          padding: 11px;
          border-radius: var(--radius);
          background: rgba(255,255,255,.025);
          border: 1px solid rgba(255,255,255,.06);
        }
        .planning-activity-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          margin-top: 4px;
          box-shadow: 0 0 0 4px rgba(22,135,201,.1);
        }
        .planning-activity-dot.emerald {
          background: var(--emerald);
          box-shadow: 0 0 0 4px rgba(22,135,201,.1);
        }
        .planning-activity-dot.amber {
          background: var(--amber);
          box-shadow: 0 0 0 4px rgba(245,158,11,.1);
        }
        .planning-activity-dot.muted {
          background: var(--text-muted);
          box-shadow: 0 0 0 4px rgba(148,163,184,.1);
        }
        .planning-activity-title {
          font-size: 12px;
          font-weight: 800;
          color: var(--text-primary);
          margin-bottom: 3px;
        }
        .planning-activity-detail {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .planning-activity-time {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 5px;
        }
        .planning-zoning-column {
          display: grid;
          gap: 16px;
        }
        .quick-gis-actions {
          display: grid;
          gap: 10px;
        }
        .quick-gis-action-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 11px;
          justify-content: flex-start;
          padding: 12px 13px;
          border-radius: var(--radius);
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.025);
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.2;
          cursor: pointer;
          transition: background .18s ease, border-color .18s ease, transform .18s ease;
        }
        .quick-gis-action-btn:hover:not(:disabled) {
          background: rgba(22,135,201,.1);
          border-color: rgba(96,165,250,.28);
          transform: translateY(-1px);
        }
        .quick-gis-action-btn:disabled {
          cursor: not-allowed;
          opacity: .65;
        }
        .quick-gis-action-icon {
          width: 28px;
          height: 28px;
          flex: 0 0 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: rgba(22,135,201,.12);
          border: 1px solid rgba(96,165,250,.18);
          color: var(--accent-light);
          font-size: 14px;
          font-weight: 900;
        }
        .quick-gis-action-btn.export .quick-gis-action-icon {
          background: rgba(22,135,201,.12);
          border-color: rgba(22,135,201,.22);
          color: var(--emerald);
        }
        .app-card-actions-wrapper {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-shrink: 0;
        }
        .sidebar {
          transition: transform 0.3s ease, width 0.3s ease, padding 0.3s ease, opacity 0.3s ease;
        }
        .sidebar.collapsed {
          width: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          overflow: hidden !important;
          opacity: 0;
          border-right: none !important;
        }
        .admin-hamburger:hover {
          background: rgba(255,255,255,0.2) !important;
        }
        .sidebar-overlay {
          display: none;
        }
        @media print {
          @page { size: landscape; margin: 10mm; }
          body { background: #fff !important; color: #000 !important; }
          .app-topbar, .sidebar, .notif-badge, .dropdown-menu { display: none !important; }
          .app-body, .main, .scroll-panel { overflow: visible !important; height: auto !important; width: 100% !important; display: block !important; }
          .panel:not(#panel-mayor-dash) { display: none !important; }
          #panel-mayor-dash { display: block !important; position: static !important; width: 100% !important; }
          .page-actions { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          
          /* Print-friendly overrides */
          .page-title { color: #000 !important; }
          .page-sub { color: #555 !important; }
          div[style*="var(--bg-card)"] { background: #f8f9fa !important; border: 1px solid #ddd !important; box-shadow: none !important; color: #000 !important; }
          div[style*="var(--text-primary)"] { color: #000 !important; }
          div[style*="var(--text-secondary)"], div[style*="var(--text-muted)"] { color: #444 !important; }
          div[style*="rgba(255,255,255,.02)"] { background: transparent !important; border: 1px solid #eee !important; }
          .donut-chart-center { background: #f8f9fa !important; color: #000 !important; }
          .donut-legend-list { color: #000 !important; }
        }
        @media (max-width: 1024px) {
          .responsive-app-grid {
            grid-template-columns: 1fr 1fr;
          }
          .responsive-app-grid > div:nth-child(1) { grid-column: span 2; }
          .responsive-app-grid > div:nth-child(5) { grid-column: span 2; }
          
          .mayor-dash-grid, .mayor-dash-grid-2 {
            grid-template-columns: 1fr;
          }
          .planning-dashboard-grid {
            grid-template-columns: 1fr 1fr;
          }
          .planning-zoning-column {
            grid-column: 1 / -1;
            grid-template-columns: 1fr 1fr;
          }
          .planning-activity-card {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 768px) {
          .responsive-app-grid {
            grid-template-columns: 1fr;
          }
          .responsive-app-grid > div { grid-column: span 1 !important; }
          .app-card-actions-wrapper {
            flex-direction: column;
            width: 100%;
            align-items: stretch;
            margin-top: 12px;
          }
          .app-card-wrapper {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .planning-dashboard-grid,
          .planning-zoning-column {
            grid-template-columns: 1fr;
          }
          .planning-zoning-column {
            grid-column: auto;
          }
          .planning-activity-card {
            grid-column: auto;
          }
          .admin-hamburger {
            display: none !important;
          }
          .sidebar {
            position: fixed !important;
            top: auto !important;
            bottom: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
            max-width: 100vw !important;
            transform: none !important;
            z-index: 10000 !important;
            background: rgba(15, 22, 41, 0.95) !important;
            backdrop-filter: blur(20px) !important;
            -webkit-backdrop-filter: blur(20px) !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-right: none !important;
            display: flex !important;
            flex-direction: row !important;
            opacity: 1 !important;
            padding: 0 8px env(safe-area-inset-bottom, 0px) 8px !important;
            box-shadow: 0 -8px 24px rgba(0,0,0,0.3) !important;
            visibility: visible !important;
          }
          .sidebar.collapsed {
            transform: none !important;
            width: 100% !important;
            opacity: 1 !important;
            visibility: visible !important;
          }
          .sidebar-overlay.mobile-only {
            display: none !important;
          }
          .sidebar-scroll {
            flex-direction: row !important;
            padding: 0 8px !important;
            width: 100% !important;
            height: 100% !important;
            align-items: center !important;
            justify-content: space-around !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            gap: 4px !important;
            scrollbar-width: none;
          }
          .sidebar-scroll::-webkit-scrollbar {
            display: none;
          }
          .nav-item {
            flex-direction: column !important;
            justify-content: center !important;
            padding: 6px !important;
            height: 56px !important;
            border-radius: 12px !important;
            flex: 1 !important;
            min-width: 60px !important;
            background: transparent !important;
            box-shadow: none !important;
            border: none !important;
            position: relative;
            color: var(--text-secondary) !important;
          }
          .nav-item.active {
            background: transparent !important;
          }
          .nav-item .nav-content-wrapper {
            flex-direction: column !important;
            gap: 4px !important;
          }
          .nav-item .nav-icon-span {
            font-size: 20px !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            filter: grayscale(100%) opacity(0.6);
          }
          .nav-item.active .nav-icon-span {
            transform: translateY(-2px) scale(1.1);
            filter: grayscale(0%) opacity(1) drop-shadow(0 4px 8px rgba(25, 135, 101, 0.5));
          }
          .nav-item .nav-label-span {
            font-size: 10px !important;
            font-weight: 600 !important;
            transition: all 0.2s ease;
            white-space: normal !important;
            text-align: center;
            line-height: 1.1 !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            width: 100%;
          }
          .nav-item.active .nav-label-span {
            color: var(--text-primary) !important;
          }
          .nav-badge {
            position: absolute !important;
            top: 2px !important;
            right: 50% !important;
            transform: translateX(10px) !important;
            padding: 2px 5px !important;
            font-size: 9px !important;
            margin-top: 0 !important;
            border: 2px solid rgba(15, 22, 41, 0.95) !important;
            background: var(--red) !important;
            color: white !important;
            box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4) !important;
          }
          .sidebar-footer {
            display: none !important;
          }
          .main {
            padding-bottom: 70px !important;
          }
          .panel-map-overlay {
            top: auto;
            bottom: 280px !important;
            left: 12px;
            right: auto;
            width: 140px;
            padding: 8px;
          }
          .panel-map-header {
            display: none;
          }
          .panel-map-legend .legend-title {
            font-size: 10px;
          }
          .panel-map-legend .legend-item {
            font-size: 11px;
          }
          .legend-fab {
            bottom: 12px;
            right: 12px;
            padding: 8px;
            font-size: 11px;
          }
          .legend-fab .legend-title {
            font-size: 10px;
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
        .bell-ring-anim { animation: bellRing 2s infinite ease-in-out; transform-origin: top center; }
        .topbar-btn:hover svg { animation: bellRing 1s ease 1; transform-origin: top center; }
        @keyframes msgBounce {
          0%, 100% { transform: translateY(0); }
          25% { transform: translateY(-3px); }
          50% { transform: translateY(0); }
          75% { transform: translateY(-1px); }
        }
        .msg-bounce-anim { animation: msgBounce 2s infinite ease-in-out; }
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
      {confirmDialog.isOpen && (
        <div className="modal-overlay open" style={{ zIndex: 100010 }} onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}>
          <div className="modal" style={{ maxWidth: '400px', width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {confirmDialog.isDestructive && <span style={{ color: 'var(--red)', fontSize: 18 }}>⚠</span>}
                {confirmDialog.title}
              </div>
              <button className="modal-close" onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
                {confirmDialog.message}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}>Cancel</button>
                <button className="btn btn-primary" style={confirmDialog.isDestructive ? { background: 'var(--red)', borderColor: 'var(--red)' } : {}} onClick={() => {
                  if (confirmDialog.onConfirm) confirmDialog.onConfirm();
                  setConfirmDialog({ ...confirmDialog, isOpen: false });
                }}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="app-topbar">
        <div className="topbar-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div 
            className="admin-hamburger" 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.1)',
              cursor: 'pointer',
              flexShrink: 0
            }}
            title="Toggle Sidebar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </div>
          <div className="topbar-icon">
            <img src={graveTrakLogo} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <button className="topbar-name" style={{ border: 0, background: 'transparent', cursor: 'pointer' }} onClick={onShowLanding}>GraveTrak</button>
        </div>
        <div className="topbar-search">
          <div className="topbar-search-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          {selectedPanel === 'panel-approvals' ? (
            <input type="search" aria-label="Search burial applications" placeholder="Search applicant, deceased name, or application ID..." value={applicationSearch} onChange={e => changeApplicationSearch(e.target.value)} />
          ) : isStaffRole ? <StaffSearch slots={columbariumSlots} plots={groundPlots}
            sections={staffSearchSections} loading={groundPlotsLoading} error={plotDataError}
            onClear={() => setStaffMapSearchTarget(null)} onChoose={result => {
              if (selectedPanel === 'panel-admin-map' || result.kind !== 'niche') {
                setStaffMapSearchTarget({ ...result });
                setActiveAdminCemetery(result.cemeteryMap);
                setStaffMapSectionFilter('all'); setStaffMapStatusFilter('all');
                setSelectedPanel('panel-admin-map');
                return;
              }
              setActiveColumbariumMap(result.cemeteryMap);
              setColumbariumSection(result.section);
              setColumbariumFilter('all');
              setNicheFocusTarget({ ...result });
              setSelectedPanel('panel-columbarium');
            }} /> : role === 'mayor' ? (
            <input type="search" aria-label="Search graves, records, and applications" placeholder="Search graves, records, applications..." value={officeSearchQuery} onChange={event => setOfficeSearchQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitOfficeSearch(); }} />
          ) : (<input type="text" placeholder={role === 'planning' ? "Search graves and records\u2026" : "Search graves, records, applications\u2026"} />)}
        </div>
        <div className="topbar-actions">
          {role === 'mayor' && (
            <>
              <div className="topbar-btn" ref={inboxRef} onClick={(e) => { e.stopPropagation(); setInboxOpen((v) => !v); setNotifOpen(false); setProfileOpen(false); }} title="Messages" style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'all 0.2s ease', color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg className={unreadSupportCount > 0 ? "msg-bounce-anim" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ display: 'block' }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            </div>
            {unreadSupportCount > 0 && <span className="notif-badge" style={{ position: 'absolute', top: -2, right: -2, padding: '3px 6px', fontSize: 10, fontWeight: 800, background: 'var(--accent)', color: '#fff', borderRadius: '12px', border: '2px solid var(--bg-surface)', minWidth: 18, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxShadow: '0 2px 6px rgba(25, 135, 101, 0.5)' }}>{unreadSupportCount}</span>}
            
            {inboxOpen && (
              <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: -10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: 340, zIndex: 100, padding: 8, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '4px 8px' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Messages</span>
                  {unreadSupportCount > 0 && <span style={{ fontSize: 11, background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{unreadSupportCount} new</span>}
                </div>
                {regularMessages.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
                    {regularMessages.map(msg => {
                      const initials = msg.user ? msg.user.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U';
                      return (
                      <div key={`sup-${msg.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px', background: msg.isRead ? 'transparent' : 'rgba(25,135,101,.05)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = msg.isRead ? 'rgba(255,255,255,.04)' : 'rgba(25,135,101,.1)'} onMouseLeave={(e) => e.currentTarget.style.background = msg.isRead ? 'transparent' : 'rgba(25,135,101,.05)'} onClick={(e) => { 
                        e.stopPropagation();
                        
                        const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                        const updatedMsgs = msgs.map(m => m.id === msg.id ? { ...m, isRead: true } : m);
                        localStorage.setItem('gravetrak_support_messages', JSON.stringify(updatedMsgs));
                        setSupportMessages(updatedMsgs.filter(m => !m.resolved));
                        const evt = new Event('storage'); evt.key = 'gravetrak_support_messages'; window.dispatchEvent(evt);

                        setReplyMessage('');
                        setViewSupportMsg(msg);
                        setInboxOpen(false); 
                      }}>
                        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: msg.isRead ? 600 : 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                            {msg.user}
                          </div>
                          <div style={{ fontSize: 13, color: msg.isRead ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: msg.isRead ? 400 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {msg.message ? msg.message : (msg.appId ? `Re: ${msg.deceased || msg.appId}` : 'General Inquiry')}
                          </div>
                        </div>
                        {!msg.isRead && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginLeft: 4 }} />}
                      </div>
                    )})}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '30px 0' }}>No new messages.</div>
                )}
              </div>
            )}
          </div>
          <div className="topbar-btn" ref={notifRef} onClick={(e) => { e.stopPropagation(); setNotifOpen((v) => !v); setInboxOpen(false); setProfileOpen(false); }} title="Notifications" style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'all 0.2s ease', color: 'var(--text-secondary)', marginLeft: 8 }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg className={mayorNotificationCount > 0 ? "bell-ring-anim" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ display: 'block' }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            {mayorNotificationCount > 0 && <span className="notif-badge" style={{ position: 'absolute', top: -2, right: -2, padding: '3px 6px', fontSize: 10, fontWeight: 800, background: 'var(--red)', color: '#fff', borderRadius: '12px', border: '2px solid var(--bg-surface)', minWidth: 18, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxShadow: '0 2px 6px rgba(239, 68, 68, 0.5)' }}>{mayorNotificationCount}</span>}
            
            {notifOpen && (
              <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: -10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: 280, zIndex: 100, padding: 12, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</span>
                  {mayorNotificationCount > 0 && <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', padding: '2px 6px', borderRadius: 10 }}>{mayorNotificationCount} updates</span>}
                </div>
                {mayorNotificationCount > 0 ? (
                  <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                    {allTransferRequests.map(req => (
                      <div key={`req-${req.id}`} style={{ padding: 10, background: 'rgba(25,135,101,.05)', border: '1px solid rgba(25,135,101,.1)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(25,135,101,.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(25,135,101,.05)'} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('transfer'); setNotifOpen(false); }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>🔄 Transfer Plot Request</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{req.user} requested transfer for {req.deceased}</div>
                      </div>
                    ))}
                    {pendingApps.map(app => (
                      <div key={`pend-${app.id}`} style={{ padding: 10, background: 'rgba(255,255,255,.03)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,.06)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,.03)'} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('pending'); setNotifOpen(false); }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>New Application</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{app.applicant_name || app.name} ({app.application_id || app.id})</div>
                      </div>
                    ))}
                    {assignedApps.map(app => (
                      <div key={`assig-${app.id}`} style={{ padding: 10, background: 'rgba(16,185,129,.05)', border: '1px solid rgba(16,185,129,.1)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16,185,129,.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(16,185,129,.05)'} onClick={() => { setSelectedPanel('panel-graves'); setNotifOpen(false); }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--emerald)', marginBottom: 4 }}>✓ Plot Assigned</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{app.deceased_name} was successfully assigned a slot</div>
                      </div>
                    ))}
                    {clearedRecords.map(rec => (
                      <div key={`clear-${rec.id}`} style={{ padding: 10, background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.1)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,.05)'} onClick={() => { setSelectedPanel('panel-graves'); setRecordSearch(rec.slotId); setNotifOpen(false); }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>⚠ Record Removed</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rec.name} was removed from {rec.slotId}</div>
                      </div>
                    ))}
                    {cancelledNotifs.map(notif => (
                      <div key={`cancel-${notif.id}`} style={{ padding: 10, background: 'rgba(245,158,11,.05)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245,158,11,.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(245,158,11,.05)'} onClick={() => { 
                        const updated = cancelledNotifs.filter(n => n.id !== notif.id);
                        setCancelledNotifs(updated);
                        localStorage.setItem('gravetrak_cancelled_notifs', JSON.stringify(updated));
                        setSelectedPanel('panel-approvals');
                        setAppTab('cancelled');
                        setNotifOpen(false); 
                      }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>⚠️</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 2 }}>Application Cancelled</div>
                            <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>{notif.name} ({notif.appId})</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}><strong>Reason:</strong> {notif.reason}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>No new notifications.</div>
                )}
              </div>
            )}
          </div>
            </>
          )}
          <button 
            className="topbar-btn" 
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            style={{ marginLeft: 8 }}
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
          <span className={`role-badge ${info.rb}`}>{info.badge}</span>
          <div style={{ position: 'relative' }} ref={profileRef}>
            <div className="avatar" onClick={(e) => { e.stopPropagation(); setProfileOpen((v) => !v); setNotifOpen(false); setInboxOpen(false); }} style={{ cursor: 'pointer' }}>{info.av}</div>
            {profileOpen && (
              <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: 220, zIndex: 100, padding: 8 }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{info.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{info.role}</div>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <button className="btn btn-ghost" onClick={() => { setProfileOpen(false); onShowLanding(); }}>Visit Homepage</button>
                  {panels.some(p => p.panel === 'panel-settings') && (
                    <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '8px 12px', fontSize: 12, width: '100%' }} onClick={() => { setSelectedPanel('panel-settings'); setProfileOpen(false); }}>Profile Settings</button>
                  )}
                  <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '8px 12px', fontSize: 12, width: '100%', color: 'var(--red)' }} onClick={() => { setProfileOpen(false); onLogout(); }}>Logout</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="app-body">
        {!sidebarCollapsed && (
          <div 
            className="sidebar-overlay mobile-only" 
            onClick={() => setSidebarCollapsed(true)} 
          />
        )}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-scroll" style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {panels.map((item) => {
              let badge = item.badge;
              if (item.id === 'approvals') {
                const count = pendingApps.length + allTransferRequests.length;
                badge = count > 0 ? count : null;
              }
              if (item.id === 'reports' && role === 'mayor') {
                const pendingReports = reports.filter(r => r.status === 'pending').length;
                badge = pendingReports > 0 ? pendingReports : null;
              }
              const isActive = selectedPanel === item.panel;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedPanel(item.panel)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: isActive ? 800 : 600,
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    boxShadow: isActive ? '0 6px 16px rgba(25, 135, 101, 0.35)' : 'none',
                    border: isActive ? '1px solid transparent' : '1px solid transparent',
                    transition: 'all 0.2s ease',
                    userSelect: 'none',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.border = '1px solid var(--border)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.border = '1px solid transparent';
                    }
                  }}
                >
                  <div className="nav-content-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="nav-icon-span" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                      {getIcon(item.id, item.panel) || <span style={{ fontSize: '20px' }}>{item.ico || '📍'}</span>}
                    </span>
                    <span className="nav-label-span" style={{ letterSpacing: '0.5px' }}>{item.label}</span>
                  </div>
                  {badge ? <span className="nav-badge" style={{ background: isActive ? '#fff' : 'var(--red)', color: isActive ? 'var(--accent)' : '#fff', fontSize: '13px', padding: '4px 10px', borderRadius: '12px', fontWeight: 800, marginLeft: 'auto' }}>{badge}</span> : null}
                </div>
              );
            })}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{info.av}</div>
              <div className="su-info">
                <div className="su-name">{info.name}</div>
                <div className="su-role">{info.role}</div>
              </div>
              <button type="button" className="btn-icon" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={onLogout} title="Sign out" aria-label="Sign out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div className="main" id="main-panels">
          <div className={`panel ${selectedPanel === 'panel-admin-dash' ? 'active' : ''}`} id="panel-admin-dash">
            <div className="scroll-panel">
              {isStaffRole && selectedPanel === 'panel-admin-dash' && <StaffDashboard
                slots={columbariumSlots}
                groundPlots={groundPlots}
                groundPlotError={plotDataError}
                groundPlotsLoading={groundPlotsLoading}
                cemetery={activeAdminCemetery}
                onCemeteryChange={setActiveAdminCemetery}
                onSection={(section, cemetery) => { setActiveColumbariumMap(cemetery); setColumbariumSection(section); setColumbariumFilter('all'); setNicheFocusTarget(null); setSelectedPanel('panel-columbarium'); }}
                onReview={slot => handleSlotClick(slot.id, slot.floor, slot.col, slot.status, slot.name, slot.section, slot.cemeteryMap)}
                onRecords={cemetery => { setActiveColumbariumMap(cemetery); setSelectedPanel('panel-columbarium-records'); }}
                onNiches={cemetery => {
                  setActiveColumbariumMap(cemetery);
                  const first = columbariumSlots.find(slot => slot.cemeteryMap === cemetery);
                  if (first) setColumbariumSection(first.section);
                  setColumbariumFilter('all'); setNicheFocusTarget(null); setSelectedPanel('panel-columbarium');
                }}
                onMap={cemetery => { setActiveAdminCemetery(cemetery); setSelectedPanel('panel-admin-map'); requestAnimationFrame(() => { adminMapRef.current?.invalidateSize(); adminMapRef.current?.flyTo(cemetery === 'new' ? ANOTHER_CEMETERY_CENTER : CEMETERY_CENTER, 19); }); }}
              />}
            </div>
          </div>

          {isPlanningRole && (
          <div className={`panel ${selectedPanel === 'panel-planning-dash' ? 'active' : ''}`} id="panel-planning-dash">
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">City Planning Dashboard</div>
                  <div className="page-sub">Recorded cemetery capacity and section inventory</div>
                </div>
                <div className="page-actions">
                  {isDrawingMode ? <button className="btn btn-ghost" onClick={cancelSectionDrawing}>Cancel Drawing</button> : <button className="btn btn-primary" onClick={chooseSectionMethod}>+ Draw New Section</button>}
                </div>
              </div>

              <CPDOAnalytics inventoryRows={cpdoInventoryRows} sectionsByCemetery={planningSectionsByCemetery} />

              <div style={{ margin: '8px 0 14px' }}>
                <div className="page-title" style={{ fontSize: 18 }}>Planning workspace</div>
                <div className="page-sub">Alerts, map actions, and recently updated sections</div>
              </div>
              <div className="cpdo-utility-grid">
                <div className="planning-zoning-column">
                <div className="planning-card">
                  <div className="planning-card-title">Zoning Alerts</div>
                  <div className="planning-card-subtitle">Areas requiring expansion or maintenance planning</div>
                  <div className="planning-alert-list">
                    {colOccupancyPct > 80 && (
                      <div style={{ padding: 12, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13 }}>
                        <strong>High Niche Occupancy:</strong> {activeAdminCemetery === 'old' ? 'Old' : 'New'} Cemetery apartment niches are {colOccupancyPct}% occupied ({colTotalOccupied} of {colTotalSlots}). Review available capacity.
                      </div>
                    )}
                    {activeCemeterySections.filter(zone => (zone.properties?.occupancy_percentage || 0) >= 80).map(zone => <div key={`capacity-${zone.id}`} style={{ padding: 12, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 'var(--radius)', color: 'var(--amber)', fontSize: 13 }}><strong>{zone.properties?.zone_code || zone.properties?.name}:</strong> {zone.properties?.occupancy_percentage}% of recorded ground plots are occupied.</div>)}
                    {activeCemeterySections.length === 0 && colOccupancyPct <= 80 && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>No database-backed zoning alerts.</div>}
                  </div>
                </div>

                <div className="planning-card">
                  <div className="planning-card-title">Quick GIS Actions</div>
                  <div className="planning-card-subtitle">Common spatial planning workflows</div>
                  <div className="quick-gis-actions">
                    <button className="quick-gis-action-btn" onClick={chooseSectionMethod} disabled={isDrawingMode}>
                      <span className="quick-gis-action-icon" aria-hidden="true">+</span>
                      <span>{isDrawingMode ? 'Drawing New Section...' : 'Draw New Section'}</span>
                    </button>
                    <button className="quick-gis-action-btn" onClick={() => showToast('Plot group registration workflow coming soon.', 'info')}>
                      <span className="quick-gis-action-icon" aria-hidden="true">#</span>
                      <span>Register New Plot Group</span>
                    </button>
                    <button className="quick-gis-action-btn export" onClick={() => showToast('GIS shapefile export hook coming soon.', 'info')}>
                      <span className="quick-gis-action-icon" aria-hidden="true">v</span>
                      <span>Export GIS Shapefile</span>
                    </button>
                  </div>
                </div>
              </div>

                <div className="planning-card planning-activity-card">
                  <div className="planning-card-title">Recently Updated Sections</div>
                  <div className="planning-card-subtitle">Saved section records sorted by last update</div>
                  <div className="planning-activity-list">
                    {recentGisActivity.map((item) => (
                      <div key={`${item.label}-${item.time}`} className="planning-activity-item">
                        <span className={`planning-activity-dot ${item.tone}`} />
                        <div>
                          <div className="planning-activity-title">{item.label}</div>
                          <div className="planning-activity-detail">{item.detail}</div>
                          <div className="planning-activity-time">{item.time}</div>
                        </div>
                      </div>
                    ))}
                    {recentGisActivity.length === 0 && <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>No saved sections yet.</div>}
                  </div>
                </div>
            </div>
          </div>
          </div>
          )}

          {isStaffRole && (
          <div className={`panel ${selectedPanel === 'panel-admin-map' ? 'active' : ''}`} id="panel-admin-map">
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <div id="admin-map" ref={adminMapContainer} style={{ width: '100%', height: '100%' }} />
              {(!staffMapReady || staffMapRenderState !== 'ready') && <MapLoadingOverlay cemetery={activeAdminCemetery} error={staffMapLoadError || (staffMapRenderState === 'error' ? 'The map layers could not be drawn. Please retry.' : '')} onRetry={() => setPlanningReloadToken(value => value + 1)} />}

              <section className="map-fab staff-map-toolbar" aria-label="Ground plot map filters" onWheel={event => event.stopPropagation()}>
                <div className="staff-map-toolbar-heading"><div><strong>Map filters</strong><span>{staffMapVisibleCount.toLocaleString()} of {staffMapPlots.length.toLocaleString()} saved plot positions</span></div>
                  <button type="button" className="staff-map-clear" title="Clear filters and search marker" aria-label="Clear map filters and search marker" onClick={() => { setStaffMapStatusFilter('all'); setStaffMapSectionFilter('all'); setStaffMapSearchTarget(null); }}>Clear</button>
                </div>
                <div className="staff-map-status-filters" role="group" aria-label="Filter plots by status">
                  {['all', 'available', 'occupied', 'maintenance'].map(status => <button type="button" key={status} className={`filter-chip ${staffMapStatusFilter === status ? 'on' : ''}`} aria-pressed={staffMapStatusFilter === status} onClick={() => setStaffMapStatusFilter(status)}>{status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}</button>)}
                </div>
                <label className="staff-map-section-select"><span>Section</span><select value={staffMapSectionFilter} onChange={event => setStaffMapSectionFilter(event.target.value)}><option value="all">All sections</option>{staffMapSections.map(section => <option key={section} value={section}>{section}</option>)}</select></label>
                <div className="staff-map-summary"><span><i className="available" />{staffMapCounts.available} available</span><span><i className="occupied" />{staffMapCounts.occupied} occupied</span><span><i className="maintenance" />{staffMapCounts.maintenance} maintenance</span></div>
              </section>

              <div className="map-action-pill">
                <button className="pill-btn compass-btn" type="button" onClick={() => {
                  if (adminMapRef.current) {
                    adminMapRef.current.flyTo(activeAdminCemetery === 'new' ? ANOTHER_CEMETERY_CENTER : CEMETERY_CENTER, 19, { animate: true, duration: 0.8 });
                  }
                }} title="Reset map view" aria-label="Reset map view">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="#ef4444" d="M12 2 L8 12 L12 12 Z" />
                    <path fill="#dc2626" d="M12 2 L16 12 L12 12 Z" />
                    <path fill="#9ca3af" d="M12 22 L8 12 L12 12 Z" />
                    <path fill="#6b7280" d="M12 22 L16 12 L12 12 Z" />
                  </svg>
                </button>
                <button className="pill-btn location-btn" type="button" onClick={() => {
                  if (!adminMapRef.current) return;
                  if (!navigator.geolocation) {
                    showToast('Geolocation is not supported by your browser.', 'error');
                    return;
                  }
                  navigator.geolocation.getCurrentPosition((position) => {
                    const { latitude, longitude } = position.coords;
                    adminMapRef.current.flyTo([latitude, longitude], 17, { animate: true, duration: 0.9 });
                    L.circle([latitude, longitude], {
                      radius: 60,
                      color: 'rgba(22,135,201,0.8)',
                      fillColor: 'rgba(22,135,201,0.18)',
                      weight: 2,
                    }).addTo(adminMapRef.current);
                  }, () => {
                    showToast('Unable to determine location. Please allow location access.', 'error');
                  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
                }} title="My location" aria-label="Show my location">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="cemetery-switcher-container" onWheel={event => event.stopPropagation()}>
                <button type="button" className={`btn ${activeAdminCemetery === 'old' ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={activeAdminCemetery === 'old'} onClick={() => { setActiveAdminCemetery('old'); setStaffMapStatusFilter('all'); setStaffMapSectionFilter('all'); if (adminMapRef.current) adminMapRef.current.flyTo(CEMETERY_CENTER, 19, { animate: true, duration: 0.8 }); }}>Old Cemetery</button>
                <button type="button" className={`btn ${activeAdminCemetery === 'new' ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={activeAdminCemetery === 'new'} onClick={() => { setActiveAdminCemetery('new'); setStaffMapStatusFilter('all'); setStaffMapSectionFilter('all'); if (adminMapRef.current) adminMapRef.current.flyTo(ANOTHER_CEMETERY_CENTER, 19, { animate: true, duration: 0.8 }); }}>New Cemetery</button>
              </div>

              <details className="legend-fab staff-map-legend">
                <summary className="staff-map-legend-heading"><span>Map legend</span><small>Status & occupancy</small></summary>
                <div className="legend-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="legend-dot" style={{ background: PLOT_STATUS_COLORS.available }} />Available
                  </div>
                  <span className="legend-count">{staffMapCounts.available}</span>
                </div>
                <div className="legend-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="legend-dot" style={{ background: PLOT_STATUS_COLORS.occupied }} />Occupied
                  </div>
                  <span className="legend-count">{staffMapCounts.occupied}</span>
                </div>
                <div className="legend-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="legend-dot" style={{ background: PLOT_STATUS_COLORS.maintenance }} />Maintenance</div>
                  <span className="legend-count">{staffMapCounts.maintenance}</span>
                </div>
                {staffMapUnrecordedCount > 0 && <div className="legend-row"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="legend-dot" style={{ background: '#CBD5E1' }} />Unrecorded status</div><span className="legend-count">{staffMapUnrecordedCount}</span></div>}
                <div className="staff-map-legend-total">{staffMapPlots.length.toLocaleString()} ground plots total</div>
                <div className="staff-map-section-legend">
                  <div className="staff-map-section-legend-title">Section occupancy</div>
                  <div className="staff-map-section-legend-note">Color shows occupied share of each section.</div>
                  {[
                    [SECTION_UTILIZATION_COLORS.low, '0–49% · Low'],
                    ['#64748b', '50–79% · Moderate'],
                    ['#dc3545', '80–100% · High'],
                  ].map(([color, label]) => <div className="staff-map-section-legend-row" key={label}><i className="staff-map-section-swatch" style={{ background: color }} />{label}</div>)}
                </div>
              </details>
            </div>
          </div>
          )}
          {(!(isMayorRole || isStaffRole) || selectedPanel === 'panel-columbarium' || isNicheTransferOpen) && (
          <div className={`panel ${selectedPanel === 'panel-columbarium' ? 'active' : ''}`} id="panel-columbarium">
            <div className="scroll-panel">
              {isNicheTransferOpen && selectedSlotDetails && (
                <div role="status" style={{ margin: '16px 0', padding: 16, border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)', background: 'rgba(22,135,201,.08)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Choose a destination niche</div>
                  <div style={{ marginTop: 5, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Select an available niche for {selectedSlotDetails.name}. Source: {selectedSlotDetails.id} · {selectedSlotDetails.cemeteryMap === 'new' ? 'New' : 'Old'} Cemetery.
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                      setIsNicheTransferOpen(false);
                      setIsSlotModalOpen(true);
                    }}>Cancel Transfer</button>
                  </div>
                </div>
              )}
              <div className="page-hdr">
                <div>
                  <div className="page-title">{isNicheTransferOpen ? 'Select Destination Niche' : 'Apartment Niches'}</div>
                  <div className="page-sub">{isNicheTransferOpen ? 'Click an available niche in the layout below to move the occupant there.' : 'Apartment niches follow the active CPDO zoning map.'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <button className={`btn btn-sm ${activeColumbariumMap === 'old' ? 'btn-primary' : 'btn-ghost'}`} style={activeColumbariumMap === 'old' ? {boxShadow: 'var(--shadow-sm)'} : { border: 'none', background: 'transparent' }} onClick={() => {
                    setActiveColumbariumMap('old');
                    const opts = zonedSectionOptionsByCemetery.old || [];
                    const sectionsWithSpace = opts.filter(section => columbariumSlots.some(slot => slot.cemeteryMap === 'old' && normalizeSectionName(slot.section) === normalizeSectionName(section) && slot.status === 'available'));
                    if (opts.length > 0) setColumbariumSection(isNicheTransferOpen ? (sectionsWithSpace[0] || opts[0]) : opts[0]);
                  }}>Old Cemetery Map</button>
                  <button className={`btn btn-sm ${activeColumbariumMap === 'new' ? 'btn-primary' : 'btn-ghost'}`} style={activeColumbariumMap === 'new' ? {boxShadow: 'var(--shadow-sm)'} : { border: 'none', background: 'transparent' }} onClick={() => {
                    setActiveColumbariumMap('new');
                    const opts = zonedSectionOptionsByCemetery.new || [];
                    const sectionsWithSpace = opts.filter(section => columbariumSlots.some(slot => slot.cemeteryMap === 'new' && normalizeSectionName(slot.section) === normalizeSectionName(section) && slot.status === 'available'));
                    if (opts.length > 0) setColumbariumSection(isNicheTransferOpen ? (sectionsWithSpace[0] || opts[0]) : opts[0]);
                  }}>New Cemetery Map</button>
                </div>
              </div>

              {cemeterySectionsError && <div role="alert" className="cpdo-records-error">
                <p>{cemeterySectionsError} The section list may be incomplete.</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanningReloadToken(value => value + 1)}>Retry sections</button>
              </div>}
              <NicheSearch slots={zonedColumbariumSlots} onChoose={slot => {
                setActiveColumbariumMap(slot.cemeteryMap);
                setColumbariumSection(slot.section);
                setColumbariumFilter('all');
                setNicheFocusTarget({ ...slot });
              }} />
              <div className="columbarium-label-line"> 
                <div className="columbarium-line" />
                <div className="columbarium-line-label">Select Section</div>
                <div className="columbarium-line" />
              </div>

              <div className="columbarium-control-row">
                <div className="niche-section-buttons" role="group" aria-label="Select cemetery section">
                  {sectionOptions.map(section => (
                    <button type="button" key={section} className={`btn btn-sm ${columbariumSection === section ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={columbariumSection === section} onClick={() => setColumbariumSection(section)}>
                      <strong>{section}</strong>
                      <small>{['available', 'occupied', 'maintenance'].map(status => `${sectionStatusCounts.get(normalizeSectionName(section))?.[status] || 0} ${status}`).join(' · ')}</small>
                    </button>
                  ))}
                  {!sectionOptions.length && <span>No sections loaded for this cemetery.</span>}
                </div>
                <div className="columbarium-section-title">{columbariumSection}</div>
                {!isNicheTransferOpen && <div className="columbarium-filter-row">
                  <span className={`filter-chip ${columbariumFilter === 'all' ? 'on' : ''}`} onClick={() => handleColumbariumFilterChange('all')}>All</span>
                  <span className={`filter-chip ${columbariumFilter === 'occupied' ? 'on' : ''}`} onClick={() => handleColumbariumFilterChange('occupied')}>Occupied</span>
                  <span className={`filter-chip ${columbariumFilter === 'available' ? 'on' : ''}`} onClick={() => handleColumbariumFilterChange('available')}>Available</span>
                </div>}
              </div>

              <ApartmentNicheWall groups={columbariumSlotGroups} floors={floorLabels} slots={columbariumSlots} section={columbariumSection} cemetery={activeColumbariumMap} filter={isNicheTransferOpen ? 'available' : columbariumFilter} doubleSided={isDoubleSidedLayout} slotsPerSide={slotsPerSide} normalizeSectionName={normalizeSectionName} onSelect={isNicheTransferOpen ? handleNicheTransferDestination : handleSlotClick} focusTarget={nicheFocusTarget} selectableStatus={isNicheTransferOpen ? 'available' : undefined} />
            </div>
          </div>
          )}
          <div className={`panel ${selectedPanel === 'panel-columbarium-records' ? 'active' : ''}`} id="panel-columbarium-records">
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">{isMayorRole ? 'Grave Records' : 'Niche Records'}</div>
                  <div className="page-sub">{isMayorRole ? 'Review apartment niche records and availability' : 'Find burial records and open their apartment niche location'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 24 }}>
                <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <button className={`btn btn-sm ${activeColumbariumMap === 'old' ? 'btn-primary' : 'btn-ghost'}`} style={activeColumbariumMap === 'old' ? {boxShadow: 'var(--shadow-sm)'} : { border: 'none', background: 'transparent' }} onClick={() => { setActiveColumbariumMap('old'); setColumbariumPage(1); setRecordSectionFilter('All Sections'); }}>Old Cemetery Map</button>
                  <button className={`btn btn-sm ${activeColumbariumMap === 'new' ? 'btn-primary' : 'btn-ghost'}`} style={activeColumbariumMap === 'new' ? {boxShadow: 'var(--shadow-sm)'} : { border: 'none', background: 'transparent' }} onClick={() => { setActiveColumbariumMap('new'); setColumbariumPage(1); setRecordSectionFilter('All Sections'); }}>New Cemetery Map</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, gridAutoRows: 'min-content', marginBottom: 32 }}>
                <div style={{ padding: '16px', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 'var(--radius-lg)', position: 'relative' }}> 
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Available Slots</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--emerald)', marginBottom: 4 }}>{columbariumSlots.filter(s => s.status === 'available' && s.cemeteryMap === activeColumbariumMap).length}</div>
                  <div style={{ fontSize: 12, color: 'var(--emerald)' }}>Ready for assignment</div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 'var(--radius-lg)' }}> 
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Occupied Slots</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>{columbariumSlots.filter(s => s.status === 'occupied' && s.cemeteryMap === activeColumbariumMap).length}</div>
                  <div style={{ fontSize: 12, color: 'var(--red)' }}>Assigned slots</div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(22,135,201,.08)', border: '1px solid rgba(22,135,201,.2)', borderRadius: 'var(--radius-lg)' }}> 
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Total Slots</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>{columbariumSlots.filter(s => s.cemeteryMap === activeColumbariumMap).length}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)' }}>{sectionOptions.length} sections</div>
                </div>
              </div>

              <GraveRecordsTable key={activeColumbariumMap} slots={columbariumSlots} cemetery={activeColumbariumMap} getSide={getColumbariumSide} getColumn={getColumbariumDisplayCol}
                onManage={slot => handleSlotClick(slot.id, slot.floor, slot.col, slot.status, slot.name, slot.section, slot.cemeteryMap)}
                onViewNiche={slot => {
                  setActiveColumbariumMap(slot.cemeteryMap);
                  setColumbariumSection(slot.section);
                  setColumbariumFilter('all');
                  setNicheFocusTarget({ ...slot });
                  setSelectedPanel('panel-columbarium');
                }} />
            </div>
          </div>
          <div className={`panel ${selectedPanel === 'panel-mayor-dash' ? 'active' : ''}`} id="panel-mayor-dash">
            <div className="scroll-panel mayor-dashboard-content">
              <div className="page-hdr">
                <div>
                  <div className="page-title">Executive Dashboard — {activeMayorCemetery === 'old' ? 'Old' : 'New'} Cemetery</div>
                  <div className="page-sub">City Mayor's Office — {activeMayorCemetery === 'old' ? 'Lucena Old Public Cemetery' : 'Lucena New Public Cemetery'}</div>
                </div>
                <div className="page-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <div role="group" aria-label="Choose cemetery dashboard" style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn ${activeMayorCemetery === 'old' ? 'btn-primary' : 'btn-ghost'}`}
                      aria-pressed={activeMayorCemetery === 'old'}
                      onClick={() => setActiveMayorCemetery('old')}
                    >Old Cemetery</button>
                    <button
                      type="button"
                      className={`btn ${activeMayorCemetery === 'new' ? 'btn-primary' : 'btn-ghost'}`}
                      aria-pressed={activeMayorCemetery === 'new'}
                      onClick={() => setActiveMayorCemetery('new')}
                    >New Cemetery</button>
                  </div>
                  <button className="btn btn-ghost" style={{ border: '1px solid var(--border)' }} onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
                </div>
              </div>
              <div className="mayor-scope-note" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12 }}>
                Applications without an assigned cemetery plot are shared in both dashboard views until a cemetery is assigned.
              </div>
              <div className="mayor-summary-grid">
                {mayorStatCards.map((card) => (
                  <div key={card.label} className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10, minHeight: '2.5em' }}>{card.label}</div>
                    <div style={{ fontSize: 34, fontWeight: 700, color: card.accent, marginBottom: 8 }}>{card.value}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{card.note}</div>
                  </div>
                ))}
              </div>
              <div className="mayor-timing-grid">
                {[
                  {
                    label: 'Approval Speed',
                    fastest: mayorProcessingMetrics.fastestApproval,
                    targetCount: mayorProcessingMetrics.approvedWithinTarget,
                    total: mayorProcessingMetrics.totalApproved,
                    milestone: 'Approved',
                    color: 'var(--emerald)',
                  },
                  {
                    label: 'Burial Completion Speed',
                    fastest: mayorProcessingMetrics.fastestBurial,
                    targetCount: mayorProcessingMetrics.completedWithinTarget,
                    total: mayorProcessingMetrics.totalCompleted,
                    milestone: 'Burial completed',
                    color: 'var(--accent)',
                  },
                ].map(metric => (
                  <div key={metric.label} className="mayor-stat-card" style={{ padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `4px solid ${metric.color}`, borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{metric.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', marginTop: 10 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Fastest from submission</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: metric.color, marginTop: 3 }}>
                          {metric.fastest ? formatElapsedDuration(metric.fastest.elapsedMs) : '—'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Within 15 min</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{metric.targetCount}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>of {metric.total}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
                      {metric.fastest
                        ? `${metric.milestone}: ${formatProcessingDate(metric.fastest.completedAt)} · ${metric.fastest.app.application_id}`
                        : `No ${metric.milestone.toLowerCase()} timing recorded yet.`}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mayor-dash-grid">
                <div className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Processed Applications — All Cemeteries</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Approved, scheduled, and assigned this year across Old and New Cemeteries</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{currentYear}</div>
                  </div>
                  <div key={activeMayorCemetery} className="mayor-trend-chart" style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 10 }}>
                    {mayorTrend.map((entry, index) => (
                      <div key={entry.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                        <div className={`mayor-trend-value ${entry.value === 0 ? 'is-empty' : ''}`} style={{ '--trend-delay': `${index * 65}ms`, fontSize: 10, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4, opacity: entry.value > 0 ? 1 : 0 }}>{entry.value}</div>
                        <div className="mayor-trend-bar" style={{ '--trend-delay': `${index * 65}ms`, width: '100%', minHeight: 4, height: `${Math.max((entry.value / maxBurials) * 120, 4)}px`, background: entry.value > 0 ? '#1687C9' : 'rgba(148,163,184,.18)', borderRadius: 4 }} />
                        <span style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>{entry.month}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div key={activeMayorCemetery} className="plot-distribution-card mayor-stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Slot Distribution</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Apartment niche occupancy breakdown</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 10px', background: 'rgba(255,255,255,.04)', borderRadius: '999px' }}>Total Slots: {mayorCemeteryColTotalSlots}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'center' }}>
                    <div className="donut-chart mayor-slots-donut" style={{ background: `conic-gradient(${mayorColGradient})` }}>
                      <div className="donut-chart-center">{mayorCemeteryColTotalSlots}</div>
                    </div>
                    <div className="donut-legend-list">
                      {columbariumDistribution.map((item) => (
                        <div key={item.label} className="donut-legend-row">
                          <span className="donut-legend-dot" style={{ background: item.color }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.value} plots</div>
                          </div>
                          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{mayorCemeteryColTotalSlots > 0 ? Math.round((item.value / mayorCemeteryColTotalSlots) * 100) : 0}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div key={activeMayorCemetery} className="mayor-analytics-grid">
                <div className="mayor-stat-card mayor-analytics-card">
                  <div className="mayor-analytics-header">
                    <div>
                      <div className="mayor-analytics-title">Application Status</div>
                      <div className="mayor-analytics-subtitle">Current workflow distribution</div>
                    </div>
                    <span className="mayor-analytics-badge">{mayorApplicationTotal} total</span>
                  </div>
                  <div className="mayor-status-layout">
                    <div className="mayor-status-donut" style={{ '--status-gradient': `conic-gradient(${mayorStatusGradient})` }} role="img" aria-label={`Application status: ${mayorStatusDistribution.map(item => `${item.label} ${item.value}`).join(', ')}`}>
                      <div><strong>{mayorApplicationTotal}</strong><span>applications</span></div>
                    </div>
                    <div className="mayor-status-legend">
                      {mayorStatusDistribution.map(item => (
                        <div className="mayor-status-row" key={item.label}>
                          <i style={{ background: item.color }} />
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mayor-stat-card mayor-analytics-card">
                  <div className="mayor-analytics-header">
                    <div>
                      <div className="mayor-analytics-title">Pending Application Aging</div>
                      <div className="mayor-analytics-subtitle">Time waiting for office action</div>
                    </div>
                    <span className="mayor-analytics-badge warning">{mayorPendingApps.length} pending</span>
                  </div>
                  <div className="mayor-aging-chart" role="img" aria-label={`Pending application aging: ${pendingAging.map(item => `${item.label} ${item.value}`).join(', ')}`}>
                    {pendingAging.map((item, index) => (
                      <div className="mayor-aging-row" key={item.label}>
                        <span>{item.label}</span>
                        <div className="mayor-aging-track">
                          <div style={{ '--aging-width': `${item.value === 0 ? 0 : Math.max(8, item.value / pendingAgingMax * 100)}%`, '--aging-color': item.color, '--aging-delay': `${index * 100}ms` }} />
                        </div>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="mayor-aging-footnote">Applications aged 15+ days are highlighted for priority review.</div>
                </div>

                <div className="mayor-stat-card mayor-analytics-card">
                  <div className="mayor-analytics-header">
                    <div>
                      <div className="mayor-analytics-title">Cemetery Capacity</div>
                      <div className="mayor-analytics-subtitle">Ground plots and apartment niches</div>
                    </div>
                    <span className="mayor-analytics-badge">{overallCapacity.total.toLocaleString()} records</span>
                  </div>
                  <div className="mayor-capacity-list">
                    {cemeteryCapacity.filter(item => item.cemetery === activeMayorCemetery).map((item, index) => (
                      <div className="mayor-capacity-row" key={item.cemetery}>
                        <div className="mayor-capacity-label">
                          <div><strong>{item.cemetery === 'old' ? 'Old Cemetery' : 'New Cemetery'}</strong><span>{item.occupied.toLocaleString()} occupied · {item.available.toLocaleString()} available</span></div>
                          <b>{item.rate}%</b>
                        </div>
                        <div className="mayor-capacity-track"><div style={{ '--capacity-width': `${item.rate}%`, '--capacity-delay': `${index * 140}ms` }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="mayor-capacity-summary">
                    <span><i className="available" />{overallCapacity.available.toLocaleString()} available</span>
                    <span><i className="occupied" />{overallCapacity.occupied.toLocaleString()} occupied/reserved</span>
                  </div>
                </div>
              </div>
              <div className="mayor-dash-grid-2 mayor-activity-grid">
                <div className="mayor-activity-column">
<div className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Today's Interviews<span className="mayor-activity-count" aria-label="Today's Interviews count">{todaysInterviews.length}</span></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Scheduled appointments for today</div>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('scheduled'); }}>View all</button>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {todaysInterviews.length > 0 ? todaysInterviews.slice(0, 5).map((app) => {
                      const timeParts = app.interview_time ? app.interview_time.split(':') : [];
                      const hour = timeParts.length > 0 ? parseInt(timeParts[0], 10) : 0;
                      const ampm = hour >= 12 ? 'PM' : 'AM';
                      const formattedHour = hour % 12 || 12;
                      const formattedTime = timeParts.length > 1 ? `${formattedHour}:${timeParts[1]} ${ampm}` : '--:--';
                      
                      return (
                      <div key={app.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,.05)', minWidth: 0 }}>
                        <div style={{ width: 44, height: 44, borderRadius: '8px', background: 'rgba(16,185,129,.15)', color: 'var(--emerald)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{formattedHour}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginTop: 2 }}>{ampm}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.applicant_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>For: {app.deceased_name}</div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--emerald)' }}>{formattedTime}</div>
                          <div style={{ marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px' }}>📍 {app.interview_location || 'Office'}</div>
                        </div>
                      </div>
                    )}) : (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No interviews scheduled for today.</div>
                    )}
                  </div>
                </div>
<div className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Transfer Plot Requests<span className="mayor-activity-count" aria-label="Transfer Plot Requests count">{dashboardTransferRequests.length}</span></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Review plot transfers and reassignments</div>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('transfer'); }}>View all</button>
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {dashboardTransferRequests.length > 0 ? dashboardTransferRequests.slice(0, 5).map(req => (
                      <div key={req.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,.05)', minWidth: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.user}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>For: {req.deceased}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'rgba(25,135,101,.15)', borderRadius: '4px', padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          Transfer
                        </span>
                      </div>
                    )) : (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No pending transfer requests.</div>
                    )}
                  </div>
                </div>
                </div>
                <div className="mayor-activity-column">
<div className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Pending Applications<span className="mayor-activity-count" aria-label="Pending Applications count">{mayorPendingApps.length}</span></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Requires mayor review and approval</div>
                    </div>
                  <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('pending'); }}>View all</button>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                  {mayorPendingApps.length > 0 ? mayorPendingApps.slice(0, 5).map((app) => (
                      <div key={app.id} className="mayor-application-record" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,.05)', minWidth: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.applicant_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>For: {app.deceased_name} ({app.deceased_age || '?'} / {app.deceased_gender === 'M' ? 'M' : app.deceased_gender === 'F' ? 'F' : 'O'})</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>📍 {app.applicant_address || '—'} • {new Date(app.created_at).toLocaleDateString()}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber)', background: 'rgba(245,158,11,.15)', borderRadius: '4px', padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {app.status_display || 'Review'}
                        </span>
                      </div>
                  )) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No pending applications.</div>
                  )}
                  </div>
                </div>
<div className="mayor-stat-card" style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Recently Approved<span className="mayor-activity-count" aria-label="Recently Approved count">{dashboardApproved.length}</span></div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Applications ready for assignment</div>
                  </div>
                  <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => { setSelectedPanel('panel-approvals'); setAppTab('approved'); }}>View all</button>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {dashboardApproved.length > 0 ? dashboardApproved.slice(0, 5).map((app) => (
                    <div key={app.id} className="mayor-application-record" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,.05)', minWidth: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--emerald)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.applicant_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>For: {app.deceased_name}</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--emerald)', background: 'rgba(16,185,129,.15)', borderRadius: '4px', padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {app.status_display}
                      </span>
                    </div>
                  )) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No recently approved applications.</div>
                  )}
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
          <div className={`panel ${selectedPanel === 'panel-approvals' ? 'active' : ''}`} id="panel-approvals">
            <div className="scroll-panel applications-content">
              {applicationSearch.trim() && <div role="status" style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>
                Showing applications matching "{applicationSearch}". <button className="btn btn-ghost btn-sm" onClick={() => changeApplicationSearch('')}>Clear search</button>
              </div>}
              <div className="page-hdr">
                <div>
                  <div className="applications-eyebrow">BURIAL APPLICATIONS</div>
                  <div className="page-title">Applications</div>
                  <div className="page-sub">Review and approve burial applications from the public</div>
                </div>
                <div className="applications-header-note">Review documents, schedule interviews, and assign a resting place.</div>
              </div>
              <div className="applications-toolbar">
                <label className="applications-search"><span>Find an application</span><input type="search" placeholder="Applicant, deceased name, or application ID" value={applicationSearch} onChange={e => changeApplicationSearch(e.target.value)} /></label>
                <label><span>Submitted from</span><input type="date" value={applicationFilters.from} max={applicationFilters.to || undefined} onChange={e => changeApplicationFilters({ from: e.target.value })} /></label>
                <label><span>Submitted to</span><input type="date" value={applicationFilters.to} min={applicationFilters.from || undefined} onChange={e => changeApplicationFilters({ to: e.target.value })} /></label>
                <label><span>Sort by submission</span><select value={applicationFilters.order} onChange={e => changeApplicationFilters({ order: e.target.value })}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
                {(applicationSearch || applicationFilters.from || applicationFilters.to) && <button className="btn btn-ghost btn-sm" onClick={() => { changeApplicationSearch(''); changeApplicationFilters({ from: '', to: '' }); }}>Clear filters</button>}
                {applicationFilters.from && applicationFilters.to && applicationFilters.from > applicationFilters.to && <div role="alert" className="applications-filter-error">The start date must be on or before the end date.</div>}
              </div>
              <nav className="applications-tabs" aria-label="Application stages">
                <button className={`btn btn-sm ${appTab === 'pending' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'pending' ? 'page' : undefined} onClick={() => setAppTab('pending')} style={{ whiteSpace: 'nowrap' }}>Pending ({filteredPendingApps.length})</button>
                <button className={`btn btn-sm ${appTab === 'approved' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'approved' ? 'page' : undefined} onClick={() => setAppTab('approved')} style={{ whiteSpace: 'nowrap' }}>For Scheduling ({filteredApprovedApps.length})</button>
                <button className={`btn btn-sm ${appTab === 'scheduled' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'scheduled' ? 'page' : undefined} onClick={() => setAppTab('scheduled')} style={{ whiteSpace: 'nowrap' }}>Interview / Assignment ({filteredScheduledApps.length})</button>
                <button className={`btn btn-sm ${appTab === 'completed' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'completed' ? 'page' : undefined} onClick={() => setAppTab('completed')} style={{ whiteSpace: 'nowrap' }}>Finalized ({filteredCompletedApps.length})</button>
                <button className={`btn btn-sm ${appTab === 'transfer' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'transfer' ? 'page' : undefined} onClick={() => setAppTab('transfer')} style={{ whiteSpace: 'nowrap' }}>Transfer Plots ({filteredAllTransferRequests.length})</button>
                <button className={`btn btn-sm ${appTab === 'cancelled' ? 'btn-primary' : 'btn-ghost'}`} aria-current={appTab === 'cancelled' ? 'page' : undefined} style={{ whiteSpace: 'nowrap', ...(appTab !== 'cancelled' ? { color: 'var(--red)' } : {}) }} onClick={() => setAppTab('cancelled')}>Cancelled / Rejected ({filteredCancelledApps.length})</button>
              </nav>
              <div className="applications-list-heading"><div><h2>{({ pending: 'Awaiting review', approved: 'Ready for scheduling', scheduled: 'Interviews & plot assignment', completed: 'Finalized applications', transfer: 'Plot transfer requests', cancelled: 'Cancelled & rejected' })[appTab]}</h2><p>{({ pending: 'Open Review Docs to check requirements. Use checkboxes only for bulk selection.', approved: 'Set an interview schedule for applications ready to proceed.', scheduled: 'Review the appointment details before assigning a cemetery plot.', completed: 'Review approval and burial completion milestones.', transfer: 'Review the requested location and reply to the applicant.', cancelled: 'Review the reason before moving selected records to the archive.' })[appTab]}</p></div><span>{currentApplicationList.length} {currentApplicationList.length === 1 ? 'record' : 'records'}</span></div>
                  <div className="applications-list" data-stage={appTab}>
            {appTab === 'pending' && filteredPendingApps.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>{(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching applications in this tab.' : 'No pending applications.'}</div>
            )}
            {appTab === 'pending' && filteredPendingApps.length > 0 && (
              <div className="applications-selection-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  <input 
                    type="checkbox" 
                    checked={paginatedApplications.pending.length > 0 && paginatedApplications.pending.every(app => selectedPendingApps.includes(app.id))}
                    ref={node => { if (node) node.indeterminate = selectedPendingApps.length > 0 && !paginatedApplications.pending.every(app => selectedPendingApps.includes(app.id)); }} 
                    onChange={(e) => {
                      if (e.target.checked) setSelectedPendingApps(paginatedApplications.pending.map(a => a.id));
                      else setSelectedPendingApps([]);
                    }} 
                  />
                  Select this page ({paginatedApplications.pending.length})
                </label>
                {selectedPendingApps.length > 0 && (
                  <button className="btn btn-sm btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={handleBulkRejectPending}>Reject & Archive {selectedPendingApps.length}</button>
                )}
              </div>
            )}
            {appTab === 'pending' && paginatedApplications.pending.map((app) => {
              const isSelected = selectedPendingApps.includes(app.id);
              return (
              <div key={app.id} className="app-card-wrapper" style={{ background: isSelected ? 'rgba(25,135,101,.05)' : 'var(--bg-card)', border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)' }} data-selected={isSelected}>
                <input type="checkbox" aria-label={`Select application ${app.application_id}`} checked={isSelected} onChange={() => setSelectedPendingApps(prev => prev.includes(app.id) ? prev.filter(id => id !== app.id) : [...prev, app.id])} />
                <div className="responsive-app-grid" style={{ flex: 1 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{app.application_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={app.applicant_address}>📍 {app.applicant_address || 'No address provided'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Date Submitted</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatProcessingDate(app.submitted_at || app.created_at)}</div>
                        {app.approved_at && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--emerald)' }}>Approved {formatProcessingDate(app.approved_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.approved_at))}</div>}
                        {app.completed_at && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>Burial completed {formatProcessingDate(app.completed_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.completed_at))}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Deceased</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Age & Gender</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_age === '' ? '—' : app.deceased_age ?? '—'} / {app.deceased_gender === 'M' ? 'Male' : app.deceased_gender === 'F' ? 'Female' : app.deceased_gender === 'O' ? 'Other' : '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Review Status</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', background: 'rgba(245,158,11,.15)', borderRadius: '999px', padding: '4px 10px' }}>{app.status_display}</span>
                      </div>
                    </div>
                  <div className="app-card-actions-wrapper"><span className="application-waiting">{applicationWaitingLabel(app)}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleOpenNotifyModal(app)} style={{ padding: '6px 12px', fontSize: 11 }}>Notify</button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleViewDocuments(app)} style={{ padding: '6px 12px', fontSize: 11 }}>Review Documents</button>
                    </div>
                  </div>
            )})}
            {appTab === 'approved' && filteredApprovedApps.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>{(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching applications in this tab.' : 'No applications awaiting scheduling.'}</div>
                )}
            {appTab === 'approved' && paginatedApplications.approved.map((app) => (
                  <div key={app.id} className="app-card-wrapper">
                    <div className="responsive-app-grid">
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{app.application_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={app.applicant_address}>📍 {app.applicant_address || 'No address provided'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Date Submitted</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatProcessingDate(app.submitted_at || app.created_at)}</div>
                        {app.approved_at && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--emerald)' }}>Approved {formatProcessingDate(app.approved_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.approved_at))}</div>}
                        {app.completed_at && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>Burial completed {formatProcessingDate(app.completed_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.completed_at))}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Deceased</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Age & Gender</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_age === '' ? '—' : app.deceased_age ?? '—'} / {app.deceased_gender === 'M' ? 'Male' : app.deceased_gender === 'F' ? 'Female' : app.deceased_gender === 'O' ? 'Other' : '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Review Status</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--emerald)', background: 'rgba(16,185,129,.15)', borderRadius: '999px', padding: '4px 10px' }}>{app.status_display}</span>
                      </div>
                    </div>
                    <div className="app-card-actions-wrapper">
                      <button className="btn btn-primary btn-sm" onClick={() => handleOpenInterviewModal(app)}>Schedule Interview</button>
                    </div>
                  </div>
                ))}
            {appTab === 'scheduled' && filteredScheduledApps.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>{(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching applications in this tab.' : 'No applications awaiting interview or assignment.'}</div>
                )}
                {appTab === 'scheduled' && paginatedApplications.scheduled.map((app) => (
                  <div key={app.id} className="app-card-wrapper">
                    <div className="responsive-app-grid">
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{app.application_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={app.applicant_address}>📍 {app.applicant_address || 'No address provided'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Date Submitted</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatProcessingDate(app.submitted_at || app.created_at)}</div>
                        {app.approved_at && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--emerald)' }}>Approved {formatProcessingDate(app.approved_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.approved_at))}</div>}
                        {app.completed_at && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>Burial completed {formatProcessingDate(app.completed_at)} · {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.completed_at))}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Deceased</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Age & Gender</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_age === '' ? '—' : app.deceased_age ?? '—'} / {app.deceased_gender === 'M' ? 'Male' : app.deceased_gender === 'F' ? 'Female' : app.deceased_gender === 'O' ? 'Other' : '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Review Status</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--emerald)', background: 'rgba(16,185,129,.15)', borderRadius: '999px', padding: '4px 10px' }}>{app.status_display}</span>
                      </div>
                    </div>
                    <div className="app-card-actions-wrapper application-appointment-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--emerald)', fontWeight: 600, marginBottom: 4 }}>✓ Interview Scheduled</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                          {app.interview_date ? `${app.interview_date} at ${app.interview_time}` : 'Date pending'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleOpenInterviewModal(app)}>Reschedule</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => handleCancelInterview(app)}>Cancel Appointment</button>
                        <div style={{ display: 'flex', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                          <button className="btn btn-primary btn-sm" style={{ background: 'var(--accent)', border: 'none', borderRadius: 0, paddingRight: 8 }} onClick={() => handleAutoAssignClick(app, 'old')}>Assign (Old Map)</button>
                          <div style={{ width: 1, background: 'rgba(255,255,255,0.2)' }} />
                          <button className="btn btn-primary btn-sm" style={{ background: 'var(--accent)', border: 'none', borderRadius: 0, paddingLeft: 8 }} onClick={() => handleAutoAssignClick(app, 'new')}>Assign (New Map)</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {appTab === 'completed' && filteredCompletedApps.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching finalized applications.' : 'No approved and assigned applications yet.'}
                  </div>
                )}
                {appTab === 'completed' && paginatedApplications.completed.map(app => (
                  <div key={app.id} className="app-card-wrapper">
                    <div className="responsive-app-grid" style={{ flex: 1 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{app.application_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Deceased</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Date Submitted</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatProcessingDate(app.submitted_at || app.created_at)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Approved</div>
                        <div style={{ fontSize: 12, color: 'var(--emerald)' }}>{app.approved_at ? formatProcessingDate(app.approved_at) : 'Approval time not recorded'}</div>
                        {app.approved_at && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>After {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.approved_at))}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Burial Completed</div>
                        <div style={{ fontSize: 12, color: 'var(--accent)' }}>{app.completed_at ? formatProcessingDate(app.completed_at) : 'Not yet confirmed'}</div>
                        {app.completed_at && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>After {formatElapsedDuration(getElapsedMilliseconds(app.submitted_at || app.created_at, app.completed_at))}</div>}
                      </div>
                    </div>
                  </div>
                ))}
                {appTab === 'cancelled' && filteredCancelledApps.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>{(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching applications in this tab.' : 'No cancelled applications.'}</div>
                )}
                {appTab === 'cancelled' && filteredCancelledApps.length > 0 && (
                  <div className="applications-selection-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      <input 
                        type="checkbox" 
                        checked={paginatedApplications.cancelled.length > 0 && paginatedApplications.cancelled.every(app => selectedCancelledApps.includes(app.id))}
                    ref={node => { if (node) node.indeterminate = selectedCancelledApps.length > 0 && !paginatedApplications.cancelled.every(app => selectedCancelledApps.includes(app.id)); }} 
                        onChange={(e) => {
                          if (e.target.checked) setSelectedCancelledApps(paginatedApplications.cancelled.map(a => a.id));
                          else setSelectedCancelledApps([]);
                        }} 
                      />
                      Select this page ({paginatedApplications.cancelled.length})
                    </label>
                    {selectedCancelledApps.length > 0 && (
                      <button className="btn btn-sm btn-primary" onClick={handleArchiveCancelledApps}>Move {selectedCancelledApps.length} to Archive</button>
                    )}
                  </div>
                )}
                {appTab === 'cancelled' && paginatedApplications.cancelled.map((app) => {
                  const demoReasons = JSON.parse(localStorage.getItem('gravetrak_demo_reasons') || '{}');
                  const cancelReason = demoReasons[String(app.id)] || 'No reason provided';
                  const isSelected = selectedCancelledApps.includes(app.id);
                  return (
                  <div key={app.id} className="app-card-wrapper" style={{ background: isSelected ? 'rgba(25,135,101,.05)' : 'var(--bg-card)', border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)' }} data-selected={isSelected}>
                    <input type="checkbox" aria-label={`Select application ${app.application_id}`} checked={isSelected} onChange={() => setSelectedCancelledApps(prev => prev.includes(app.id) ? prev.filter(id => id !== app.id) : [...prev, app.id])} />
                    <div className="responsive-app-grid">
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{app.application_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={app.applicant_address}>📍 {app.applicant_address || 'No address provided'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Date Submitted</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{new Date(app.created_at).toLocaleDateString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Deceased</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.deceased_name}</div>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Cancellation Reason</div>
                        <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cancelReason}>{cancelReason}</div>
                      </div>
                    </div>
                  </div>
                )})}
                
                {appTab === 'transfer' && filteredAllTransferRequests.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>{(applicationSearch.trim() || applicationFilters.from || applicationFilters.to) ? 'No matching applications in this tab.' : 'No pending transfer plot requests.'}</div>
                )}
                {appTab === 'transfer' && paginatedApplications.transfer.map(req => {
                  const detail = req.message.replace(/TRANSFER PLOT REQUEST\n/, '');
                  
                  return (
                    <div key={req.id} className="app-card-wrapper" style={{ cursor: 'default' }}>
                      <div className="responsive-app-grid" style={{ flex: 1 }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{req.appId || `SRQ-${req.id.toString().slice(-6)}`}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{req.user}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Date: {req.date}</div>
                        </div>
                        <div style={{ gridColumn: 'span 3' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Request Type</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>Plot Transfer</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                            <strong>For Deceased:</strong> {req.deceased}<br/>
                            {req.currentLocation && <><strong style={{ color: 'var(--text-primary)' }}>Current Location:</strong> {req.currentLocation}<br/></>}
                            {detail}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Status</div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', background: 'rgba(245,158,11,.15)', borderRadius: '999px', padding: '4px 10px' }}>Pending Review</span>
                        </div>
                      </div>
                      <div className="app-card-actions-wrapper">
                        <button className="btn btn-ghost btn-sm" onClick={() => { setViewSupportMsg(req); }}>Reply / Review</button>
                      </div>
                    </div>
                  );
                })}
                {currentApplicationList.length > 0 && <div className="admin-app-pagination">
                  <span>Showing {(currentApplicationPage - 1) * applicationPageSize + 1}–{Math.min(currentApplicationPage * applicationPageSize, currentApplicationList.length)} of {currentApplicationList.length} · Page {currentApplicationPage} of {currentApplicationPages}</span>
                  <div>
                    <button className="btn btn-ghost btn-sm" disabled={currentApplicationPage === 1} onClick={() => setCurrentApplicationPage(currentApplicationPage - 1)}>Previous</button>
                    <button className="btn btn-ghost btn-sm" disabled={currentApplicationPage === currentApplicationPages} onClick={() => setCurrentApplicationPage(currentApplicationPage + 1)}>Next</button>
                  </div>
                </div>}
              </div>
            </div>
          </div>

          <div className={`panel ${selectedPanel === 'panel-reports' ? 'active' : ''}`} id="panel-reports">
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">{role === 'mayor' ? "Received Reports" : "Cemetery Reports"}</div>
                  <div className="page-sub">{role === 'mayor' ? "Review operations reports from the Cemetery Admin." : "Generate and submit operations reports to the Mayor's Office."}</div>
                </div>
                {role === 'admin' && (
                  <div className="page-actions"><button className="btn btn-primary" onClick={() => setIsReportModalOpen(true)}>+ Generate Analytics Report</button></div>
                )}
              </div>

              <div style={{ padding: 16, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                  <div className="field" style={{ minWidth: 170, margin: 0 }}><label className="field-label" htmlFor="report-from">From</label><input id="report-from" className="field-input" type="date" max={reportTo && reportTo < reportToday ? reportTo : reportToday} value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></div>
                  <div className="field" style={{ minWidth: 170, margin: 0 }}><label className="field-label" htmlFor="report-to">To</label><input id="report-to" className="field-input" type="date" min={reportFrom || undefined} max={reportToday} value={reportTo} onChange={e => setReportTo(e.target.value)} /></div>
                  <button className="btn btn-primary" onClick={applyReportPeriod} disabled={reportAnalyticsLoading || Boolean((reportFrom && reportTo) && (reportFrom > reportTo || reportTo > reportToday))}>Generate Report</button>
                  <button className="btn btn-ghost" onClick={exportSelectedReport} disabled={reportExporting || !reportReady}>{reportExporting ? 'Preparing Excel...' : 'Export Excel'}</button>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Leave the calendar empty for an Overall report, or choose past dates and select Generate Report. Future dates are unavailable.</div>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)' }}>Showing records from:</strong> {activeReportPeriodLabel}</div>
              </div>

              {reportAnalyticsError && <div className="application-error" style={{ marginBottom: 16 }}>{reportAnalyticsError}</div>}
              {reportAnalyticsLoading && <div style={{ padding: 20, color: 'var(--text-muted)' }}>Generating report…</div>}
              {reportAnalytics && !reportAnalyticsLoading && (isStaffRole ? <CemeteryReports key={`${reportAnalytics.from}:${reportAnalytics.to}`} report={reportAnalytics} /> : <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Report Summary</div>
                <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {(role === 'mayor' ? [
                    ['Applications Submitted', reportAnalytics.metrics.applications_submitted],
                    ['Applications Approved', reportAnalytics.metrics.applications_approved],
                    ['Applications Rejected', reportAnalytics.metrics.applications_rejected],
                    ['Documents Verified', reportAnalytics.metrics.documents_verified],
                    ['Appointments Scheduled', reportAnalytics.metrics.appointments_scheduled],
                  ] : [
                    ['Burials During Period', reportAnalytics.metrics.burials],
                    ['Applications Approved', reportAnalytics.metrics.applications_approved],
                    ['Applications Rejected', reportAnalytics.metrics.applications_rejected],
                    ['Appointments Scheduled', reportAnalytics.metrics.appointments_scheduled],
                    ['Applications Submitted', reportAnalytics.metrics.applications_submitted],
                  ]).map(([label, value], index) => {
                    const colors = ['var(--accent)', 'var(--emerald)', 'var(--red)', 'var(--violet)', 'var(--amber)'];
                    return <div className="stat-card" key={label} style={{ padding: '16px 18px', minHeight: 104, background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: `3px solid ${colors[index % colors.length]}`, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
                      <div className="stat-label" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{label}</div>
                      <div className="stat-value" style={{ marginTop: 9, fontSize: 28, lineHeight: 1, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
                    </div>;
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
                  <div style={{ padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Activity Comparison</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, marginBottom: 18 }}>{activeReportPeriodLabel}</div>
                    <div style={{ display: 'grid', gap: 13 }}>
                      {reportActivityChartItems.map(item => (
                        <div key={item.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5, fontSize: 12 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                            <strong style={{ color: 'var(--text-primary)' }}>{item.value}</strong>
                          </div>
                          <div style={{ height: 9, overflow: 'hidden', borderRadius: 999, background: 'rgba(255,255,255,.06)' }}>
                            <div role="img" aria-label={`${item.label}: ${item.value}`} style={{ width: `${item.value === 0 ? 0 : Math.max(5, (item.value / reportActivityMax) * 100)}%`, height: '100%', borderRadius: 999, background: item.color, transition: 'width 300ms ease' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Cemetery Space Overview</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Current availability as of today</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 24, paddingTop: 18 }}>
                      <div role="img" aria-label={`${reportOccupancyPercent}% occupied`} style={{ width: 138, height: 138, borderRadius: '50%', background: `conic-gradient(var(--red) 0 ${reportOccupancyPercent}%, var(--emerald) ${reportOccupancyPercent}% 100%)`, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
                        <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--bg-card)', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                          <div><div style={{ fontSize: 25, fontWeight: 800, color: 'var(--text-primary)' }}>{reportOccupancyPercent}%</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>OCCUPIED</div></div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 10, minWidth: 130, fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--red)' }} /><span style={{ color: 'var(--text-secondary)' }}>Occupied</span><strong style={{ marginLeft: 'auto' }}>{reportInventoryOccupied}</strong></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--emerald)' }} /><span style={{ color: 'var(--text-secondary)' }}>Available</span><strong style={{ marginLeft: 'auto' }}>{reportInventoryAvailable}</strong></div>
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 9, display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{reportInventoryTotal}</strong></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: 18, marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Applications by Funeral Home</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, marginBottom: 18 }}>Exact number of submitted applications from each funeral home for {activeReportPeriodLabel}</div>
                  {funeralHomeBreakdown.length > 0 ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                      {funeralHomeBreakdown.map((item, index) => (
                        <div key={item.funeral_home} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr 42px', gap: 12, alignItems: 'center' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.funeral_home}>{item.funeral_home}</div>
                          <div style={{ height: 12, overflow: 'hidden', borderRadius: 999, background: 'rgba(255,255,255,.06)' }}>
                            <div role="img" aria-label={`${item.funeral_home}: ${item.count} applications`} style={{ width: `${Math.max(5, (item.count / funeralHomeMax) * 100)}%`, height: '100%', borderRadius: 999, background: index % 2 === 0 ? 'var(--accent)' : 'var(--violet)', transition: 'width 300ms ease' }} />
                          </div>
                          <strong style={{ textAlign: 'right', fontSize: 14, color: 'var(--text-primary)' }}>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)' }}>No funeral home applications found for this period.</div>
                  )}
                </div>
                <ReportApplications key={`${reportAnalytics.from}:${reportAnalytics.to}`} report={reportAnalytics} />
                <h3 ref={submittedReportTableRef}>{role === 'mayor' ? 'Submitted Applications' : 'Burial Records During Period'}</h3>
                <div style={{ marginBottom: 20, overflowX: 'auto' }}>
                  <table className="data-table"><thead><tr><th>Application</th><th>Deceased</th><th>{role === 'mayor' ? 'Submitted' : 'Burial Date'}</th><th>Status</th></tr></thead><tbody>
                    {visibleSubmittedReportRows.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.deceased_name}</td><td>{formatReportDate(row.event_date)}</td><td>{row.status}</td></tr>)}
                  </tbody></table>
                  {reportAnalytics.records.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>{role === 'mayor' ? 'No applications submitted during this period.' : 'No applications have a burial date within this period. Occupied niches without a linked burial date do not appear here.'}</div>}
                </div>
                {role === 'mayor' && submittedReportRows.length > 0 && <nav aria-label="Submitted applications pages" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <span aria-live="polite" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Showing {(currentSubmittedReportPage - 1) * 10 + 1}–{Math.min(currentSubmittedReportPage * 10, submittedReportRows.length)} of {submittedReportRows.length} applications</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-ghost btn-sm" disabled={currentSubmittedReportPage === 1} onClick={() => changeSubmittedReportPage(currentSubmittedReportPage - 1)}>Previous</button>
                    <span style={{ fontSize: 12 }}>Page {currentSubmittedReportPage} of {submittedReportPageCount}</span>
                    <button className="btn btn-ghost btn-sm" disabled={currentSubmittedReportPage === submittedReportPageCount} onClick={() => changeSubmittedReportPage(currentSubmittedReportPage + 1)}>Next</button>
                  </div>
                </nav>}
              </>)}

              {selectedPanel === 'panel-reports' && (isStaffRole || isMayorRole) && <ReportSubmissions role={isMayorRole ? 'mayor' : 'staff'} analytics={reportAnalytics} canSubmit={reportReady} />}

            </div>
          </div>

          {isPlanningRole && (
          <div className={`panel ${selectedPanel === 'panel-planning-archive' ? 'active' : ''}`} id="panel-planning-archive">
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">CPDO Archive</div>
                  <div className="page-sub">Recover archived planning records without mixing them with active map data.</div>
                </div>
                <select className="admin-select" value={planningArchiveCategory} onChange={e => setPlanningArchiveCategory(e.target.value)} style={{ minWidth: 220 }}>
                  <option value="sections">Zoning Sections ({archivedPlanningSections.length})</option>
                  <option value="plots">Plot Records (0)</option>
                  <option value="columbarium">Niche Records ({clearedRecords.length})</option>
                </select>
              </div>

              {planningArchiveCategory === 'sections' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  {isPlanningArchiveLoading && <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>Loading archived sections…</div>}
                  {planningArchiveError && <div style={{ padding: 14, color: 'var(--red)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--radius)', background: 'rgba(239,68,68,.08)' }}>{planningArchiveError}</div>}
                  {!isPlanningArchiveLoading && !planningArchiveError && archivedPlanningSections.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>No archived zoning sections.</div>}
                  {archivedPlanningSections.map(section => { const props = section.properties || {}; const graves = Number(props.total_plots || 0); const floors = Number(props.estimated_stack_height || 1); return <div key={section.id || props.id} style={{ padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center' }}><div><div style={{ fontSize: 14, fontWeight: 800 }}>{props.zone_code || 'No code'} — {props.name}</div><div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-secondary)' }}>{props.cemetery_code === 'new' ? 'Lucena New Public Cemetery' : 'Lucena Old Public Cemetery'}</div><div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>{graves} graves · {floors} floor{floors === 1 ? '' : 's'} each · {graves * floors} total capacity</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}><button className="btn btn-sm btn-primary" onClick={() => restoreArchivedPlanningSection(section)}>Restore</button><button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,.35)' }} onClick={() => permanentlyDeleteArchivedSection(section)}>Delete</button></div></div>; })}
                </div>
              )}

              {planningArchiveCategory === 'plots' && (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>No archived plot records. Plot Records currently have no destructive delete action; occupied and assigned grave data remains protected.</div>
              )}

              {planningArchiveCategory === 'columbarium' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  {clearedRecords.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>No archived columbarium records.</div>}
                  {clearedRecords.map(record => <div key={record.id} style={{ padding: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center' }}><div><div style={{ fontSize: 14, fontWeight: 800 }}>{record.name}</div><div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-secondary)' }}>Previous slot: {record.slotId}</div>{record.note && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>{record.note}</div>}</div><button className="btn btn-sm btn-primary" onClick={() => { const slot = columbariumSlots.find(item => item.id === record.slotId); if (!slot || slot.status !== 'available') { showToast(`Cannot restore. Slot ${record.slotId} is currently occupied.`, 'error'); return; } setColumbariumSlots(current => current.map(item => item.id === record.slotId ? { ...item, status: 'occupied', name: record.name } : item)); const updated = clearedRecords.filter(item => item.id !== record.id); setClearedRecords(updated); localStorage.setItem('gravetrak_cleared_records', JSON.stringify(updated)); showToast(`Record for ${record.name} restored to ${record.slotId}.`); }}>Restore</button></div>)}
                </div>
              )}
            </div>
          </div>
          )}

          <div className={`panel ${selectedPanel === 'panel-archive' ? 'active' : ''}`} id="panel-archive">
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">System Archive</div>
                  <div className="page-sub">Restore or permanently delete removed records and reports.</div>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <button className={`btn btn-sm ${archiveTab === 'columbarium' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArchiveTab('columbarium')}>Apartment Niches ({clearedRecords.length})</button>
                <button className={`btn btn-sm ${archiveTab === 'reports' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArchiveTab('reports')}>Reports ({archivedReports.length})</button>
                <button className={`btn btn-sm ${archiveTab === 'applications' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArchiveTab('applications')}>Applications ({archivedCancelledApps.length})</button>
              </div>

              {archiveTab === 'columbarium' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  {clearedRecords.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>No archived columbarium records.</div>
                  ) : (
                    clearedRecords.map(rec => (
                      <div key={rec.id} style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rec.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Removed from Slot: <span style={{ color: 'var(--text-primary)' }}>{rec.slotId}</span></div>
                          {rec.note && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Note: {rec.note}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => {
                            const slot = columbariumSlots.find(s => s.id === rec.slotId);
                            if (slot && slot.status === 'available') {
                              setColumbariumSlots(current => current.map(s => s.id === rec.slotId ? { ...s, status: 'occupied', name: rec.name } : s));
                              const updated = clearedRecords.filter(r => r.id !== rec.id);
                              setClearedRecords(updated);
                              localStorage.setItem('gravetrak_cleared_records', JSON.stringify(updated));
                              showToast(`Record for ${rec.name} restored to ${rec.slotId}.`);
                              
                              const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
                              const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
                              logs.unshift({
                                id: Date.now(),
                                date: new Date().toLocaleString(),
                                user: userName,
                                action: 'Restored Columbarium Record',
                                details: `Restored record for ${rec.name} to slot ${rec.slotId} from Archive.`
                              });
                              localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
                            } else {
                              showToast(`Cannot restore. Slot ${rec.slotId} is currently occupied.`, 'error');
                            }
                          }}>Restore</button>
                          <button className="btn btn-sm btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => {
                          showConfirm('Permanent Delete', 'Permanently delete this record? This cannot be undone.', () => {
                              const updated = clearedRecords.filter(r => r.id !== rec.id);
                              setClearedRecords(updated);
                              localStorage.setItem('gravetrak_cleared_records', JSON.stringify(updated));
                              showToast('Record permanently deleted.');
                          });
                          }}>Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {archiveTab === 'reports' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  {archivedReports.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>No archived reports.</div>
                  ) : (
                    archivedReports.map(report => (
                      <div key={report.id} style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{report.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Submitted by: {report.author} on {report.date}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => {
                            setReports(current => [report, ...current]);
                            const updated = archivedReports.filter(r => r.id !== report.id);
                            setArchivedReports(updated);
                            localStorage.setItem('gravetrak_archived_reports', JSON.stringify(updated));
                            showToast('Report restored successfully.');
                            
                            const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
                            const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
                            logs.unshift({
                              id: Date.now(),
                              date: new Date().toLocaleString(),
                              user: userName,
                              action: 'Restored Report',
                              details: `Restored report "${report.title}" from Archive.`
                            });
                            localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
                          }}>Restore</button>
                          <button className="btn btn-sm btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => {
                          showConfirm('Permanent Delete', 'Permanently delete this report? This cannot be undone.', () => {
                              const updated = archivedReports.filter(r => r.id !== report.id);
                              setArchivedReports(updated);
                              localStorage.setItem('gravetrak_archived_reports', JSON.stringify(updated));
                              showToast('Report permanently deleted.');
                          });
                          }}>Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {archiveTab === 'applications' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  {archivedCancelledApps.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>No archived applications.</div>
                  ) : (
                    archivedCancelledApps.map(app => {
                      const demoReasons = JSON.parse(localStorage.getItem('gravetrak_demo_reasons') || '{}');
                      const cancelReason = demoReasons[String(app.id)] || 'No reason provided';
                      return (
                      <div key={app.id} style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{app.applicant_name} <span style={{fontSize: 12, color: 'var(--text-muted)', fontWeight: 400}}>({app.application_id})</span></div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Deceased: <span style={{ color: 'var(--text-primary)' }}>{app.deceased_name}</span></div>
                          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>Reason: {cancelReason}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => {
                            const updated = archivedCancelledApps.filter(a => a.id !== app.id);
                            setArchivedCancelledApps(updated);
                            localStorage.setItem('gravetrak_archived_cancelled_apps', JSON.stringify(updated));
                            setCancelledApps(current => [app, ...current].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
                            showToast(`Application for ${app.deceased_name} restored to Cancelled tab.`);
                          }}>Restore</button>
                          <button className="btn btn-sm btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => {
                          showConfirm('Permanent Delete', 'Permanently delete this application from archive? This cannot be undone.', () => {
                              const updated = archivedCancelledApps.filter(a => a.id !== app.id);
                              setArchivedCancelledApps(updated);
                              localStorage.setItem('gravetrak_archived_cancelled_apps', JSON.stringify(updated));
                              showToast('Application permanently deleted.');
                          });
                          }}>Delete</button>
                        </div>
                      </div>
                    )})
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={`panel ${selectedPanel === 'panel-users' ? 'active' : ''}`} id="panel-users">
            <div className="scroll-panel user-management-content">
              <div className="page-hdr">
                <div>
                  <div className="users-eyebrow">ACCOUNTS & ACCESS</div>
                  <div className="page-title">User Management</div>
                  <div className="page-sub">Manage registered users and their roles.</div>
                </div>
                <div className="page-actions">
                  <button className="btn btn-primary" disabled={isUsersLoading || !userManager} onClick={() => {
                    setOriginalUser(null);
                    setUserSaveError('');
                    setEditingUser({ email: '', first_name: '', last_name: '', role: 'user', contact_number: '', permissions: [], is_active: true, password: '', password_confirmation: '' });
                    setIsEditUserModalOpen(true);
                  }}>+ Add New User</button>
                </div>
              </div>
              <div className="users-summary" aria-label="Account summary">
                {[
                  ['Registered users', users.length, 'All accounts in GraveTrak', 'all'],
                  ['Active accounts', users.filter(user => user.is_active).length, 'Enabled to sign in', 'active'],
                  ['Inactive accounts', users.filter(user => !user.is_active).length, 'Sign-in access disabled', 'inactive'],
                ].map(([label, count, hint, tone]) => <div className="users-summary-card" data-tone={tone} key={tone}>
                  <span>{label}</span><strong>{isUsersLoading || userFetchError ? '—' : count.toLocaleString()}</strong><small>{hint}</small>
                </div>)}
              </div>
              <section className="users-directory" aria-label="User directory">
              <div className="users-directory-heading"><div><h2>User directory</h2><p>Review account details and manage access.</p></div><span className="users-result-count">{isUsersLoading ? 'Loading…' : `${filteredUsers.length} ${filteredUsers.length === 1 ? 'user' : 'users'}`}</span></div>
              <div className="users-toolbar">
                <label className="users-search"><span>Search users</span>
                <input 
                  type="text" 
                  placeholder="Search by name or email" 
                  style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }} 
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                />
                </label>
                <label className="users-role-filter"><span>Account role</span>
                <select className="admin-select" value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)}> 
                  <option value="all">All Roles</option>
                  <option value="mayor">CMO Super Administrator</option>
                  <option value="staff">Cemetery Staff</option>
                  <option value="planning">CPDO Administrator</option>
                  <option value="user">Citizen</option>
                </select>
                </label>
              </div>
              {userFetchError && (
                <div style={{ marginBottom: 14, padding: 12, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13 }}>
                  {userFetchError}
                </div>
              )}
              <div className="users-table-scroll" tabIndex={0} role="region" aria-label="User accounts table; scroll horizontally on smaller screens">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Role</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contact</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Login</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isUsersLoading ? (
                      <tr>
                        <td colSpan="7" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading users...</td>
                      </tr>
                    ) : filteredUsers.length > 0 ? (
                      paginatedUsers.map((user) => (
                        <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '14px', fontWeight: 600, color: 'var(--text-primary)' }}><div className="users-identity"><span className="users-avatar" aria-hidden="true">{`${user.first_name?.[0] || user.email?.[0] || 'U'}${user.last_name?.[0] || ''}`.toUpperCase()}</span><span>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}<small>{user.id === userManager?.id ? 'Your account' : `Account #${user.id}`}</small></span></div></td>
                          <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>{user.email || 'N/A'}</td>
                          <td style={{ padding: '14px', color: 'var(--text-secondary)' }}><span className="users-role-badge" data-role={user.role}>{USER_ROLE_LABELS[user.role] || user.role || 'Citizen'}</span></td>
                          <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>{user.contact_number || 'N/A'}</td>
                          <td className="users-last-login" style={{ padding: '14px', color: 'var(--text-secondary)' }}>{user.last_login ? <time dateTime={user.last_login}>{new Date(user.last_login).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}<small>{new Date(user.last_login).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small></time> : 'Never signed in'}</td>
                          <td style={{ padding: '14px' }}>
                            <span className="user-status-label" data-status={user.is_active ? 'Active' : 'Inactive'} style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              background: user.is_active ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)',
                              color: user.is_active ? 'var(--emerald)' : 'var(--red)',
                              borderRadius: '4px',
                              fontWeight: 600
                            }}>
                              {user.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td style={{ padding: '14px', textAlign: 'right' }}>
                            <button className="btn btn-xs btn-ghost" disabled={updatingUserId !== null} onClick={() => handleEditUser(user)}>Edit</button>
                            {user.is_active ? (
                              <button className="btn btn-xs btn-ghost" disabled={user.id === userManager?.id || updatingUserId !== null} title={user.id === userManager?.id ? 'You cannot deactivate your own account.' : undefined} style={{ color: 'var(--red)' }} onClick={() => showConfirm('Deactivate User', `Are you sure you want to deactivate ${user.first_name || user.email}? They will no longer be able to log in.`, () => handleSetUserActive(user, false))}>Deactivate</button>
                            ) : (
                              <button className="btn btn-xs btn-ghost" disabled={updatingUserId !== null} style={{ color: 'var(--emerald)' }} onClick={() => showConfirm('Activate User', `Are you sure you want to activate ${user.first_name || user.email}? They will be able to log in again.`, () => handleSetUserActive(user, true))}>Activate</button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>{users.length === 0 ? 'No users loaded from the server.' : 'No users found matching your criteria.'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="users-directory-footer">
                <span>{isUsersLoading ? 'Loading accounts…' : userFetchError ? 'Accounts unavailable' : filteredUsers.length ? `Showing ${(userPage - 1) * USER_PAGE_SIZE + 1}–${Math.min(userPage * USER_PAGE_SIZE, filteredUsers.length)} of ${filteredUsers.length} users` : 'No matching users'}</span>
                {totalUserPages > 1 && (
  <div className="admin-app-pagination">
    <button className="btn btn-xs btn-ghost" disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)}>Prev</button>
    <span style={{ margin: '0 8px' }}>Page {userPage} of {totalUserPages}</span>
    <button className="btn btn-xs btn-ghost" disabled={userPage >= totalUserPages} onClick={() => setUserPage(p => p + 1)}>Next</button>
  </div>
)}
              </div>
              </section>
            </div>
          </div>

          {/* Edit User Modal */}
          {isEditUserModalOpen && editingUser && (
            <div className="modal-overlay open edit-user-overlay" onClick={handleCancelUserEdit}>
              <form className="modal" aria-label={editingUser.id ? 'Edit user' : 'Add new user'} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); handleSaveUserEdit(); }}>
                <div className="modal-header">
                  <div className="modal-title">{editingUser.id ? `Edit User: ${editingUser.first_name} ${editingUser.last_name}` : 'Add New User'}</div>
                  <button type="button" className="modal-close" disabled={isSavingUser} onClick={handleCancelUserEdit} aria-label="Close">×</button>
                </div>
                <fieldset className="modal-body" disabled={isSavingUser} style={{ border: 0, margin: 0, minWidth: 0 }}>
                  {userSaveError && <div role="alert" style={{ color: 'var(--red)', marginBottom: 16 }}>{userSaveError}</div>}
                  {!editingUser.id && <div style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 12 }}>Create an account with an initial password. The user can change it in Settings and must verify their email before receiving email notifications.</div>}
                  {!editingUser.id && ['password', 'password_confirmation'].map(field => (
                    <label key={field} style={{ display: 'block', marginBottom: 16, fontSize: 12, fontWeight: 600 }}>
                      {field === 'password' ? 'Initial Password' : 'Confirm Password'}
                      <input type="password" required minLength={8} autoComplete="new-password" value={editingUser[field]}
                        onChange={e => setEditingUser(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 8, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
                    </label>
                  ))}
                  <div className="user-form-field" style={{ marginBottom: 16 }}>
                    <label htmlFor="managed-user-first_name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>First Name</label>
                    <input
                      type="text"
                      id="managed-user-first_name" value={editingUser.first_name}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, first_name: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div className="user-form-field" style={{ marginBottom: 16 }}>
                    <label htmlFor="managed-user-last_name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Last Name</label>
                    <input
                      type="text"
                      id="managed-user-last_name" value={editingUser.last_name}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, last_name: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div className="user-form-field" style={{ marginBottom: 16 }}>
                    <label htmlFor="managed-user-email" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Email</label>
                    <input
                      type="email"
                      required
                      maxLength={150}
                      id="managed-user-email" value={editingUser.email}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, email: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div className="user-form-field" style={{ marginBottom: 16 }}>
                    <label htmlFor="managed-user-role" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Role</label>
                    <select
                      id="managed-user-role" value={editingUser.role}
                      disabled={!managerCan('assign_roles')}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, role: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    >
                      <option value="mayor">CMO Super Administrator</option>
                      <option value="staff">Cemetery Staff</option>
                      <option value="planning">CPDO Administrator</option>
                      <option value="user">Citizen</option>
                    </select>
                  </div>
                  <div className="user-form-field" style={{ marginBottom: 16 }}>
                    <label htmlFor="managed-user-contact_number" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Contact Number</label>
                    <input
                      type="text"
                      maxLength={20}
                      id="managed-user-contact_number" value={editingUser.contact_number || ''}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, contact_number: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div className="user-permissions" style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Permission Overrides</label>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Leave all unchecked to use the selected role's default permissions. Selecting one or more replaces those defaults for this account.
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto', padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                      {RBAC_PERMISSION_OPTIONS.map(([permission, label]) => (
                        <label key={permission} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            disabled={!managerCan('manage_permissions')}
                            checked={(editingUser.permissions || []).includes(permission)}
                            onChange={(event) => setEditingUser((previous) => ({
                              ...previous,
                              permissions: event.target.checked
                                ? [...new Set([...(previous.permissions || []), permission])]
                                : (previous.permissions || []).filter((item) => item !== permission),
                            }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="user-active-setting" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      disabled={editingUser.id === userManager?.id}
                      id="managed-user-active" checked={editingUser.is_active}
                      onChange={(e) => setEditingUser(prev => ({ ...prev, is_active: e.target.checked }))}
                      style={{ transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="managed-user-active" style={{ fontSize: 14, color: 'var(--text-primary)' }}>Is Active</label>
                  </div>
                </fieldset>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={handleCancelUserEdit} disabled={isSavingUser}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={isSavingUser}>{isSavingUser ? 'Saving...' : editingUser.id ? 'Save Changes' : 'Create User'}</button>
                  </div>
              </form>
            </div>
          )}

          {/* Rule-Based Assignment Confirmation Modal */}
          {isAssignConfirmOpen && assignConfirmData && (
            <div className="modal-overlay open" onClick={() => setIsAssignConfirmOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Rule-Based Automatic Assignment</div>
                  <button className="modal-close" onClick={() => setIsAssignConfirmOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ padding: 16, background: 'rgba(25, 135, 101, 0.08)', border: '1px solid rgba(25, 135, 101, 0.2)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--accent-light)', fontWeight: 'bold' }}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
                      System Rule Evaluation
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                      {assignConfirmData.ruleDesc}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                    You are about to assign <strong>{assignConfirmData.slotToAssign.grave_id || assignConfirmData.slotToAssign.id}</strong> to <strong>{assignConfirmData.app.deceased_name}</strong>.
                    <br/><br/>
                    This action will update the cemetery map and columbarium records globally, marking the slot as occupied (red). Do you want to proceed?
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={() => setIsAssignConfirmOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={executeAutoAssign}>Confirm & Assign</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Documents Modal */}
          {isDocumentsModalOpen && selectedAppForDocs && (
            <div className="modal-overlay open" onClick={() => setIsDocumentsModalOpen(false)}>
              <div className="modal" style={{ maxWidth: '600px', width: '95%' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Document Completeness Review</div>
                  <button className="modal-close" onClick={() => setIsDocumentsModalOpen(false)}>×</button>
                </div>
                <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
                  <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Applicant: {selectedAppForDocs.applicant_name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <div style={{ gridColumn: '1 / -1', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Client / Applicant Information</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Client:</strong> {selectedAppForDocs.applicant_name}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Age / Gender:</strong> {selectedAppForDocs.client_age ?? '—'} / {selectedAppForDocs.client_gender === 'M' ? 'Male' : selectedAppForDocs.client_gender === 'F' ? 'Female' : selectedAppForDocs.client_gender === 'O' ? 'Other' : '—'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Civil Status:</strong> {selectedAppForDocs.client_civil_status || 'Not provided'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Education:</strong> {selectedAppForDocs.client_educational_attainment || 'Not provided'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Occupation / Income:</strong> {selectedAppForDocs.client_occupation || 'Not provided'} / {selectedAppForDocs.client_income || 'Not provided'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-primary)' }}>Client Address:</strong> {selectedAppForDocs.client_address || 'Not provided'}</div>
                      <div style={{ gridColumn: '1 / -1', fontWeight: 700, color: 'var(--text-primary)', margin: '8px 0 2px' }}>Deceased / Burial Information</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Deceased:</strong> {selectedAppForDocs.deceased_name}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Age / Gender:</strong> {selectedAppForDocs.deceased_age || '—'} / {selectedAppForDocs.deceased_gender === 'M' ? 'Male' : selectedAppForDocs.deceased_gender === 'F' ? 'Female' : selectedAppForDocs.deceased_gender === 'O' ? 'Other' : '—'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Dates (Birth - Death):</strong> {selectedAppForDocs.deceased_date_of_birth || '?'} to {selectedAppForDocs.deceased_date_of_death}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Place of Birth:</strong> {selectedAppForDocs.place_of_birth || 'Not provided'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Funeral Home:</strong> {selectedAppForDocs.funeral_home || 'Not provided'}</div>
                      <div><strong style={{ color: 'var(--text-primary)' }}>Relationship:</strong> <span style={{textTransform: 'capitalize'}}>{selectedAppForDocs.applicant_relationship}</span></div>
                      <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-primary)' }}>Address:</strong> {selectedAppForDocs.applicant_address || 'Not provided'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-primary)' }}>Contact Info:</strong> {selectedAppForDocs.applicant_contact_phone || 'N/A'} • {selectedAppForDocs.applicant_contact_email || 'N/A'}</div>
                    </div>
                    {(selectedAppForDocs.family_members || []).length > 0 && <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Family Composition</div>
                      <div style={{ display: 'grid', gap: 6 }}>{selectedAppForDocs.family_members.map(member => <div key={member.id} style={{ padding: 9, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)' }}>{member.name}</strong> · {member.age ?? '—'} / {member.sex || '—'} · {member.relationship || 'Relationship not provided'}<br/>{member.civil_status || '—'} · {member.educational_attainment || '—'} · {member.occupation || '—'} / {member.income || '—'}</div>)}</div>
                    </div>}
                  </div>
                  {selectedAppForDocs.documents && selectedAppForDocs.documents.length > 0 ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                      {selectedAppForDocs.documents.map((doc, idx) => (
                        <div key={idx} style={{ 
                          padding: 16, 
                          background: 'rgba(255,255,255,.03)', 
                          borderRadius: 'var(--radius)',
                          border: '1px solid var(--border)',
                        }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                            {doc.document_type_display}
                          </div>
                          <SecureDocumentPreview document={doc} />
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '8px 0 12px' }}>{doc.file_name} ({(doc.file_size / 1024).toFixed(1)} KB)</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button 
                              className={`btn btn-sm ${docVerification[doc.document_type_display] === 'complete' ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ flex: 1, ...(docVerification[doc.document_type_display] === 'complete' ? { background: 'var(--emerald)', borderColor: 'var(--emerald)' } : {}) }}
                              onClick={() => handleDocumentReview(doc, 'complete')}
                            >
                              Mark Complete
                            </button>
                            <button 
                              className={`btn btn-sm ${docVerification[doc.document_type_display] === 'needs_correction' ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ flex: 1, ...(docVerification[doc.document_type_display] === 'needs_correction' ? { background: 'var(--red)', borderColor: 'var(--red)' } : {}) }}
                              onClick={() => setDocVerification(prev => ({ ...prev, [doc.document_type_display]: 'needs_correction' }))}
                            >
                              Needs Correction
                            </button>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                            Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : 'Unknown'}
                            {doc.verified_by ? ` · Reviewed by ${doc.verified_by}` : ''}
                            {doc.verified_at ? ` · ${new Date(doc.verified_at).toLocaleString()}` : ''}
                          </div>
                          {(docVerification[doc.document_type_display] === 'needs_correction' || doc.verification_status === 'needs_correction') && (
                            <div style={{ marginTop: 10 }}>
                              <input 
                                type="text" 
                                placeholder="Reason for rejection (e.g., Blurry image, wrong document)" 
                                value={docRejectReasons[doc.document_type_display] || ''} 
                                onChange={(e) => setDocRejectReasons(prev => ({...prev, [doc.document_type_display]: e.target.value}))} 
                                style={{ width: '100%', padding: '8px 10px', background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} 
                              />
                              <button className="btn btn-sm btn-primary" style={{ marginTop: 8, background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => handleDocumentReview(doc, 'needs_correction')}>
                                Save Correction Request
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                      No documents uploaded for this application.
                    </div>
                  )}

                  {(() => {
                    const summary = selectedAppForDocs.document_completeness || {};
                    const unresolved = [
                      ...(summary.missing_documents || []),
                      ...(selectedAppForDocs.documents || [])
                        .filter(doc => doc.verification_status !== 'complete')
                        .map(doc => doc.document_type_display),
                    ];

                    return (
                      <div style={{ marginTop: 24, padding: 16, borderTop: '1px solid var(--border)', background: summary.ready_for_further_processing ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.08)', borderRadius: 'var(--radius)' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Document Completeness</div>
                        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                          {summary.complete_count || 0} / {summary.required_count || 5} complete · {String(summary.state || 'incomplete').replaceAll('_', ' ')}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: summary.ready_for_further_processing ? 'var(--emerald)' : 'var(--text-muted)' }}>
                          {summary.ready_for_further_processing
                            ? 'Requirements complete. The application is ready for further processing; final approval remains separate.'
                            : `Application cannot proceed yet.${unresolved.length ? ` Unresolved: ${[...new Set(unresolved)].join(', ')}.` : ''}`}
                        </div>
                        {(summary.ready_for_further_processing || (summary.needs_correction_count > 0 && summary.pending_review_count === 0)) && (
                          <button className="btn btn-primary" style={{ width: '100%', marginTop: 14, padding: 12 }} onClick={handleCompleteDocumentReview}>
                            {summary.ready_for_further_processing ? 'Done — Continue to Scheduling' : 'Finalize Review & Notify Corrections'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Notify Modal */}
          {isNotifyModalOpen && selectedAppForNotify && (
            <div className="modal-overlay open" onClick={() => setIsNotifyModalOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Notify Applicant</div>
                  <button className="modal-close" onClick={() => setIsNotifyModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Application: <strong>{selectedAppForNotify.application_id}</strong>
                    <br/>Recipient: {notifyRecipient}
                    <br/><small>Message is delivered in-app. A generic SMS notice is recorded; external SMS delivery is not configured.</small>
                  </div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                    Message to Applicant
                  </label>
                  <textarea
                    value={notifyMessage}
                    maxLength={1000}
                    disabled={notifyBusy}
                    onChange={(e) => setNotifyMessage(e.target.value)}
                    placeholder="Enter your message here (e.g., 'Please provide death certificate' or 'Additional information needed')"
                    style={{
                      width: '100%',
                      minHeight: '120px',
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'rgba(0,0,0,.1)',
                      color: 'var(--text-primary)',
                      font: 'inherit',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={() => setIsNotifyModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSendNotification} disabled={notifyBusy || !notifyMessage.trim()}>{notifyBusy ? 'Saving…' : 'Send Notification'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Schedule Interview Modal */}
          {isInterviewModalOpen && selectedAppForInterview && (
            <div className="modal-overlay open" onClick={() => setIsInterviewModalOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Schedule Interview</div>
                  <button className="modal-close" onClick={() => setIsInterviewModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Applicant: <strong>{selectedAppForInterview.applicant_name}</strong><br/>
                    Deceased: <strong>{selectedAppForInterview.deceased_name}</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Date</label>
                      <CustomDatePicker value={interviewDetails.date} onChange={e => setInterviewDetails({...interviewDetails, date: e.target.value})} placeholder="Select date" minDate="today" maxDate={maxInterviewDateString} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Time</label>
                      <input type="time" min="08:00" max="16:55" step="300" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} value={interviewDetails.time} onChange={e => setInterviewDetails({...interviewDetails, time: e.target.value})} onClick={(e) => e.target.showPicker && e.target.showPicker()} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Appointment duration: <strong style={{ marginLeft: 4, color: 'var(--text-primary)' }}>5 minutes</strong>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={async () => {
                        try {
                          const result = await fetchAvailableAppointmentSlots(selectedAppForInterview.id, interviewDetails.date || undefined, 14);
                          setAppointmentSlots(result.slots || []);
                          setAppointmentSlotError('');
                        } catch (err) { setAppointmentSlotError(err.message); setAppointmentSlots([]); }
                      }}>View Available Slots</button>
                      {!selectedAppForInterview.interview_info?.id && <button className="btn btn-ghost btn-sm" onClick={async () => {
                        try {
                          const result = await autoScheduleNextAppointment(selectedAppForInterview.id, { location: interviewDetails.location, notes: interviewDetails.notes });
                          showToast('Next available appointment scheduled.', 'success');
                          setIsInterviewModalOpen(false);
                          loadApps();
                        } catch (err) { showToast(err.message, 'error'); }
                      }}>Auto Schedule Next Available</button>}
                    </div>
                    {appointmentSlotError && <div className="application-error">{appointmentSlotError}</div>}
                    {appointmentSlots.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
                      {appointmentSlots.slice(0, 40).map(slot => <button key={`${slot.date}-${slot.time}`} className="btn btn-ghost btn-sm" onClick={() => setInterviewDetails(prev => ({ ...prev, date: slot.date, time: slot.time, duration_minutes: 5 }))}>{slot.date} · {slot.time}</button>)}
                    </div>}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Location</label>
                    <input type="text" style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} value={interviewDetails.location} onChange={e => setInterviewDetails({...interviewDetails, location: e.target.value})} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Notes to Applicant</label>
                    <textarea style={{ width: '100%', minHeight: '80px', padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', resize: 'vertical' }} value={interviewDetails.notes} onChange={e => setInterviewDetails({...interviewDetails, notes: e.target.value})} placeholder="E.g., Please bring original documents." />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={() => setIsInterviewModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={submitInterviewSchedule}>Set Schedule & Notify</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Columbarium Slot Modal */}
          {isSlotModalOpen && selectedSlotDetails && (
            <div className="modal-overlay open" onClick={() => setIsSlotModalOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Apartment Niche {selectedSlotDetails.id}</div>
                  <button className="modal-close" onClick={() => setIsSlotModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <p>{selectedSlotDetails.cemeteryMap === 'new' ? 'New' : 'Old'} Cemetery · {selectedSlotDetails.section} · Floor {selectedSlotDetails.floor} · Column {selectedSlotDetails.col}</p>
                  {isStaffRole && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                    let location = null;
                    adminMapRef.current?.eachLayer(layer => {
                      const props = layer.feature?.properties;
                      if (props?.name === `${normalizeSectionName(selectedSlotDetails.section)}-C${selectedSlotDetails.col}` && props.cemeteryMap === selectedSlotDetails.cemeteryMap) location = props.frontCoord;
                    });
                    if (!location) { showToast('Map location is not available for this niche yet.', 'info'); return; }
                    setActiveAdminCemetery(selectedSlotDetails.cemeteryMap);
                    setIsSlotModalOpen(false);
                    setSelectedPanel('panel-admin-map');
                    requestAnimationFrame(() => { adminMapRef.current?.invalidateSize(); adminMapRef.current?.flyTo(location, 22); });
                  }}>View on Map</button>}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: selectedSlotDetails.status === 'occupied' ? 'var(--red)' : 'var(--emerald)' }}>
                      {selectedSlotDetails.status.toUpperCase()}
                    </div>
                  </div>
                  
                  {selectedSlotDetails.status === 'occupied' && (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Occupant(s)</div>
                        {!isEditingSlotName ? (
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {(selectedSlotDetails.name || '').split(',').map((n, i) => (
                                <div key={i} style={{ padding: '8px 0' }}><strong>{memorialLabel({ name: n }).name}</strong><div style={{ fontSize: 12, fontWeight: 400, marginTop: 4 }}>{memorialLabel({ name: n }).deathDate ? `Died ${memorialLabel({ name: n }).deathDate}` : 'Date of death not recorded'}</div></div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <button className="btn btn-xs btn-ghost" onClick={() => { setIsEditingSlotName(true); setEditSlotName(selectedSlotDetails.name); }} style={{ padding: '4px 8px', fontSize: 11 }}>Edit Names</button>
                              <button className="btn btn-xs btn-primary" onClick={() => { setIsManualAssignOpen(true); setManualAssignFirstName(''); setManualAssignLastName(''); setManualAssignMI(''); setManualAssignSuffix(''); setManualAssignDOB(''); setManualAssignDOD(''); }} style={{ padding: '4px 8px', fontSize: 11 }}>+ Add Another Occupant</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <input
                              type="text"
                              style={{ flex: 1, padding: '6px 10px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              value={editSlotName}
                              onChange={(e) => setEditSlotName(e.target.value)}
                              placeholder="Separate names with commas"
                            />
                            <button className="btn btn-xs btn-primary" onClick={handleSaveSlotName}>Save</button>
                            <button className="btn btn-xs btn-ghost" onClick={() => setIsEditingSlotName(false)}>Cancel</button>
                          </div>
                        )}

                        {isManualAssignOpen && !isEditingSlotName && (
                          <div style={{ padding: 16, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Add Another Occupant</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 8 }}>
                              <input
                                type="text"
                                placeholder="First Name"
                                value={manualAssignFirstName}
                                onChange={(e) => setManualAssignFirstName(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                              <input
                                type="text"
                                placeholder="Last Name"
                                value={manualAssignLastName}
                                onChange={(e) => setManualAssignLastName(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                              <input
                                type="text"
                                placeholder="M.I. (Optional)"
                                value={manualAssignMI}
                                onChange={(e) => setManualAssignMI(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                              <input
                                type="text"
                                placeholder="Suffix (Optional)"
                                value={manualAssignSuffix}
                                onChange={(e) => setManualAssignSuffix(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
                              <div>
                                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Date of Birth (Optional)</label>
                              <CustomDatePicker value={manualAssignDOB} onChange={(e) => setManualAssignDOB(e.target.value)} placeholder="Date of Birth" maxDate="today" />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Date of Death</label>
                              <CustomDatePicker value={manualAssignDOD} onChange={(e) => setManualAssignDOD(e.target.value)} placeholder="Date of Death" maxDate="today" />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => setIsManualAssignOpen(false)}>Cancel</button>
                              <button className="btn btn-primary btn-sm" onClick={() => {
                                if (!manualAssignFirstName.trim() || !manualAssignLastName.trim()) {
                                  showToast('Please enter both first and last name.', 'error');
                                  return;
                                }
                                const fullName = `${manualAssignFirstName.trim()} ${manualAssignMI.trim() ? manualAssignMI.trim() + ' ' : ''}${manualAssignLastName.trim()}${manualAssignSuffix.trim() ? ' ' + manualAssignSuffix.trim() : ''}`.replace(/\s+/g, ' ').trim();
                                let dateStr = '';
                                if (manualAssignDOB || manualAssignDOD) {
                                  const b = manualAssignDOB ? new Date(manualAssignDOB).toLocaleDateString() : '?';
                                  const d = manualAssignDOD ? new Date(manualAssignDOD).toLocaleDateString() : '?';
                                  dateStr = ` (${b} - ${d})`;
                                }
                                const newEntry = `${fullName}${dateStr}`;
                                const combinedNames = selectedSlotDetails.name ? `${selectedSlotDetails.name}, ${newEntry}` : newEntry;
                                const numOccupants = combinedNames.split(',').length;
                                
                                showConfirm('Add Occupant', `Add ${fullName} to slot ${selectedSlotDetails.id}? (Total occupants: ${numOccupants})`, () => {
                                  setColumbariumSlots(current => current.map(s => // Ensure cemeteryMap is used for unique ID
                                    s.id === selectedSlotDetails.id ? { ...s, name: combinedNames } : s
                                  ));
                                  
                                  const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
                                  const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
                                  logs.unshift({
                                    id: Date.now(),
                                    date: new Date().toLocaleString(),
                                    user: userName,
                                    action: 'Added Columbarium Occupant',
                                    details: `Added ${fullName} to existing slot ${selectedSlotDetails.id}.`
                                  });
                                  localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
                                  
                                  setSelectedSlotDetails(prev => ({ ...prev, name: combinedNames }));
                                  setIsManualAssignOpen(false);
                                  showToast(`Successfully added ${fullName} to ${selectedSlotDetails.id}.`);
                                }, false);
                              }}>Save Record</button>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {(isStaffRole || isPlanningRole || isMayorRole) && (
                        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Transfer to Another Apartment Niche</div>
                          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
                            Open the Apartment Niches layout, then click an available niche to move all occupants there.
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={isTransferringNiche}
                            onClick={beginNicheTransfer}
                          >Choose Destination in Apartment Niches</button>
                        </div>
                      )}

                      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Archive / Remove Record</div>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                          This archives the entire niche record and clears the slot. All occupants will be removed from this niche. To remove just one person, use the "Edit Names" button above.
                        </p>
                        <textarea
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                          placeholder="Optional reason or reference for archiving this record"
                          style={{ width: '100%', minHeight: '80px', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(0,0,0,.1)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical', marginBottom: 16 }}
                        />
                        <button 
                          className="btn btn-primary"
                          style={{ width: '100%', background: 'var(--red)', borderColor: 'var(--red)' }}
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to remove ${selectedSlotDetails.name} from ${selectedSlotDetails.id}? The record will be moved to the Archive.`)) {
                          try { updateColumbarium(selectedSlotDetails.id, { name: '', status: 'available' }); } catch(e) {}
                              setColumbariumSlots(current => current.map(s => 
                                s.id === selectedSlotDetails.id ? { ...s, status: 'available', name: '' } : s
                              ));
                              
                              const newCleared = [{
                                id: Date.now(),
                                slotId: selectedSlotDetails.id,
                                name: selectedSlotDetails.name,
                                note: transferNote
                              }, ...clearedRecords].slice(0, 10);
                              setClearedRecords(newCleared);
                              localStorage.setItem('gravetrak_cleared_records', JSON.stringify(newCleared));
                              
                              setIsSlotModalOpen(false);
                              showToast(`Record archived. ${transferNote ? `Archive note saved.` : ''}`);
                            }
                          }}
                        >Archive All Occupants and Clear Slot</button>
                      </div>
                    </>
                  )}
                  {selectedSlotDetails.status === 'available' && (
                    <>
                      {!isManualAssignOpen ? (
                        <div style={{ padding: 20, textAlign: 'center' }}>
                          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>This slot is currently empty and available for assignment.</div>
                          <button className="btn btn-primary btn-sm" onClick={() => { setIsManualAssignOpen(true); setManualAssignFirstName(''); setManualAssignLastName(''); setManualAssignMI(''); setManualAssignSuffix(''); setManualAssignDOB(''); setManualAssignDOD(''); }}>Manually Assign Record</button>
                        </div>
                      ) : (
                        <div style={{ padding: 16, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Manual Assignment</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 8 }}>
                              <input
                                type="text"
                                placeholder="First Name"
                                value={manualAssignFirstName}
                                onChange={(e) => setManualAssignFirstName(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                              <input
                                type="text"
                                placeholder="Last Name"
                                value={manualAssignLastName}
                                onChange={(e) => setManualAssignLastName(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                              <input
                                type="text"
                                placeholder="M.I. (Optional)"
                                value={manualAssignMI}
                                onChange={(e) => setManualAssignMI(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                              <input
                                type="text"
                                placeholder="Suffix (Optional)"
                                value={manualAssignSuffix}
                                onChange={(e) => setManualAssignSuffix(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                              />
                            </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
                            <div>
                              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Date of Birth (Optional)</label>
                              <CustomDatePicker value={manualAssignDOB} onChange={(e) => setManualAssignDOB(e.target.value)} placeholder="Date of Birth" maxDate="today" />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Date of Death</label>
                              <CustomDatePicker value={manualAssignDOD} onChange={(e) => setManualAssignDOD(e.target.value)} placeholder="Date of Death" maxDate="today" />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setIsManualAssignOpen(false)}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={() => {
                              if (!manualAssignFirstName.trim() || !manualAssignLastName.trim()) {
                                showToast('Please enter both first and last name.', 'error');
                                return;
                              }
                              const fullName = `${manualAssignFirstName.trim()} ${manualAssignMI.trim() ? manualAssignMI.trim() + ' ' : ''}${manualAssignLastName.trim()}${manualAssignSuffix.trim() ? ' ' + manualAssignSuffix.trim() : ''}`.replace(/\s+/g, ' ').trim();
                              let dateStr = '';
                              if (manualAssignDOB || manualAssignDOD) {
                                const b = manualAssignDOB ? new Date(manualAssignDOB).toLocaleDateString() : '?';
                                const d = manualAssignDOD ? new Date(manualAssignDOD).toLocaleDateString() : '?';
                                dateStr = ` (${b} - ${d})`;
                              }
                              const newEntry = `${fullName}${dateStr}`;
                          showConfirm('Manual Assignment', `Assign ${fullName} to slot ${selectedSlotDetails.id}?`, async () => {
                            try { await updateColumbarium(selectedSlotDetails.id, { name: newEntry, status: 'occupied' }); } catch(e) {}
                                setColumbariumSlots(current => current.map(s => // Ensure cemeteryMap is used for unique ID
                                  s.id === selectedSlotDetails.id ? { ...s, status: 'occupied', name: newEntry } : s
                                ));
                                
                                const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
                                const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
                                logs.unshift({
                                  id: Date.now(),
                                  date: new Date().toLocaleString(),
                                  user: userName,
                                  action: 'Manual Columbarium Assignment',
                                  details: `Manually assigned ${fullName} to slot ${selectedSlotDetails.id}.`
                                });
                                localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));
                                
                                setIsSlotModalOpen(false);
                                setIsManualAssignOpen(false);
                                showToast(`Successfully assigned ${fullName} to ${selectedSlotDetails.id}.`);
                              }, false);
                            }}>Save Record</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Audit Logs Modal */}
          {isAuditLogsModalOpen && (
            <div className="modal-overlay open" onClick={() => setIsAuditLogsModalOpen(false)}>
              <div className="modal" style={{ width: '700px', maxWidth: '95%' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">System Audit Logs</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-ghost" style={{ border: '1px solid var(--border)' }} onClick={handleExportMasterCSV}>📥 Export Master CSV</button>
                    <button className="modal-close" onClick={() => setIsAuditLogsModalOpen(false)}>×</button>
                  </div>
                </div>
                <div className="modal-body" style={{ padding: 0 }}>
                  <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    {auditLogs.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)' }}>Date & Time</th>
                            <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)' }}>User</th>
                            <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)' }}>Action & Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLogs.map(log => (
                            <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{log.date}</td>
                              <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>{log.user}</td>
                              <td style={{ padding: '12px 16px' }}>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{log.action}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{log.details}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>No audit logs recorded yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Report Modal */}
          {isReportModalOpen && (
            <div className="modal-overlay open" onClick={() => setIsReportModalOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Create New Report</div>
                  <button className="modal-close" onClick={() => setIsReportModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Report Title</label>
                    <input 
                      type="text" 
                      value={newReport.title}
                      onChange={e => setNewReport({...newReport, title: e.target.value})}
                  placeholder="e.g., Monthly Analytics Report - June 2026"
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Analytics Data & Insights</label>
                  <button className="btn btn-xs btn-ghost" onClick={autoFillReport} style={{ fontSize: 10, padding: '2px 8px' }}>Run Analytics Engine</button>
                    </div>
                    <textarea
                      value={newReport.content}
                      onChange={e => setNewReport({...newReport, content: e.target.value})}
                  placeholder="Click 'Run Analytics Engine' to generate metrics..."
                      style={{ width: '100%', minHeight: '150px', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(0,0,0,.1)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={() => setIsReportModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => {
                      if(!newReport.title.trim() || !newReport.content.trim()) {
                        showToast("Please fill in both title and content.", "error");
                        return;
                      }
                      const report = {
                        id: 'REP-' + Date.now().toString().slice(-6),
                        date: new Date().toLocaleDateString(),
                        author: currentRoleInfo?.name || 'Cemetery Admin',
                        title: newReport.title,
                        content: newReport.content,
                        status: 'pending'
                      };
                      setReports([report, ...reports]);
                      setNewReport({ title: '', content: '' });
                      setIsReportModalOpen(false);
                      showToast("Report successfully submitted to the Mayor's Office.");
                    }}>Submit to Mayor</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mayor Live Analytics Modal */}
          {isMayorAnalyticsModalOpen && (
            <div className="modal-overlay open" onClick={() => setIsMayorAnalyticsModalOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Mayor Live Analytics</div>
                  <button className="modal-close" onClick={() => setIsMayorAnalyticsModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  {!liveAnalyticsData ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No analytics data yet. Click "Run Live Analytics Engine" to generate metrics.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 180px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Plots</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{liveAnalyticsData.totalPlots}</div>
                        </div>
                        <div style={{ flex: '1 1 140px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Graves (Total)</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{lucenaGraveData.length}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Available: {availableGraveCount}</div>
                        </div>
                        <div style={{ flex: '1 1 140px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Apartment Niches (Total)</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{columbariumSlots.length}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Available: {availableCountCol}</div>
                        </div>
                        <div style={{ flex: '1 1 180px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Occupied Plots</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{liveAnalyticsData.occupiedPlots}</div>
                        </div>
                        <div style={{ flex: '1 1 180px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Occupancy</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{liveAnalyticsData.occupancyPct}%</div>
                        </div>
                        <div style={{ flex: '1 1 180px', padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This Month</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{liveAnalyticsData.thisMonthVal}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Compare: {liveAnalyticsData.compareMonthVal} ({liveAnalyticsData.pctChange === null ? 'N/A' : liveAnalyticsData.pctChange + '%'})</div>
                        </div>
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Insights</div>
                        {liveAnalyticsData.insights.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)' }}>No notable insights.</div>
                        ) : (
                          <ul>
                            {liveAnalyticsData.insights.map((ins, i) => <li key={i}>{ins}</li>)}
                          </ul>
                        )}
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Monthly Counts</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {liveAnalyticsData.monthlyCounts.map((c, idx) => (
                            <div key={idx} style={{ width: 56, padding: 6, textAlign: 'center', background: 'rgba(255,255,255,.02)', borderRadius: 6 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][idx]}</div>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>{c}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px' }}>
                  <button className="btn btn-ghost" onClick={() => setIsMayorAnalyticsModalOpen(false)}>Close</button>
                  <button className="btn btn-primary" onClick={() => { generateMayorLiveAnalytics(); }}>Refresh</button>
                </div>
              </div>
            </div>
          )}

          {isPlanningRole && plotManagerTarget && <CPDOPlotManager
            target={plotManagerTarget}
            sectionsByCemetery={planningSectionsByCemetery}
            onClose={() => setPlotManagerTarget(null)}
            onInventoryLoaded={(plots, niches, sections) => { setGroundPlots(plots); setColumbariumSlots(processSlots(niches)); setCemeterySections(sections); }}
            onSaved={async (kind, record) => {
              if (kind === 'ground') setGroundPlots(current => current.map(plot => plot.id === record.id ? record : plot));
              else setColumbariumSlots(current => current.map(slot => slot.id === record.id ? processSlots([record])[0] : slot));
              try {
                const [sections, summary] = await Promise.all([fetchCemeterySections(), fetchBurialPlotSummary()]);
                setCemeterySections(Array.isArray(sections?.features) ? sections.features : []);
                setGroundPlotSummary(summary);
              } catch (err) { throw new Error(`Unit saved, but the section summary could not refresh: ${err.message}`); }
            }}
          />}

          <div className={`panel ${selectedPanel === 'panel-graves' ? 'active' : ''}`} id="panel-graves">
            {isPlanningRole ? <CPDOPlotRecords
              active={active && selectedPanel === 'panel-graves'}
              inventoryRows={cpdoInventoryRows} zones={zonesSidebarSections}
              cemetery={activePlanningCemetery} onCemeteryChange={setActivePlanningCemetery}
              error={plotDataError || cemeterySectionsError}
              onManage={row => setPlotManagerTarget(row.kind === 'stack'
                ? { cemetery: row.cemeteryCode, kind: 'niche', section: row.sectionName, column: row.col }
                : { cemetery: row.cemeteryCode, kind: row.kind, id: row.id })}
              onRefresh={refreshActiveInventory}
              onViewMap={row => {
                setPlotSectionFilter(row.sectionName); setPlotStatusFilter('all'); setSelectedPanel('panel-planning');
                schedulePassiveTimeout(() => {
                  const feature = row.kind === 'ground' ? buildSavedSectionPlotFeatures(cemeterySections, groundPlots).features.find(item => String(item.properties.id) === String(row.id)) : null;
                  const center = feature?.properties?.rendered_center || (row.kind === 'ground' && row.latitude != null && row.longitude != null ? [row.latitude, row.longitude] : null);
                  if (center) safeFlyToMap(planningMapRef.current, center, 21);
                  else {
                    const zone = zonesSidebarSections.find(item => normalizeSectionName(item.properties?.name) === normalizeSectionName(row.sectionName));
                    if (zone?.geometry?.coordinates?.length) planningMapRef.current?.fitBounds(L.geoJSON(zone).getBounds(), { padding: [40, 40] });
                    else showToast('This section has no saved map boundary. Its inventory record is available under Manage.', 'error');
                  }
                  revealZoneInSidebar(row.sectionName);
                }, 300);
              }}
            /> : <>
            <div className="scroll-panel">
              <div className="page-hdr">
                <div>
                  <div className="page-title">Plot Records</div>
                <div className="page-sub">City Planning — Ground grave plot distribution and records</div>
                </div>
                <div className="page-actions">
                  <button className="btn btn-ghost" style={{ border: '1px solid var(--border)' }} onClick={handleExportMasterCSV}>📥 Export CSV</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, gridAutoRows: 'min-content', marginBottom: 32 }}>
                <div style={{ padding: '16px', background: 'rgba(22,135,201,.08)', border: '1px solid rgba(22,135,201,.2)', borderRadius: 'var(--radius-lg)' }}> 
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Total Grave Plots</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>{isPlanningRole ? activeGroundPlotSummary.total : lucenaGraveData.length}</div>
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>Database ground plot records</div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 'var(--radius-lg)' }}> 
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Available</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--emerald)', marginBottom: 4 }}>{isPlanningRole ? activeGroundPlotSummary.available : availableGraveCount}</div>
                  <div style={{ fontSize: 12, color: 'var(--emerald)' }}>Ready for zoning</div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 'var(--radius-lg)' }}> 
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Interred Graves</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>{isPlanningRole ? activeGroundPlotSummary.occupied : occupiedGraveCount}</div>
                  <div style={{ fontSize: 12, color: 'var(--red)' }}>Assigned plots</div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Occupancy Rate</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>{isPlanningRole && activeGroundPlotSummary.total > 0 ? Math.round((activeGroundPlotSummary.occupied / activeGroundPlotSummary.total) * 100) : (!isPlanningRole && lucenaGraveData.length > 0 ? Math.round((occupiedGraveCount / lucenaGraveData.length) * 100) : 0)}%</div>
                  <div style={{ fontSize: 12, color: 'var(--amber)' }}>Capacity usage</div>
                </div>
              </div>

              <div style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
                <input 
                  type="text" 
                  placeholder="Search by Plot ID or Occupant Name…" 
                  style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }} 
                  value={recordSearch}
                  onChange={(e) => { setRecordSearch(e.target.value); setGravePage(1); }}
                />
                {isPlanningRole && <>
                  <select className="admin-select" value={activePlanningCemetery} onChange={(e) => { setActivePlanningCemetery(e.target.value); setPlotSectionFilter('all'); setGravePage(1); }}>
                    {cemeteries.map(cemetery => <option key={cemetery.id} value={cemetery.code}>{cemetery.name}</option>)}
                    {cemeteries.length === 0 && <><option value="old">Lucena Old Public Cemetery</option><option value="new">Lucena New Public Cemetery</option></>}
                  </select>
                  <select className="admin-select" value={plotSectionFilter} onChange={(e) => { setPlotSectionFilter(e.target.value); setGravePage(1); }}>
                    <option value="all">All Sections</option>
                    {groundPlotSectionOptions.map(section => <option key={section} value={section}>{section}</option>)}
                  </select>
                  <select className="admin-select" value={plotStatusFilter} onChange={(e) => { setPlotStatusFilter(e.target.value); setGravePage(1); }}>
                    <option value="all">All Statuses</option><option value="available">Available</option><option value="occupied">Occupied</option><option value="maintenance">Maintenance</option>
                  </select>
                </>}
              </div>
              {plotDataError && isPlanningRole && <div style={{ marginBottom: 16, color: 'var(--red)', fontSize: 12 }}>{plotDataError}</div>}
              
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Plot ID</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{isPlanningRole ? 'Cemetery' : 'Occupant Name'}</th>
                    <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{isPlanningRole ? 'Section' : 'Location'}</th>
                    <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{isPlanningRole ? 'Description' : 'Dates'}</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody> 
                  {paginatedGraveRecords.length > 0 ? paginatedGraveRecords.map((grave) => (
                    <tr key={grave.id || grave.grave_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{grave.plot_id || grave.grave_id}</td>
                      <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>{isPlanningRole ? (grave.cemetery_name || '—') : (grave.name || '—')}</td>
                      <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>{isPlanningRole ? (grave.section_name || grave.section || '—') : (grave.location || '—')}</td>
                      <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>{isPlanningRole ? (grave.location_description || '—') : (grave.dates || '—')}</td>
                        <td style={{ padding: '14px' }}>
                          <span style={{
                            fontSize: 11,
                            padding: '4px 8px',
                          background: grave.status === 'occupied' ? 'rgba(239,68,68,.2)' : grave.status === 'maintenance' ? 'rgba(245,158,11,.2)' : 'rgba(16,185,129,.2)',
                          color: grave.status === 'occupied' ? 'var(--red)' : grave.status === 'maintenance' ? 'var(--amber)' : 'var(--emerald)',
                            borderRadius: '4px',
                            fontWeight: 600
                          }}>
                          <span aria-hidden="true" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', marginRight: 5, verticalAlign: 'middle' }} />
                          {grave.status.charAt(0).toUpperCase() + grave.status.slice(1)}
                          </span>
                        </td>
                        <td style={{ padding: '14px', textAlign: 'right' }}>
                         <button className="btn btn-xs btn-ghost" onClick={() => {
                           const targetPanel = isPlanningRole ? 'panel-planning' : 'panel-admin-map';
                           setSelectedPanel(targetPanel);
                            schedulePassiveTimeout(() => {
                              if (isPlanningRole) {
                                const renderedPlot = buildSavedSectionPlotFeatures(cemeterySections, groundPlots).features
                                  .find(feature => String(feature.properties.id) === String(grave.id));
                                const target = renderedPlot?.properties?.rendered_center || (grave.latitude != null && grave.longitude != null ? [grave.latitude, grave.longitude] : null);
                                if (target) safeFlyToMap(planningMapRef.current, target, 21);
                              }
                              if (isStaffRole) safeFlyToMap(adminMapRef.current, grave.latlng, 21);
                            }, 0);
                          }}>View on Map</button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>No records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalGravePages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Showing page {gravePage} of {totalGravePages}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-ghost" disabled={gravePage === 1} onClick={() => setGravePage(p => p - 1)}>Previous</button>
                    <button className="btn btn-sm btn-primary" disabled={gravePage === totalGravePages} onClick={() => setGravePage(p => p + 1)}>Next Page</button>
                  </div>
                </div>
              )}
            </div>
            </>}
          </div>

          {isPlanningRole && (
          <div className={`panel ${selectedPanel === 'panel-planning' ? 'active' : ''}`} id="panel-planning">
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <div id="planning-map" ref={planningMapContainer} style={{ width: '100%', height: '100%' }} />
              {cemeterySectionsError && (
                <div className="map-fab planning-error-fab" style={{ maxWidth: 320, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: 'var(--amber)', fontSize: 12, lineHeight: 1.5, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                  <div>{cemeterySectionsError}</div>
                  <button type="button" className="btn btn-xs btn-ghost" style={{ marginTop: 8 }} onClick={() => setPlanningReloadToken(value => value + 1)}>Retry loading map</button>
                </div>
              )}
              {(!planningOverlaysReady || planningMapRenderState !== 'ready') && <MapLoadingOverlay cemetery={activePlanningCemetery} error={cemeterySectionsError || (planningMapRenderState === 'error' ? 'The map layers could not be drawn. Please retry.' : '')} onRetry={() => setPlanningReloadToken(value => value + 1)} />}
              
              <div className="map-fab planning-capacity-fab" style={{ minWidth: collapsedPlanningPanels.capacity ? 0 : 260, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: collapsedPlanningPanels.capacity ? 0 : 4 }}>Zoning & Capacity</div>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => togglePlanningPanel('capacity')} aria-label={`${collapsedPlanningPanels.capacity ? 'Expand' : 'Minimize'} Zoning and Capacity`} aria-expanded={!collapsedPlanningPanels.capacity}>{collapsedPlanningPanels.capacity ? '+' : '\u2212'}</button>
                </div>
                {!collapsedPlanningPanels.capacity && <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Lucena City Public Cemetery</div>
                <div className="planning-map-legend" aria-label="Grave status colors">
                  {[
                    [PLANNING_PLOT_COLORS.available, 'Available'],
                    [PLANNING_PLOT_COLORS.occupied, 'Occupied'],
                    [PLANNING_PLOT_COLORS.maintenance, 'Maintenance'],
                    [UNKNOWN_PLOT_COLOR, 'Unlinked'],
                  ].map(([color, label]) => (
                    <span key={label} title={label === 'Unlinked' ? 'Map position without a linked status record' : label}>
                      <i style={{ background: color }} aria-hidden="true" />{label}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                   <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                         <span style={{ color: 'var(--text-secondary)' }}>Stack positions</span>
                         <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{planningStacks.length.toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Vertical columns containing the niches below</div>
                   </div>
                   <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                         <span style={{ color: 'var(--text-secondary)' }}>Occupied / total niches</span>
                         <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{planningNicheCounts.occupied.toLocaleString()} / {planningNicheCounts.total.toLocaleString()}</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,.05)', borderRadius: 3, overflow: 'hidden' }}>
                         <div style={{ height: '100%', background: 'var(--amber)', width: `${planningNicheCounts.total > 0 ? (planningNicheCounts.occupied/planningNicheCounts.total)*100 : 0}%` }} />
                      </div>
                   </div>
                </div>
                </>}
              </div>
              <div className="cemetery-switcher-container">
                <button className={`btn ${activePlanningCemetery === 'old' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setActivePlanningCemetery('old'); if (planningMapRef.current) planningMapRef.current.flyTo(CEMETERY_CENTER, 19, { animate: true, duration: 0.8 }); }}>Old Map</button>
                <button className={`btn ${activePlanningCemetery === 'new' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setActivePlanningCemetery('new'); if (planningMapRef.current) planningMapRef.current.flyTo(ANOTHER_CEMETERY_CENTER, 19, { animate: true, duration: 0.8 }); }}>New Map</button>
              </div>
              <div className="map-fab planning-draw-fab" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,.14)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: collapsedPlanningPanels.tools ? 0 : 8 }}>
                  <strong style={{ fontSize: 12 }}>Drawing Tools</strong>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => togglePlanningPanel('tools')} aria-label={`${collapsedPlanningPanels.tools ? 'Expand' : 'Minimize'} Drawing Tools`} aria-expanded={!collapsedPlanningPanels.tools}>{collapsedPlanningPanels.tools ? '+' : '\u2212'}</button>
                </div>
                {!collapsedPlanningPanels.tools && <>
                {isSectionMethodOpen ? (
                  <>
                    <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700 }}>Choose how to draw the section</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button className="btn btn-primary" onClick={() => selectSectionMethod('map')}>Draw on Map</button>
                      <button className="btn btn-ghost" onClick={() => selectSectionMethod('coordinates')}>Enter Coordinates</button>
                      <button className="btn btn-ghost" onClick={() => setIsSectionMethodOpen(false)}>Cancel</button>
                    </div>
                  </>
                ) : isDrawingMode ? (
                  <>
                    <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700 }}>{drawPointCount} point{drawPointCount === 1 ? '' : 's'} added</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button className="btn btn-ghost" onClick={undoSectionPoint} disabled={drawPointCount === 0}>Undo Point</button>
                      <button className="btn btn-primary" onClick={finishSectionDrawing} disabled={drawPointCount < 3}>Finish Section</button>
                      <button className="btn btn-ghost" onClick={cancelSectionDrawing}>Cancel</button>
                    </div>
                    <div style={{ maxWidth: 300, marginTop: 7, fontSize: 10, color: 'var(--text-muted)' }}>Click as many boundary points as needed, then press Finish Section.</div>
                  </>
                ) : isDrawingPathway ? (
                  <>
                    <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700 }}>{pathwayPointCount} point{pathwayPointCount === 1 ? '' : 's'} added</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button className="btn btn-ghost" onClick={undoPathwayPoint} disabled={pathwayPointCount === 0}>Undo Point</button>
                      <button className="btn btn-primary" onClick={finishPathwayDrawing} disabled={pathwayPointCount < 2}>Finish Pathway</button>
                      <button className="btn btn-ghost" onClick={cancelPathwayDrawing}>Cancel</button>
                    </div>
                    <div style={{ maxWidth: 300, marginTop: 7, fontSize: 10, color: 'var(--text-muted)' }}>Click along the route in order. At least two points are required.</div>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={chooseSectionMethod}>+ Draw Section</button>
                    <button className="btn btn-ghost" onClick={activatePathwayDrawing}>+ Draw Pathway</button>
                  </div>
                )}
                {!isSectionMethodOpen && !isDrawingMode && !isDrawingPathway && <div style={{ maxWidth: 260, marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>Targets the selected {activePlanningCemetery === 'new' ? 'New' : 'Old'} Cemetery.</div>}
                </>}
              </div>
              <div ref={zonesPanelRef} className="map-fab planning-zones-fab" style={{ width: collapsedPlanningPanels.zones ? 'auto' : 310, maxHeight: 'calc(100% - 160px)', overflowY: collapsedPlanningPanels.zones ? 'visible' : 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <div><div style={{ fontSize: 14, fontWeight: 800 }}>Zones</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{zonesSidebarSections.length} sections</div></div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {!collapsedPlanningPanels.zones && <button className="btn btn-xs btn-primary" onClick={chooseSectionMethod} disabled={isDrawingMode}>+ New Zone</button>}
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => togglePlanningPanel('zones')} aria-label={`${collapsedPlanningPanels.zones ? 'Expand' : 'Minimize'} Zones`} aria-expanded={!collapsedPlanningPanels.zones}>{collapsedPlanningPanels.zones ? '+' : '\u2212'}</button>
                  </div>
                </div>
                {!collapsedPlanningPanels.zones && <>
                <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => setPlotManagerTarget({ cemetery: activePlanningCemetery })}>Manage Individual Plots & Niches</button>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  <span style={{ display: 'block', marginBottom: 4, fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Find zoning item</span>
                  <input
                    type="search"
                    className="admin-select"
                    value={planningSearchQuery}
                    onChange={(event) => setPlanningSearchQuery(event.target.value)}
                    placeholder="Section, zone code, or pathway name"
                    aria-label="Search CPDO sections and pathways"
                  />
                </label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <select className="admin-select" style={{ flex: 1 }} value={plotSectionFilter} onChange={(e) => setPlotSectionFilter(e.target.value)}><option value="all">All Zones</option>{zonesSidebarSections.map(zone => <option key={zone.id} value={zone.properties?.name}>{zone.properties?.zone_code || zone.properties?.name} {'\u2014'} {zone.properties?.name}</option>)}</select>
                  <select className="admin-select" style={{ flex: 1 }} value={plotStatusFilter} onChange={(e) => setPlotStatusFilter(e.target.value)}><option value="all">All Statuses</option><option value="available">Available</option><option value="occupied">Occupied</option><option value="maintenance">Maintenance</option></select>
                </div>
                {filteredPlanningZones.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{planningSearchTerm ? 'No matching sections.' : 'No sections configured for this cemetery.'}</div>}
                <div style={{ display: 'grid', gap: 8 }}>{filteredPlanningZones.map(zone => { const props = zone.properties || {}; const capacity = planningSectionCounts.get(normalizeSectionName(props.name)); const statusLabel = zone.isLegacySidebar ? 'Existing' : props.status === 'planned' ? 'Planning' : props.status === 'maintenance' ? 'Maintenance' : 'Active'; const isSelected = selectedZoneName === normalizeSectionName(props.name); return <div id={getZoneSidebarId(props.name)} key={zone.id || props.id} style={{ padding: 10, border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: isSelected ? 'rgba(22,135,201,.12)' : 'transparent', boxShadow: isSelected ? '0 0 0 2px rgba(22,135,201,.15)' : 'none', transition: 'background .2s, border-color .2s, box-shadow .2s' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong style={{ fontSize: 12 }}>{props.zone_code || 'No code'} {'\u2014'} {props.name}</strong><span style={{ fontSize: 9, textTransform: 'uppercase', color: getSavedSectionStatusColor(props.status), fontWeight: 800 }}>{statusLabel}</span></div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5 }}>{(capacity?.stacks || 0).toLocaleString()} stack positions {'\u00B7'} {(capacity?.niche.total || 0).toLocaleString()} individual niches</div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{capacity?.niche.occupied || 0} occupied niches {'\u00B7'} {capacity?.niche.available || 0} available niches</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}><button className="btn btn-xs btn-ghost" onClick={() => { revealZoneInSidebar(props.name); setPlotSectionFilter(props.name); if (zone.geometry && Object.keys(zone.geometry).length) planningMapRef.current?.fitBounds(L.geoJSON(zone).getBounds(), { padding: [30, 30] }); }}>View</button><button className="btn btn-xs btn-primary" onClick={() => zone.isLegacySidebar ? openLegacyZoneModal(props.name, activePlanningCemetery) : openEditZoneModal(zone)}>Manage Section</button><button type="button" className="btn btn-xs btn-ghost" onClick={() => setPlotManagerTarget({ cemetery: activePlanningCemetery, section: props.name })}>Manage Plots / Niches</button>{!zone.isLegacySidebar && <button className="btn btn-xs btn-ghost" onClick={() => archiveZone(zone)}>Archive</button>}</div></div>; })}</div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><strong style={{ fontSize: 12 }}>Pathways</strong><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pathwaysSidebarItems.length} routes</span></div>
                  {filteredPlanningPathways.length === 0 && planningSearchTerm && <div style={{ padding: '6px 0', color: 'var(--text-muted)', fontSize: 11 }}>No matching pathways.</div>}
                  <div style={{ display: 'grid', gap: 6 }}>{filteredPlanningPathways.map(pathway => { const pathwayKey = String(pathway.id || pathway.properties?.id); const isSelected = selectedPathwayKey === pathwayKey; return <div id={getPathwaySidebarId(pathwayKey)} key={pathwayKey} style={{ padding: 8, border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, background: isSelected ? 'rgba(22,135,201,.12)' : 'transparent', boxShadow: isSelected ? '0 0 0 2px rgba(22,135,201,.15)' : 'none', transition: 'background .2s, border-color .2s, box-shadow .2s' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><div style={{ fontSize: 11, fontWeight: 700 }}>{pathway.properties?.name}</div><div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{pathway.isLegacyPathway ? 'Existing' : pathway.properties?.pathway_type} {'\u00B7'} {pathway.properties?.width_meters} m</div></div></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}><button className="btn btn-xs btn-ghost" onClick={() => { revealPathwayInSidebar(pathwayKey); planningMapRef.current?.fitBounds(L.geoJSON(pathway).getBounds(), { padding: [40, 40] }); }}>View</button><button className="btn btn-xs btn-primary" onClick={() => openEditPathwayModal(pathway)}>Manage Pathway</button>{!pathway.isLegacyPathway && <button className="btn btn-xs btn-ghost" onClick={() => archivePathway(pathway)}>Archive</button>}</div></div>; })}</div>
                </div>
                </>}
              </div>
            </div>
          </div>
          )}
          <div className={`panel admin-settings-page ${selectedPanel === 'panel-settings' ? 'active' : ''}`} id="panel-settings">
            <div className="scroll-panel">
              <div className="page-hdr"><div><div className="page-title">Settings</div><div className="page-sub">System preferences and controls</div></div></div>
              <div className="admin-settings-content">
                <section className="admin-settings-card" aria-labelledby="office-settings-cemetery">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-cemetery">Cemetery Information</h2><p>Manage the office name and cemetery location.</p></div></div>
                  <div className="admin-settings-fields">
                    <label className="admin-settings-field"><span>Cemetery Name</span><input type="text" defaultValue="City Cemetery Management Office" /></label>
                    <label className="admin-settings-field"><span>Location</span><input type="text" defaultValue="14.4793, 120.8978" /></label>
                  </div>
                </section>
                <section className="admin-settings-card" aria-labelledby="office-settings-notifications">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-notifications">Notifications</h2><p>Choose which office updates to receive.</p></div></div>
                  <div className="admin-settings-rows">
                    <label className="admin-settings-row"><span><strong>Email notifications</strong><small>Receive office updates through email.</small></span><input type="checkbox" defaultChecked /></label>
                    <label className="admin-settings-row"><span><strong>Application alerts</strong><small>Stay informed about burial application activity.</small></span><input type="checkbox" defaultChecked /></label>
                    <label className="admin-settings-row"><span><strong>System alerts</strong><small>Receive important system notices.</small></span><input type="checkbox" defaultChecked /></label>
                  </div>
                </section>
                <section className="admin-settings-card" aria-labelledby="office-settings-accessibility">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-accessibility">Accessibility</h2><p>Adjust text size for easier reading.</p></div></div>
                  <div className="admin-settings-rows">
                    <label className="admin-settings-row"><span><strong>Standard</strong><small>Bata / Default</small></span><input type="radio" name="admin-font-size" checked={uiScale === 'standard'} onChange={() => setUiScale('standard')} /></label>
                    <label className="admin-settings-row"><span><strong>Medium</strong><small>Adult</small></span><input type="radio" name="admin-font-size" checked={uiScale === 'medium'} onChange={() => setUiScale('medium')} /></label>
                    <label className="admin-settings-row"><span><strong>Large</strong><small>Matanda / Elderly</small></span><input type="radio" name="admin-font-size" checked={uiScale === 'large'} onChange={() => setUiScale('large')} /></label>
                  </div>
                </section>
                <section className="admin-settings-card" aria-labelledby="office-settings-appearance">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-appearance">Appearance</h2><p>Set how GraveTrak looks and behaves on this device.</p></div></div>
                  <div className="admin-settings-rows">
                    <label className="admin-settings-row"><span><strong>High Contrast / Color Blind Mode</strong><small>Increase contrast for interface elements.</small></span><input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} /></label>
                    <label className="admin-settings-row"><span><strong>Dark mode</strong><small>Use the dark appearance.</small></span><input type="checkbox" defaultChecked /></label>
                    <label className="admin-settings-row"><span><strong>Show map tooltips</strong><small>Display additional information on the map.</small></span><input type="checkbox" defaultChecked /></label>
                    <label className="admin-settings-row"><span><strong>Offline cache</strong><small>Keep selected data available on this device.</small></span><input type="checkbox" /></label>
                  </div>
                </section>
                <section className="admin-settings-card" aria-labelledby="office-settings-access">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-access">Access Control</h2><p>Manage administrative tools and local system data.</p></div></div>
                  <div className="admin-settings-actions-list">
                    <button className="btn btn-ghost" onClick={() => showToast('Manage user roles opening...', 'info')}>Manage user roles</button>
                    <button className="btn btn-ghost" onClick={() => showToast('API keys management opening...', 'info')}>API keys</button>
                    <button className="btn btn-ghost" onClick={() => { const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]'); setAuditLogs(logs); setIsAuditLogsModalOpen(true); }}>Audit logs</button>
                    <button className="btn btn-ghost admin-settings-export" onClick={handleExportMasterCSV}>Export Master System Data (CSV)</button>
                    <button className="btn btn-ghost admin-settings-reset" onClick={() => {
                      showConfirm('Reset System Data', 'Are you sure you want to clear all locally saved Columbarium and Auto-Assign data? This will reset the map to its clean state.', () => {
                        localStorage.removeItem('gravetrak_columbarium');
                        localStorage.removeItem('gravetrak_assigned_apps');
                        localStorage.removeItem('gravetrak_cleared_records');
                        localStorage.removeItem('gravetrak_cancelled_notifs');
                        localStorage.removeItem('gravetrak_archived_reports');
                        localStorage.removeItem('gravetrak_archived_cancelled_apps');
                        window.location.reload();
                      });
                    }}>Reset Local System Data</button>
                  </div>
                </section>
                <div className="admin-settings-save-actions"><button className="btn btn-primary" onClick={() => showToast('Settings saved.')}>Save Changes</button><button className="btn btn-ghost" onClick={() => showToast('Changes cancelled.', 'info')}>Cancel</button></div>
                <section className="admin-settings-card admin-settings-account" aria-labelledby="office-settings-account">
                  <div className="admin-settings-card-heading"><div><h2 id="office-settings-account">Account</h2><p>Sign out of the Mayor’s Office on this device.</p></div></div>
                  <button className="btn btn-ghost admin-settings-logout" onClick={() => { showConfirm('Logout', 'Are you sure you want to sign out?', onLogout); }}>Logout / Sign Out</button>
                </section>
              </div>
            </div>
          </div>
          {isCoordinateModalOpen && (
            <div className="modal-overlay open" onClick={() => setIsCoordinateModalOpen(false)}>
              <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Section by Coordinates</div>
                  <button className="modal-close" onClick={() => setIsCoordinateModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <p style={{ marginTop: 0, fontSize: 12, color: 'var(--text-muted)' }}>Enter four corners in order around the boundary (clockwise or counterclockwise). Paste each Google Earth coordinate below; decimal latitude/longitude will fill automatically. Cemetery: {activePlanningCemetery === 'new' ? 'New' : 'Old'} Map.</p>
                  {sectionCorners.map((corner, index) => (
                    <div key={index} style={{ marginBottom: 14 }}>
                      <strong style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Corner {index + 1}</strong>
                      <input type="text" aria-label={`Corner ${index + 1} Google Earth coordinates`} placeholder={'Paste: 13°56\'17.94"N 121°37\'15.08"E'} value={corner.pasted || ''} onChange={e => {
                        const pasted = e.target.value;
                        const parsed = parseGoogleEarthCoordinatePair(pasted);
                        setSectionCorners(current => current.map((item, i) => i === index ? { ...item, pasted, lat: parsed?.lat || '', lng: parsed?.lng || '' } : item));
                      }} style={{ width: '100%', padding: '9px 11px', marginBottom: 7, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <input type="number" step="any" aria-label={`Corner ${index + 1} latitude`} placeholder="Latitude" value={corner.lat} onChange={e => setSectionCorners(current => current.map((item, i) => i === index ? { ...item, pasted: '', lat: e.target.value } : item))} style={{ width: '100%', padding: '9px 11px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} />
                        <input type="number" step="any" aria-label={`Corner ${index + 1} longitude`} placeholder="Longitude" value={corner.lng} onChange={e => setSectionCorners(current => current.map((item, i) => i === index ? { ...item, pasted: '', lng: e.target.value } : item))} style={{ width: '100%', padding: '9px 11px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                    <button className="btn btn-ghost" onClick={() => setIsCoordinateModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={previewCoordinateSection}>Draw & Continue</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* New Section Modal */}
          {isNewSectionModalOpen && (
            <div className="modal-overlay open cpdo-section-overlay" onClick={() => !isSavingSection && (editingZone ? setIsNewSectionModalOpen(false) : cancelSectionDrawing())}>
              <div className="modal cpdo-section-modal" role="dialog" aria-modal="true" aria-labelledby="cpdo-section-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title" id="cpdo-section-title">{editingZone ? 'Edit Zone' : 'New Cemetery Zone'}</div>
                  <button className="modal-close" aria-label="Close section form" disabled={isSavingSection} onClick={() => editingZone ? setIsNewSectionModalOpen(false) : cancelSectionDrawing()}>{'\u00D7'}</button>
                </div>
                <div className="modal-body">
                <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(22,135,201,.08)', border: '1px solid rgba(22,135,201,.2)', borderRadius: 'var(--radius)', fontSize: 12 }}><strong>Cemetery:</strong> {cemeteries.find(cemetery => cemetery.code === activePlanningCemetery)?.name || (activePlanningCemetery === 'new' ? 'Lucena New Public Cemetery' : 'Lucena Old Public Cemetery')}<br/><span style={{ color: 'var(--text-muted)' }}>The drawn section is locked to the currently selected map.</span></div>
                  {sectionFormError && <div role="alert" style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 'var(--radius)', color: 'var(--red)', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', fontSize: 12 }}>{sectionFormError}</div>}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Zone Name</label>
                    <input
                      type="text"
                      value={newSectionData.name}
                      onChange={(e) => setNewSectionData({ ...newSectionData, name: e.target.value })}
                      maxLength={50}
                      placeholder="e.g., Section X, Expansion Area 1"
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Zone Code</label>
                    <input type="text" value={newSectionData.zone_code} onChange={(e) => { setNewSectionData({ ...newSectionData, zone_code: e.target.value }); setSectionFormError(''); }} placeholder="e.g., OLD-A" style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Description</label>
                    <textarea value={newSectionData.description} onChange={(e) => setNewSectionData({ ...newSectionData, description: e.target.value })} rows="3" placeholder="Administrative description (optional)" style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', resize: 'vertical' }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Status</label>
                    <select
                      value={newSectionData.status}
                      onChange={(e) => setNewSectionData({ ...newSectionData, status: e.target.value })}
                      style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    >
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, color: 'var(--text-primary)' }}><input type="checkbox" checked={newSectionData.is_active} onChange={(e) => setNewSectionData({ ...newSectionData, is_active: e.target.checked })} /> Active zoning area</label>
                  <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800 }}>Grave Layout</div>
                  {editingZone && <div style={{ marginBottom: 12, padding: '9px 11px', background: editingZone.hasProtectedPlots ? 'rgba(245,158,11,.1)' : 'rgba(14,165,233,.08)', border: `1px solid ${editingZone.hasProtectedPlots ? 'rgba(245,158,11,.3)' : 'rgba(14,165,233,.25)'}`, borderRadius: 'var(--radius)', fontSize: 11 }}>
                    {editingZone.hasProtectedPlots ? 'This section contains occupied or assigned graves. You may change floors, description, status, and active state; boundary, rows, columns, and orientation are locked for record safety.' : 'You may resize the boundary and change the rows, columns, levels, or orientation.'}
                    <div style={{ marginTop: 8 }}><button type="button" className="btn btn-xs btn-ghost" disabled={editingZone.hasProtectedPlots || isSavingSection} onClick={redrawSectionBoundary}>Redraw Boundary</button></div>
                  </div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 10 }}>
                    <div><label htmlFor="section-layout-rows" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Rows / sides</label><select id="section-layout-rows" className="admin-select" disabled={editingZone?.hasProtectedPlots} value={newSectionData.rows} onChange={e => setNewSectionData({ ...newSectionData, rows: Number(e.target.value) })} style={{ width: '100%' }}><option value="1">1 row — Front only</option><option value="2">2 rows — Front and back</option></select></div>
                    <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Columns</label><input type="number" min="1" max="132" disabled={editingZone?.hasProtectedPlots} value={newSectionData.columns} onChange={e => setNewSectionData({ ...newSectionData, columns: e.target.value })} style={{ width: '100%', padding: '9px 11px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }}/></div>
                    <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Levels per column</label><input type="number" min="1" max="10" value={newSectionData.estimated_stack_height} onChange={e => setNewSectionData({ ...newSectionData, estimated_stack_height: e.target.value })} style={{ width: '100%', padding: '9px 11px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }}/></div>
                    <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Orientation</label><select className="admin-select" disabled={editingZone?.hasProtectedPlots} value={newSectionData.orientation} onChange={e => setNewSectionData({ ...newSectionData, orientation: e.target.value })} style={{ width: '100%' }}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></div>
                  </div>
                  <SectionLayoutPreview rows={newSectionData.rows} columns={newSectionData.columns} floors={newSectionData.estimated_stack_height} />
                </div>
                  <div className="cpdo-section-footer">
                    <button className="btn btn-ghost" disabled={isSavingSection} onClick={() => editingZone ? setIsNewSectionModalOpen(false) : cancelSectionDrawing()}>Cancel</button>
                    <button className="btn btn-primary" disabled={isSavingSection} onClick={handleSaveNewSection}>{isSavingSection ? 'Saving\u2026' : editingZone ? 'Save Changes' : 'Save Section'}</button>
                  </div>
              </div>
            </div>
          )}

          {/* Confirmed grave layout generation — never runs automatically when a section is created. */}
          {isPathwayModalOpen && (
            <div className="modal-overlay open" onClick={cancelPathwayDrawing}>
              <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header"><div className="modal-title">{editingPathway ? 'Manage Cemetery Pathway' : 'New Cemetery Pathway'}</div><button className="modal-close" onClick={cancelPathwayDrawing}>{'\u00D7'}</button></div>
                <div className="modal-body">
                  <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(14,165,233,.08)', border: '1px solid rgba(14,165,233,.25)', borderRadius: 'var(--radius)', fontSize: 12 }}><strong>Cemetery:</strong> {cemeteries.find(cemetery => cemetery.code === activePlanningCemetery)?.name}<br/><span style={{ color: 'var(--text-muted)' }}>The route will be saved and shown on cemetery maps.</span></div>
                  <div style={{ marginBottom: 14 }}><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Pathway Name</label><input value={newPathwayData.name} onChange={e => setNewPathwayData({ ...newPathwayData, name: e.target.value })} placeholder="e.g., Main Entrance Walkway" style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }}/></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Type</label><select className="admin-select" value={newPathwayData.pathway_type} onChange={e => setNewPathwayData({ ...newPathwayData, pathway_type: e.target.value })} style={{ width: '100%' }}><option value="walkway">Walkway</option><option value="road">Road</option><option value="access">Access Path</option></select></div>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Width (meters)</label><input type="number" min="0.5" max="30" step="0.5" value={newPathwayData.width_meters} onChange={e => setNewPathwayData({ ...newPathwayData, width_meters: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }}/></div>
                  </div>
                  <div style={{ marginBottom: 16 }}><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Description</label><textarea rows="3" value={newPathwayData.description} onChange={e => setNewPathwayData({ ...newPathwayData, description: e.target.value })} placeholder="Optional notes" style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', resize: 'vertical' }}/></div>
                  {editingPathway && <div style={{ marginBottom: 16, padding: '9px 11px', background: 'rgba(14,165,233,.08)', border: '1px solid rgba(14,165,233,.25)', borderRadius: 'var(--radius)', fontSize: 11 }}>To change where the pathway passes, redraw its route point by point.<div style={{ marginTop: 8 }}><button type="button" className="btn btn-xs btn-ghost" disabled={isSavingPathway} onClick={redrawPathway}>Redraw Route</button></div></div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn btn-ghost" disabled={isSavingPathway} onClick={cancelPathwayDrawing}>Cancel</button><button className="btn btn-primary" disabled={isSavingPathway} onClick={savePathway}>{isSavingPathway ? 'Saving\u2026' : editingPathway ? 'Save Changes' : 'Save Pathway'}</button></div>
                </div>
              </div>
            </div>
          )}

          {isGraveLayoutModalOpen && layoutZone && (
            <div className="modal-overlay open" onClick={() => !isGeneratingGraveLayout && setIsGraveLayoutModalOpen(false)}>
              <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Manage Graves — {layoutZone.properties?.name}</div>
                  <button className="modal-close" disabled={isGeneratingGraveLayout} onClick={() => setIsGraveLayoutModalOpen(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ padding: 12, marginBottom: 18, borderRadius: 'var(--radius)', border: '1px solid rgba(22,135,201,.25)', background: 'rgba(22,135,201,.08)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                    {Number(layoutZone.properties?.total_plots || 0) > 0 ? 'Update the existing unused grave layout. Occupied or assigned layouts are protected from regeneration.' : 'Configure a grid preview inside the saved section polygon. Only grave center points inside the polygon will be saved.'} No burial application will be assigned.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Rows</label><input type="number" min="1" max="50" value={graveLayoutData.rows} onChange={e => setGraveLayoutData({ ...graveLayoutData, rows: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} /></div>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Columns</label><input type="number" min="1" max="50" value={graveLayoutData.columns} onChange={e => setGraveLayoutData({ ...graveLayoutData, columns: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} /></div>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Floors / Grave</label><input type="number" min="1" max="10" value={graveLayoutData.floors} onChange={e => setGraveLayoutData({ ...graveLayoutData, floors: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)' }} /></div>
                    <div><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Layout Direction</label><select className="admin-select" value={graveLayoutData.orientation} onChange={e => setGraveLayoutData({ ...graveLayoutData, orientation: e.target.value })} style={{ width: '100%' }}><option value="horizontal">Horizontal division</option><option value="vertical">Vertical division</option></select></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
                    <div style={{ padding: 14, borderRadius: 'var(--radius)', background: 'rgba(255,255,255,.035)', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>Graves inside polygon</div><strong style={{ fontSize: 24, color: 'var(--emerald)' }}>{graveLayoutPreviewCount}</strong></div>
                    <div style={{ padding: 14, borderRadius: 'var(--radius)', background: 'rgba(255,255,255,.035)', border: '1px solid var(--border)' }}><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>Total floor capacity</div><strong style={{ fontSize: 24, color: 'var(--accent)' }}>{graveLayoutPreviewCount * (Number(graveLayoutData.floors) || 0)}</strong></div>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>Individual grave IDs, coordinates, orientation, and available status will be persisted in the database.</div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                    <button className="btn btn-ghost" disabled={isGeneratingGraveLayout} onClick={() => setIsGraveLayoutModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" disabled={isGeneratingGraveLayout || graveLayoutPreviewCount < 1} onClick={handleGenerateGraveLayout}>{isGeneratingGraveLayout ? 'Saving…' : `${Number(layoutZone.properties?.total_plots || 0) > 0 ? 'Update' : 'Confirm'} ${graveLayoutPreviewCount} Graves`}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View Support Message Modal */}
          {viewSupportMsg && (
            <div className="modal-overlay open" style={{ zIndex: 100000 }} onClick={() => setViewSupportMsg(null)}>
              <div className="modal" style={{ maxWidth: '500px', width: '95%' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>✉️ Contact Support</div>
                  <button className="modal-close" onClick={() => setViewSupportMsg(null)}>×</button>
                </div>
                <div className="modal-body">
                  <div style={{ padding: 16, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <div style={{ marginBottom: 4 }}><strong>From:</strong> {viewSupportMsg.user}</div>
                    <div style={{ marginBottom: 4 }}><strong>Date:</strong> {viewSupportMsg.date}</div>
                    {viewSupportMsg.appId && <div><strong>Regarding:</strong> {viewSupportMsg.appId} - {viewSupportMsg.deceased}</div>}
                    {viewSupportMsg.currentLocation && <div style={{ marginTop: 4 }}><strong>Current Location:</strong> <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{viewSupportMsg.currentLocation}</span></div>}
                  </div>
                  <div style={{ padding: 16, background: 'rgba(0,0,0,.15)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-line', lineHeight: 1.6, minHeight: '80px' }}>
                    {viewSupportMsg.message}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Reply to {viewSupportMsg.user}</label>
                    <textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder="Type your response here..."
                      style={{ width: '100%', minHeight: '100px', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(0,0,0,.2)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical', outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={() => setViewSupportMsg(null)}>Close</button>
                    <button className="btn btn-ghost" style={{ color: 'var(--emerald)', border: '1px solid var(--emerald)' }} onClick={() => { 
                      const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                      const updatedMsgs = msgs.map(m => m.id === viewSupportMsg.id ? { ...m, resolved: true } : m);
                      localStorage.setItem('gravetrak_support_messages', JSON.stringify(updatedMsgs));
                      setSupportMessages(updatedMsgs.filter(m => !m.resolved));
                      const evt = new Event('storage'); evt.key = 'gravetrak_support_messages'; window.dispatchEvent(evt);
                      setViewSupportMsg(null); 
                      showToast('Message resolved without reply.'); 
                    }}>Resolve (No Reply)</button>
                    {viewSupportMsg.message && viewSupportMsg.message.includes('TRANSFER PLOT REQUEST') && (
                      <button className="btn btn-primary" style={{ background: 'var(--emerald)', borderColor: 'var(--emerald)' }} onClick={() => {
                        showConfirm('Approve & Execute Transfer', `Are you sure you want to approve the plot transfer for ${viewSupportMsg.deceased}? If they are currently assigned to a plot or columbarium, this will automatically clear their record and free up the slot.`, () => {
                          
                          // 1. Clear from Columbarium
                          let foundCol = false;
                          const newColSlots = columbariumSlots.map(s => {
                            if (s.status === 'occupied' && s.name && s.name.toLowerCase().includes(viewSupportMsg.deceased.toLowerCase())) {
                              foundCol = true;
                              const newCleared = [{
                                id: Date.now(),
                                slotId: s.id,
                                name: s.name,
                                note: `Automatically cleared via Plot Transfer (${viewSupportMsg.appId})`
                              }, ...clearedRecords].slice(0, 10);
                              setClearedRecords(newCleared);
                              localStorage.setItem('gravetrak_cleared_records', JSON.stringify(newCleared));
                              return { ...s, status: 'available', name: '' };
                            }
                            return s;
                          });
                          if (foundCol) setColumbariumSlots(newColSlots);
                          
                          // 2. Clear from Graves
                          let foundGrave = false;
                          const newGraves = graveData.map(g => {
                            if (g.status === 'occupied' && g.name && g.name.toLowerCase() === viewSupportMsg.deceased.toLowerCase()) {
                              foundGrave = true;
                              const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
                              fetch(`${API_BASE}/graves/${g.id}/`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` },
                                body: JSON.stringify({ status: 'available', name: '', dates: '' })
                              }).catch(() => {});
                              return { ...g, status: 'available', name: '', dates: '' };
                            }
                            return g;
                          });
                          if (foundGrave) setGraveData(newGraves);

                          // 3. Resolve Request
                          const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                          const updatedMsgs = msgs.map(m => m.id === viewSupportMsg.id ? { ...m, resolved: true } : m);
                          localStorage.setItem('gravetrak_support_messages', JSON.stringify(updatedMsgs));
                          setSupportMessages(updatedMsgs.filter(m => !m.resolved));
                          const evt = new Event('storage'); evt.key = 'gravetrak_support_messages'; window.dispatchEvent(evt);
                          
                          // 4. Notify User
                          const replies = JSON.parse(localStorage.getItem('gravetrak_support_replies') || '[]');
                          replies.unshift({
                            id: Date.now(),
                            date: new Date().toLocaleString(),
                            admin: currentRoleInfo?.name || roleInfo[role]?.name || "Mayor's Office",
                            message: `Your transfer request for ${viewSupportMsg.deceased} has been officially APPROVED and processed. ${foundCol || foundGrave ? 'Their previous plot has been successfully cleared.' : 'Please proceed to the office for the next steps.'}`
                          });
                          localStorage.setItem('gravetrak_support_replies', JSON.stringify(replies));
                          let evtReply = new Event('storage'); evtReply.key = 'gravetrak_support_replies'; window.dispatchEvent(evtReply);

                          // 5. Audit Log
                          const userName = currentRoleInfo?.name || roleInfo[role]?.name || 'Admin';
                          const logs = JSON.parse(localStorage.getItem('gravetrak_audit_logs') || '[]');
                          logs.unshift({
                            id: Date.now(),
                            date: new Date().toLocaleString(),
                            user: userName,
                            action: 'Approved Transfer Plot Request',
                            details: `Approved transfer for ${viewSupportMsg.deceased}. ${foundCol || foundGrave ? 'Automatically cleared old slot.' : ''}`
                          });
                          localStorage.setItem('gravetrak_audit_logs', JSON.stringify(logs));

                          setViewSupportMsg(null);
                          showToast(`Request approved! ${foundCol || foundGrave ? 'Existing plot automatically cleared.' : 'User notified.'}`);
                        }, false);
                      }}>Approve & Execute Transfer</button>
                    )}
                    <button className="btn btn-primary" onClick={() => { 
                      if (!replyMessage.trim()) {
                        showToast('Please type a reply first.', 'error');
                        return;
                      }
                      const replies = JSON.parse(localStorage.getItem('gravetrak_support_replies') || '[]');
                      replies.unshift({
                        id: Date.now(),
                        date: new Date().toLocaleString(),
                        admin: currentRoleInfo?.name || roleInfo[role]?.name || "Mayor's Office",
                        message: replyMessage.trim()
                      });
                      localStorage.setItem('gravetrak_support_replies', JSON.stringify(replies));
                      let evt = new Event('storage'); evt.key = 'gravetrak_support_replies'; window.dispatchEvent(evt);
                      
                      const msgs = JSON.parse(localStorage.getItem('gravetrak_support_messages') || '[]');
                      const updatedMsgs = msgs.map(m => m.id === viewSupportMsg.id ? { ...m, resolved: true } : m);
                      localStorage.setItem('gravetrak_support_messages', JSON.stringify(updatedMsgs));
                      setSupportMessages(updatedMsgs.filter(m => !m.resolved));
                      evt = new Event('storage'); evt.key = 'gravetrak_support_messages'; window.dispatchEvent(evt);
                      
                      setViewSupportMsg(null); setReplyMessage('');
                      showToast('Reply sent successfully to user.'); 
                    }}>Send Reply</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LegacyAdminWorkspace;
