import { LegacyAdminWorkspace } from '../legacy/LegacyAdminWorkspace.jsx';
import CPDOVerification from './CPDOVerification.jsx';
import CPDOReports from './CPDOReports.jsx';

/** CPDO module: zoning, cemetery expansion planning, plot verification and analytics. */
export default function CPDOOffice(props) {
  void CPDOVerification;
  void CPDOReports;
  return <LegacyAdminWorkspace {...props} role="planning" />;
}
