import { LegacyAdminWorkspace } from '../legacy/LegacyAdminWorkspace.jsx';
import MayorReports from './MayorReports.jsx';
import MayorApprovals from './MayorApprovals.jsx';

/** Mayor module: executive analytics, application approvals, user oversight and reports. */
export default function MayorOffice(props) {
  void MayorReports;
  void MayorApprovals;
  return <LegacyAdminWorkspace {...props} role="mayor" />;
}
