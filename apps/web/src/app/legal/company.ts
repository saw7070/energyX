/**
 * The company details every legal page uses. Fill these in once; until then the pages show each blank highlighted,
 * so nothing goes out half-finished by accident. Have a lawyer review the documents before customers rely on them.
 */
export const COMPANY = {
  /** Registered company name, e.g. "EnergyX Pte. Ltd." */
  name: "",
  /** Company registration number (UEN in Singapore, SSM number in Malaysia). */
  registration: "",
  /** Registered address. */
  address: "",
  /** Country whose law governs the standard terms: where the contracting company is registered. */
  governingCountry: "",
  /** General and privacy contact. */
  contactEmail: "",
  /** Data Protection Officer contact (required under Singapore's PDPA). */
  dpoEmail: "",
  /** Where security issues are reported. */
  securityEmail: "",
  /** Support channel for customers. */
  supportEmail: "",
  /** Alibaba Cloud region the service runs in, e.g. "Malaysia (Kuala Lumpur)". */
  hostingRegion: "",
  /** Date these documents take effect. */
  effectiveDate: "",
};

export type CompanyField = keyof typeof COMPANY;

export const COMPANY_LABELS: Record<CompanyField, string> = {
  name: "Company name",
  registration: "Registration number",
  address: "Registered address",
  governingCountry: "Singapore or Malaysia",
  contactEmail: "Contact email",
  dpoEmail: "Data Protection Officer email",
  securityEmail: "Security contact email",
  supportEmail: "Support email",
  hostingRegion: "Hosting region",
  effectiveDate: "Effective date",
};
