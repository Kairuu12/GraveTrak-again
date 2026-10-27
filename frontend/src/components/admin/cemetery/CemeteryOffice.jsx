import { LegacyAdminWorkspace } from '../legacy/LegacyAdminWorkspace.jsx';
import BurialApplications from './BurialApplications.jsx';
import GraveManagement from './GraveManagement.jsx';
import CemeteryReports from './CemeteryReports.jsx';

/** Cemetery Office module: map operations, grave/columbarium records and reports. */
export default function CemeteryOffice(props) {
  void BurialApplications;
  void GraveManagement;
  void CemeteryReports;
  return <LegacyAdminWorkspace {...props} role="staff" />;
}
