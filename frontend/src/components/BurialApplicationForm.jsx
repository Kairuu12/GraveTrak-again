import { REQUIRED_DOCUMENTS, DOCUMENT_ACCEPT, MAX_DOCUMENT_SIZE_MB } from '../data/burialRequirements.js';
import { useEffect, useMemo, useState } from 'react';
import { submitBurialApplication } from '../api.js';
import CustomDatePicker from './CustomDatePicker.jsx';



const FUNERAL_HOMES = [
  'Alaala Funeral Homes',
  'St. Jude Funeral Homes',
  'New Funeraria Pagbilao',
  'Funeraria Constantino',
  'Abela Funeral Homes',
  'Others',
];

const isValidAge = value => /^\d{1,3}$/.test(value) && Number(value) <= 130;
const EDUCATIONAL_ATTAINMENT_OPTIONS = [
  'No Formal Education',
  'Elementary Level',
  'Elementary Graduate',
  'Junior High School Level',
  'Junior High School Graduate',
  'Senior High School Level',
  'Senior High School Graduate',
  'Vocational / Technical',
  'College Level',
  'College Graduate',
  'Postgraduate',
  'Other / Not Listed',
];
const OCCUPATION_OPTIONS = [
  'Employed (Private Sector)',
  'Government Employee',
  'Self-Employed',
  'Business Owner',
  'Overseas Filipino Worker',
  'Daily-Wage Worker / Laborer',
  'Farmer / Fisherfolk',
  'Student',
  'Homemaker',
  'Unemployed',
  'Retired',
  'Other / Not Listed',
];
const MONTHLY_INCOME_OPTIONS = [
  'No Income',
  'Below ₱10,000',
  '₱10,000–₱19,999',
  '₱20,000–₱29,999',
  '₱30,000–₱49,999',
  '₱50,000–₱99,999',
  '₱100,000 and above',
  'Prefer not to disclose',
];

export default function BurialApplicationForm({ active, userInfo, onSuccess }) {
  const [step, setStep] = useState(0);
  const [clientName, setClientName] = useState('');
  const [clientAge, setClientAge] = useState('');
  const [clientGender, setClientGender] = useState('');
  const [clientCivilStatus, setClientCivilStatus] = useState('');
  const [clientEducation, setClientEducation] = useState('');
  const [clientOccupation, setClientOccupation] = useState('');
  const [clientIncome, setClientIncome] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [deceasedFirstName, setDeceasedFirstName] = useState('');
  const [deceasedLastName, setDeceasedLastName] = useState('');
  const [deceasedMI, setDeceasedMI] = useState('');
  const [deceasedSuffix, setDeceasedSuffix] = useState('');
  const [deceasedDateOfBirth, setDeceasedDateOfBirth] = useState('');
  const [placeOfBirth, setPlaceOfBirth] = useState('');
  const [deceasedDateOfDeath, setDeceasedDateOfDeath] = useState('');
  const [deceasedAge, setDeceasedAge] = useState('');
  const [deceasedGender, setDeceasedGender] = useState('M');
  const [applicantRelationship, setApplicantRelationship] = useState('other');
  const [applicantBarangay, setApplicantBarangay] = useState('');
  const [applicantStreet, setApplicantStreet] = useState('');
  const [funeralHomeSelection, setFuneralHomeSelection] = useState('');
  const [funeralHomeOther, setFuneralHomeOther] = useState('');
  const [barangays, setBarangays] = useState([]);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [files, setFiles] = useState({
    funeral_contract: null,
    death_certificate: null,
    deceased_valid_id: null,
    indigency: null,
    list_permit: null,
    valid_id: null,
  });
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const missingDocuments = useMemo(
    () => REQUIRED_DOCUMENTS.filter((doc) => !files[doc.key]),
    [files]
  );

  useEffect(() => {
    const profileName = userInfo?.name || [userInfo?.first_name, userInfo?.last_name].filter(Boolean).join(' ');
    if (profileName && !clientName) setClientName(profileName);
  }, [userInfo, clientName]);

  useEffect(() => {
    if (deceasedDateOfBirth) {
      const birthDate = new Date(deceasedDateOfBirth);
      const endDate = deceasedDateOfDeath ? new Date(deceasedDateOfDeath) : new Date();
      
      let age = endDate.getFullYear() - birthDate.getFullYear();
      const m = endDate.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && endDate.getDate() < birthDate.getDate())) {
        age--;
      }
      
      if (age >= 0) {
        setDeceasedAge(age.toString());
      }
    }
  }, [deceasedDateOfBirth, deceasedDateOfDeath]);

  useEffect(() => {
    // Fetch Barangays of Lucena City directly (City Code: 045624000)
    fetch('https://psgc.gitlab.io/api/cities-municipalities/045624000/barangays/')
      .then(res => res.json())
      .then(data => setBarangays(data.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(err => console.error('Failed to fetch barangays:', err));
  }, []);

  const stepOneValid =
    (clientName || '').trim().length > 0 &&
    isValidAge(clientAge) &&
    clientGender && clientCivilStatus &&
    (clientEducation || '').trim().length > 0 &&
    (clientOccupation || '').trim().length > 0 &&
    (clientIncome || '').trim().length > 0 &&
    (clientAddress || '').trim().length > 0 &&
    (deceasedFirstName || '').trim().length > 0 &&
    (deceasedLastName || '').trim().length > 0 &&
    (deceasedDateOfBirth || '').trim().length > 0 &&
    (placeOfBirth || '').trim().length > 0 &&
    (deceasedDateOfDeath || '').trim().length > 0 &&
    (deceasedGender || '').trim().length > 0 &&
    (applicantRelationship || '').trim().length > 0 &&
    (funeralHomeSelection || '').trim().length > 0 &&
    (funeralHomeSelection !== 'Others' || (funeralHomeOther || '').trim().length > 0) &&
    (applicantBarangay);
  const canSubmit = stepOneValid && missingDocuments.length === 0;

  const handleFileChange = (key, event) => {
    const file = event.target.files?.[0] || null;
    if (file && file.size > MAX_DOCUMENT_SIZE_MB * 1024 * 1024) {
      setError(`The file selected for ${REQUIRED_DOCUMENTS.find(d => d.key === key)?.label || 'this document'} exceeds the ${MAX_DOCUMENT_SIZE_MB}MB limit.`);
      event.target.value = '';
      setFiles((current) => ({ ...current, [key]: null }));
      return;
    }
    setFiles((current) => ({ ...current, [key]: file }));
    setError('');
  };

  const scrollToTop = () => {
    const scrollOpts = { top: 0, behavior: 'smooth' };
    window.scrollTo(scrollOpts);
    document.querySelector('.pub-page')?.scrollTo(scrollOpts);
    document.getElementById('screen-public')?.scrollTo(scrollOpts);
  };

  const handleContinue = () => {
    if (!(clientName || '').trim()) {
      setInvalidField('clientName'); setError('Name of Client is required before continuing.'); scrollToTop(); return;
    }
    if (!isValidAge(clientAge)) {
      setInvalidField('clientAge'); setError('Enter a valid client age from 0 to 130.'); scrollToTop(); return;
    }
    const invalidFamilyAge = familyMembers.findIndex(member => member.age !== '' && !isValidAge(member.age));
    if (invalidFamilyAge !== -1) {
      setInvalidField(`familyAge-${invalidFamilyAge}`); setError(`Enter a whole-number age from 0 to 130 for Family Member ${invalidFamilyAge + 1}, or leave it blank.`); scrollToTop(); return;
    }
    if (!clientGender || !clientCivilStatus || !(clientEducation || '').trim() || !(clientOccupation || '').trim() || !(clientIncome || '').trim() || !(clientAddress || '').trim()) {
      const missing = !clientGender ? 'clientGender' : !clientCivilStatus ? 'clientCivilStatus' : !(clientEducation || '').trim() ? 'clientEducation' : !(clientOccupation || '').trim() ? 'clientOccupation' : !(clientIncome || '').trim() ? 'clientIncome' : 'clientAddress';
      setInvalidField(missing); setError('Please complete all required Client / Applicant Information fields.'); scrollToTop(); return;
    }
    if (!(deceasedFirstName || '').trim() || !(deceasedLastName || '').trim()) {
      setInvalidField(!(deceasedFirstName || '').trim() ? 'firstName' : 'lastName');
      setError('The first and last name of the deceased are required before continuing.');
      scrollToTop();
      return;
    }
    if (!(deceasedDateOfDeath || '').trim()) {
      setInvalidField('dateOfDeath');
      setError('The date of death is required before continuing.');
      scrollToTop();
      return;
    }
    if (!(deceasedDateOfBirth || '').trim()) {
      setInvalidField('dateOfBirth');
      setError('The date of birth is required to automatically calculate the age.');
      scrollToTop();
      return;
    }
    if (!(placeOfBirth || '').trim()) {
      setInvalidField('placeOfBirth');
      setError('Place of birth is required before continuing.');
      scrollToTop();
      return;
    }
    if (!deceasedGender) {
      setInvalidField('gender');
      setError('Please select the deceased’s gender.');
      scrollToTop();
      return;
    }
    if (!applicantRelationship) {
      setInvalidField('relationship');
      setError('Please select your relationship to the deceased.');
      scrollToTop();
      return;
    }
    if (!funeralHomeSelection) {
      setInvalidField('funeralHome');
      setError('Please select a funeral home.');
      scrollToTop();
      return;
    }
    if (funeralHomeSelection === 'Others' && !(funeralHomeOther || '').trim()) {
      setInvalidField('funeralHomeOther');
      setError('Please specify the funeral home name.');
      scrollToTop();
      return;
    }
    if (!applicantBarangay) {
      setInvalidField('barangay');
      setError('Please select a Barangay in Lucena City.');
      scrollToTop();
      return;
    }
    setError('');
    setInvalidField('');
    setStep(2);
    scrollToTop();
  };

  const handleBack = () => {
    setError('');
    setStep(1);
    scrollToTop();
  };

  const addFamilyMember = () => setFamilyMembers(current => [...current, { name: '', age: '', sex: '', civil_status: '', educational_attainment: '', occupation: '', income: '', relationship: '' }]);
  const updateFamilyMember = (index, field, value) => setFamilyMembers(current => current.map((member, memberIndex) => memberIndex === index ? { ...member, [field]: value } : member));
  const removeFamilyMember = index => setFamilyMembers(current => current.filter((_, memberIndex) => memberIndex !== index));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      const formData = new FormData();
      const fullName = `${deceasedFirstName.trim()} ${deceasedMI.trim() ? deceasedMI.trim() + ' ' : ''}${deceasedLastName.trim()}${deceasedSuffix.trim() ? ' ' + deceasedSuffix.trim() : ''}`.replace(/\s+/g, ' ').trim();
      
      let finalAge = deceasedAge.toString().trim();
      if (deceasedDateOfBirth) {
        const bDate = new Date(deceasedDateOfBirth);
        const eDate = deceasedDateOfDeath ? new Date(deceasedDateOfDeath) : new Date();
        let age = eDate.getFullYear() - bDate.getFullYear();
        const m = eDate.getMonth() - bDate.getMonth();
        if (m < 0 || (m === 0 && eDate.getDate() < bDate.getDate())) {
          age--;
        }
        if (!isNaN(age) && age >= 0) finalAge = age.toString();
      }

      formData.append('deceased_name', fullName);
      if (deceasedDateOfBirth) {
        formData.append('deceased_date_of_birth', deceasedDateOfBirth);
      }
      formData.append('deceased_date_of_death', deceasedDateOfDeath);
      formData.append('place_of_birth', placeOfBirth.trim());
      if (finalAge !== '') {
        formData.append('deceased_age', finalAge);
      }
      formData.append('deceased_gender', deceasedGender);
      formData.append('funeral_home', funeralHomeSelection === 'Others' ? funeralHomeOther.trim() : funeralHomeSelection);

      const finalApplicantName = clientName.trim();
      const finalApplicantEmail = userInfo?.email || 'no-reply@gravetrak.gov.ph';
      const finalApplicantPhone = userInfo?.contact_number || 'N/A';

      formData.append('applicant_name', finalApplicantName);
      formData.append('applicant_relationship', applicantRelationship);
      formData.append('applicant_contact_email', finalApplicantEmail);
      formData.append('applicant_contact_phone', finalApplicantPhone);
      formData.append('client_age', clientAge);
      formData.append('client_gender', clientGender);
      formData.append('client_civil_status', clientCivilStatus);
      formData.append('client_educational_attainment', clientEducation.trim());
      formData.append('client_occupation', clientOccupation.trim());
      formData.append('client_income', clientIncome.trim());
      formData.append('client_address', clientAddress.trim());
      formData.append('family_members', JSON.stringify(
        familyMembers
          .filter(member => member.name.trim())
          .map(member => ({ ...member, age: member.age === '' ? null : Number(member.age) }))
      ));
      
      const finalAddress = `${applicantStreet.trim() ? applicantStreet.trim() + ', ' : ''}${applicantBarangay}, Lucena City, Quezon, Philippines`;
      formData.append('applicant_address', finalAddress);
      
      REQUIRED_DOCUMENTS.forEach((doc) => {
        const file = files[doc.key];
        if (file) {
          formData.append(doc.key, file);
        }
      });

      await submitBurialApplication(formData);
      setShowConfirmModal(false);
      setStep(0);
      setClientName(''); setClientAge(''); setClientGender(''); setClientCivilStatus('');
      setClientEducation(''); setClientOccupation(''); setClientIncome(''); setClientAddress('');
      setFamilyMembers([]);
      setDeceasedFirstName('');
      setDeceasedLastName('');
      setDeceasedMI('');
      setDeceasedSuffix('');
      setDeceasedDateOfBirth('');
      setPlaceOfBirth('');
      setDeceasedDateOfDeath('');
      setDeceasedAge('');
      setDeceasedGender('M');
      setApplicantRelationship('other');
      setApplicantBarangay('');
      setApplicantStreet('');
      setFuneralHomeSelection('');
      setFuneralHomeOther('');
      setFiles({
        funeral_contract: null,
        death_certificate: null,
        deceased_valid_id: null,
        indigency: null,
        list_permit: null,
        valid_id: null,
      });

      if (onSuccess) {
        onSuccess();
      } else {
        setSuccess('Your burial application has been submitted successfully. A cemetery officer will review it shortly.');
      }
    } catch (err) {
      setShowConfirmModal(false);
      setError(err.message || 'Unable to submit the application at this time.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`burial-application ${active ? '' : 'hidden'}`}>
      <div className="application-card">
        <div className="application-header">
          <div>
            <div className="application-brand">GraveTrak Cemetery Management System</div>
            <div className="application-title">Burial Application</div>
            <div className="application-subtitle">Submit a protected burial request with required documentation.</div>
          </div>
        </div>

        {step > 0 && (
          <div className="application-progress">
            {['Deceased Information', 'Document Upload'].map((label, index) => (
              <div key={label} className={`progress-step ${step === index + 1 ? 'active' : ''}`}>
                <div className="step-marker">{index + 1}</div>
                <div className="step-label">{label}</div>
              </div>
            ))}
          </div>
        )}

        {success ? (
          <div className="application-success">{success}</div>
        ) : null}

        {step === 0 ? (
          <div className="application-step">
            <div style={{ textAlign: 'center', marginBottom: '24px', padding: '10px 0' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>Requirements for Burial Application</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Please prepare clear photos or scanned copies (PDF, JPG, PNG) of the following documents before proceeding:</div>
            </div>
            
            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
              {REQUIRED_DOCUMENTS.map((doc, index) => (
                <div key={doc.key} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(25,135,101,0.15)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                    {index + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>{doc.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{doc.hint}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button className="btn btn-primary" type="button" onClick={() => { setStep(1); setSuccess(''); scrollToTop(); }} style={{ padding: '14px 28px', fontSize: '15px' }}>
                I have these documents, Start Application →
              </button>
            </div>
          </div>
        ) : step === 1 ? (
          <div className="application-step">
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', paddingBottom: 8, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>Client / Applicant Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="field"><label className="field-label">Name of Client</label><input className="field-input" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Enter complete name" /></div>
              <div className="field">
                <label className="field-label" htmlFor="application-client-age">Age (years)</label>
                <input id="application-client-age" className="field-input" type="number" inputMode="numeric" min="0" max="130" step="1" placeholder="e.g. 35" value={clientAge} onChange={e => { setClientAge(e.target.value); if (invalidField === 'clientAge') setInvalidField(''); }} aria-invalid={invalidField === 'clientAge'} aria-describedby="application-client-age-hint" required />
                <small id="application-client-age-hint" style={{ color: 'var(--text-muted)' }}>Enter age in completed years (0–130).</small>
              </div>
              <div className="field"><label className="field-label">Gender</label><select className="field-input" value={clientGender} onChange={e => setClientGender(e.target.value)}><option value="">Select Gender</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
              <div className="field"><label className="field-label">Civil Status</label><select className="field-input" value={clientCivilStatus} onChange={e => setClientCivilStatus(e.target.value)}><option value="">Select Civil Status</option><option value="Single">Single</option><option value="Married">Married</option><option value="Widowed">Widowed</option><option value="Separated">Separated</option><option value="Other">Other</option></select></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="field"><label className="field-label">Educational Attainment</label><select className="field-input" value={clientEducation} onChange={e => setClientEducation(e.target.value)} required><option value="">Select Educational Attainment</option>{EDUCATIONAL_ATTAINMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
              <div className="field"><label className="field-label">Occupation</label><select className="field-input" value={clientOccupation} onChange={e => setClientOccupation(e.target.value)} required><option value="">Select Occupation</option>{OCCUPATION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
              <div className="field"><label className="field-label">Monthly Income</label><select className="field-input" value={clientIncome} onChange={e => setClientIncome(e.target.value)} required><option value="">Select Monthly Income</option>{MONTHLY_INCOME_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
            </div>
            <div className="field"><label className="field-label">Client Address</label><textarea className="field-input" value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Enter complete client address" rows="2" style={{ resize: 'vertical' }} /></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', paddingBottom: 8, margin: '22px 0 14px', borderBottom: '1px solid var(--border)' }}>Deceased Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div className="field">
                <label className="field-label">First Name</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="First name"
                  value={deceasedFirstName}
                  aria-invalid={invalidField === 'firstName'}
                  style={invalidField === 'firstName' ? { borderColor: '#ef4444' } : undefined}
                  onChange={(event) => setDeceasedFirstName(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Last Name</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Last name"
                  value={deceasedLastName}
                  aria-invalid={invalidField === 'lastName'}
                  style={invalidField === 'lastName' ? { borderColor: '#ef4444' } : undefined}
                  onChange={(event) => setDeceasedLastName(event.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div className="field">
                <label className="field-label">Middle Initial (Optional)</label>
                <input
                  className="field-input"
                  type="text"
                  maxLength="5"
                  placeholder="M.I."
                  value={deceasedMI}
                  onChange={(event) => setDeceasedMI(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Suffix (Optional)</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. Jr., Sr., III"
                  value={deceasedSuffix}
                  onChange={(event) => setDeceasedSuffix(event.target.value)}
                />
              </div>
            </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div className="field">
              <label className="field-label">Date of Birth</label>
              <CustomDatePicker
                value={deceasedDateOfBirth}
                onChange={(event) => setDeceasedDateOfBirth(event.target.value)}
                placeholder="Select Date"
                maxDate="today"
                invalid={invalidField === 'dateOfBirth'}
              />
            </div>
            <div className="field">
              <label className="field-label">Place of Birth</label>
              <input
                className="field-input"
                type="text"
                placeholder="Enter city/municipality and province"
                value={placeOfBirth}
                aria-invalid={invalidField === 'placeOfBirth'}
                style={invalidField === 'placeOfBirth' ? { borderColor: '#ef4444' } : undefined}
                onChange={(event) => setPlaceOfBirth(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="field-label">Date of Death</label>
              <CustomDatePicker
                value={deceasedDateOfDeath}
                onChange={(event) => setDeceasedDateOfDeath(event.target.value)}
                placeholder="Select Date"
                maxDate="today"
                invalid={invalidField === 'dateOfDeath'}
              />
            </div>
            <div className="field">
              <label className="field-label">Gender</label>
              <select
                className="field-input"
                value={deceasedGender}
                aria-invalid={invalidField === 'gender'}
                style={invalidField === 'gender' ? { borderColor: '#ef4444' } : undefined}
                onChange={(event) => setDeceasedGender(event.target.value)}
              >
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </div>
          </div>

            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', paddingBottom: 8, margin: '22px 0 14px', borderBottom: '1px solid var(--border)' }}>Burial / Contact Information</div>
            <div className="field">
              <label className="field-label">Relationship to Deceased</label>
              <select
                className="field-input"
                value={applicantRelationship}
                aria-invalid={invalidField === 'relationship'}
                style={invalidField === 'relationship' ? { borderColor: '#ef4444' } : undefined}
                onChange={(event) => setApplicantRelationship(event.target.value)}
              >
                <option value="spouse">Spouse</option>
                <option value="child">Child</option>
                <option value="parent">Parent</option>
                <option value="sibling">Sibling</option>
                <option value="grandchild">Grandchild</option>
                <option value="relative">Other Relative</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label">Funeral Home</label>
              <select
                className="field-input"
                value={funeralHomeSelection}
                aria-invalid={invalidField === 'funeralHome'}
                style={invalidField === 'funeralHome' ? { borderColor: '#ef4444' } : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setFuneralHomeSelection(value);
                  if (value !== 'Others') setFuneralHomeOther('');
                }}
                required
              >
                <option value="">Select Funeral Home</option>
                {FUNERAL_HOMES.map((home) => <option key={home} value={home}>{home}</option>)}
              </select>
            </div>

            {funeralHomeSelection === 'Others' && (
              <div className="field" style={{ animation: 'fadeIn 180ms ease-out' }}>
                <label className="field-label">Specify Funeral Home</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Enter funeral home name"
                  value={funeralHomeOther}
                  aria-invalid={invalidField === 'funeralHomeOther'}
                  style={invalidField === 'funeralHomeOther' ? { borderColor: '#ef4444' } : undefined}
                  onChange={(event) => setFuneralHomeOther(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div className="field">
                <label className="field-label">City / Municipality</label>
                <input
                  className="field-input"
                  value="Lucena City"
                  disabled
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>

              <div className="field">
                <label className="field-label">Barangay</label>
                <select
                  className="field-input"
                  value={applicantBarangay}
                  aria-invalid={invalidField === 'barangay'}
                  style={invalidField === 'barangay' ? { borderColor: '#ef4444' } : undefined}
                  onChange={(e) => setApplicantBarangay(e.target.value)}
                >
                  <option value="">Select Barangay</option>
                  {barangays.map(b => (
                    <option key={b.code} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label className="field-label">House No. / Street (Optional)</label>
              <input
                type="text"
                className="field-input"
                placeholder="Enter house number, block, street"
                value={applicantStreet}
                onChange={(event) => setApplicantStreet(event.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 8, margin: '22px 0 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Family Composition <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>(Optional)</span></div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={addFamilyMember}>+ Add Family Member</button>
            </div>
            {familyMembers.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 12 }}>No family members added.</div>}
            <div style={{ display: 'grid', gap: 12 }}>
              {familyMembers.map((member, index) => (
                <div key={index} style={{ padding: 16, background: 'rgba(255,255,255,.025)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><strong>Family Member {index + 1}</strong><button className="btn btn-ghost btn-sm" type="button" onClick={() => removeFamilyMember(index)} style={{ color: 'var(--red)' }}>Remove</button></div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10 }}>
                    <div className="field"><label className="field-label">Name</label><input className="field-input" value={member.name} onChange={e => updateFamilyMember(index, 'name', e.target.value)} /></div>
                    <div className="field">
                      <label className="field-label" htmlFor={`application-family-age-${index}`}>Age (years)</label>
                      <input id={`application-family-age-${index}`} className="field-input" type="number" inputMode="numeric" min="0" max="130" step="1" placeholder="e.g. 25" value={member.age} onChange={e => { updateFamilyMember(index, 'age', e.target.value); if (invalidField === `familyAge-${index}`) setInvalidField(''); }} aria-invalid={invalidField === `familyAge-${index}`} aria-describedby={`application-family-age-hint-${index}`} />
                      <small id={`application-family-age-hint-${index}`} style={{ color: 'var(--text-muted)' }}>0–130 years; leave blank if unknown.</small>
                    </div>
                    <div className="field"><label className="field-label">Sex</label><select className="field-input" value={member.sex} onChange={e => updateFamilyMember(index, 'sex', e.target.value)}><option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
                    <div className="field"><label className="field-label">Civil Status</label><input className="field-input" value={member.civil_status} onChange={e => updateFamilyMember(index, 'civil_status', e.target.value)} /></div>
                    <div className="field"><label className="field-label">Educational Attainment</label><select className="field-input" value={member.educational_attainment} onChange={e => updateFamilyMember(index, 'educational_attainment', e.target.value)}><option value="">Select Educational Attainment</option>{EDUCATIONAL_ATTAINMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
                    <div className="field"><label className="field-label">Occupation</label><select className="field-input" value={member.occupation} onChange={e => updateFamilyMember(index, 'occupation', e.target.value)}><option value="">Select Occupation</option>{OCCUPATION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
                    <div className="field"><label className="field-label">Monthly Income</label><select className="field-input" value={member.income} onChange={e => updateFamilyMember(index, 'income', e.target.value)}><option value="">Select Monthly Income</option>{MONTHLY_INCOME_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
                    <div className="field"><label className="field-label">Relationship</label><input className="field-input" value={member.relationship} onChange={e => updateFamilyMember(index, 'relationship', e.target.value)} /></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="application-note">
              Required fields must be completed. The system will not allow submission until all required documents are attached.
            </div>

            {error && <div className="application-error" style={{ marginBottom: '16px' }}>{error}</div>}

            <div className="application-actions application-actions--centered">
              <button className="btn btn-ghost" type="button" onClick={() => { setStep(0); setError(''); }}>
                Back to Requirements
              </button>
              <button className="btn btn-primary" type="button" onClick={handleContinue}>
                Continue to Document Upload
              </button>
            </div>
          </div>
        ) : (
          <div className="application-step">
            <div className="uploads-grid">
              {REQUIRED_DOCUMENTS.map((doc) => (
                <label key={doc.key} className="upload-card">
                  <div className="upload-label">{doc.label}</div>
                  <div className="upload-hint">{doc.hint}</div>
                  <input
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    onChange={(event) => handleFileChange(doc.key, event)}
                  />
                  {files[doc.key] ? (
                    <div className="upload-file-name">{files[doc.key].name}</div>
                  ) : (
                    <div className="upload-placeholder">No file selected</div>
                  )}
                </label>
              ))}
            </div>

            <div className="application-note">
              Upload each required document separately. Supported file formats: PDF, JPG, JPEG, PNG.
            </div>

            {error && <div className="application-error" style={{ marginBottom: '16px' }}>{error}</div>}

            <div className="application-actions application-actions--centered">
              <button className="btn btn-ghost" type="button" onClick={handleBack} disabled={submitting}>
                Back to Details
              </button>
              <button className="btn btn-primary" type="button" onClick={() => {
                scrollToTop();
                if (!canSubmit) {
                  setError('All required documents must be uploaded before submission.');
                  return;
                }
                setShowConfirmModal(true);
              }} disabled={submitting} style={!canSubmit ? { opacity: 0.7 } : {}}>
                {submitting ? 'Submitting...' : 'Submit Burial Application'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showConfirmModal && (
        <div className="modal-overlay open" onClick={() => !submitting && setShowConfirmModal(false)} style={{ zIndex: 100000 }}>
          <div className="modal confirm-submission-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-submission-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>📝</span> Confirm Submission
              </div>
              <button className="modal-close" onClick={() => !submitting && setShowConfirmModal(false)} disabled={submitting}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
                Are you sure you want to submit this burial application for <strong>{deceasedFirstName} {deceasedLastName}</strong>? Please ensure all provided details and documents are correct.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowConfirmModal(false)} disabled={submitting}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Yes, Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
