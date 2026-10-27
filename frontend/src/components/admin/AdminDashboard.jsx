import { normalizeAppRole } from '../../data/data.js';
import MayorOffice from './mayor/MayorOffice.jsx';
import CPDOOffice from './cpdo/CPDOOffice.jsx';
import CemeteryOffice from './cemetery/CemeteryOffice.jsx';

const officeModules = {
  mayor: MayorOffice,
  planning: CPDOOffice,
  staff: CemeteryOffice,
};

/** Routes authenticated government roles to independently mounted office modules. */
export default function AdminDashboard(props) {
  const role = normalizeAppRole(props.role);
  const Office = officeModules[role];

  if (!Office) return null;
  return <Office {...props} role={role} />;
}
