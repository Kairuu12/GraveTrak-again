// Shared by the application form and the public requirements guide.
export const REQUIRED_DOCUMENTS = [
  { key: 'funeral_contract', label: 'Funeral Contract', hint: 'Upload a clear scanned copy or photo of the funeral contract.' },
  { key: 'death_certificate', label: 'Certified True Copy of Death Certificate', hint: "Upload the certified true copy of the deceased's death certificate." },
  { key: 'deceased_valid_id', label: 'Valid ID of Deceased', hint: "Upload a clear copy of the deceased's valid identification." },
  { key: 'valid_id', label: 'Valid ID of Applicant', hint: "Upload a clear copy of the applicant's valid identification." },
  { key: 'indigency', label: 'Indigency', hint: 'Upload a clear scanned copy or photo of the original indigency document/certificate.' },
  { key: 'list_permit', label: 'List Permit', hint: 'Upload the official list permit required for public cemetery burial.' },
];

export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png';
export const MAX_DOCUMENT_SIZE_MB = 10;
