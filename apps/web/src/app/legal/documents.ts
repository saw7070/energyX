/**
 * The legal and trust documents published under /legal. Text may use {field} for a company detail from company.ts.
 * A block is a paragraph (string) or a bulleted list (string[]). Written for customers in Singapore and Malaysia;
 * a lawyer should review them before use, and Malaysian customers should be offered the privacy notice in Bahasa
 * Malaysia as well (PDPA 2010, section 7(3)).
 */
export type LegalBlock = string | string[];
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDocument = { id: string; title: string; summary: string; sections: LegalSection[] };

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: "privacy",
    title: "Privacy policy",
    summary: "What personal data EnergyX collects, why, who it is shared with, and your rights under Singapore's and Malaysia's personal data laws.",
    sections: [
      { heading: "Who we are", blocks: [
        "EnergyX is provided by {name} ({registration}), {address} (\"we\", \"us\"). This policy explains how we handle personal data when you use EnergyX. It is written to meet Singapore's Personal Data Protection Act 2012 and Malaysia's Personal Data Protection Act 2010, as amended.",
        "When a company signs up for EnergyX, that company decides what data about its buildings and people goes into the service. For that data we act on the company's behalf, as a data intermediary (Singapore) or data processor (Malaysia), under our Data processing agreement.",
      ] },
      { heading: "What we collect", blocks: [[
        "Account details: name, email address, the organisation you belong to, and your role.",
        "Sign-in and security records: when you sign in or out, failed attempts, password changes, the IP address and browser used, and changes you make to settings (our audit history).",
        "Customer data: energy meter readings, building and equipment details, operating hours, electricity rates, uploaded files and notes, and reports.",
        "Questions you ask the energy advisor and the answers it gives.",
        "Messages you send us for support.",
      ]] },
      { heading: "Why we use it", blocks: [[
        "To provide the service: show your energy data, run analyses, produce reports and send alerts you have asked for.",
        "To keep accounts secure: verify sign-ins, prevent abuse, investigate incidents and keep an audit trail.",
        "To support you and tell you about changes to the service.",
        "To meet legal obligations.",
      ], "We do not sell personal data, and we do not use customer data to advertise."] },
      { heading: "Cookies", blocks: [
        "EnergyX uses only cookies that are needed for it to work: one keeps you signed in, one protects forms against cross-site requests. Your language and light or dark choice are stored in your browser. We use no advertising or tracking cookies, so there is nothing to opt out of.",
      ] },
      { heading: "Who we share it with", blocks: [
        "We share personal data only with service providers who help us run EnergyX, under contracts that require them to protect it:",
        [
          "Alibaba Cloud: hosting, storage and encrypted backups, in {hostingRegion}.",
          "AI model providers chosen for your organisation (for example OpenAI, DeepSeek or Alibaba Cloud Model Studio): the energy advisor sends them the question and the energy figures needed to answer it. Account details are not sent.",
          "Our email provider: to deliver invitations, password resets, alerts and reports.",
          "Tuya: when your organisation connects Tuya meters, readings are fetched from Tuya's cloud.",
        ],
        "We may also disclose data when the law requires it.",
      ] },
      { heading: "Transfers outside Singapore or Malaysia", blocks: [
        "Some providers, especially AI model providers, may process data in other countries. Where that happens we make sure the data receives protection comparable to Singapore's and Malaysia's laws, through contracts and the provider's own safeguards.",
      ] },
      { heading: "How long we keep it", blocks: [
        "We keep customer data for as long as the customer's subscription lasts, and delete it after the contract ends as described in our Terms of service. Nightly backups expire on their own: 7 days on our server and 35 days offsite. Security and audit records are kept for up to 24 months.",
      ] },
      { heading: "How we protect it", blocks: [
        "Data travels over encrypted connections (HTTPS). Passwords are stored only as Argon2 hashes, connection keys are encrypted, offsite backups are encrypted, and access inside each organisation is limited by role. See our Security overview for details.",
      ] },
      { heading: "Your rights", blocks: [
        "You can ask to see the personal data we hold about you, to correct it, to withdraw consent, or to have it deleted. Where we hold data on behalf of your organisation we will pass your request to them. Write to our Data Protection Officer at {dpoEmail}; we reply within 30 days.",
        "If you are not satisfied, you may complain to Singapore's Personal Data Protection Commission or Malaysia's Personal Data Protection Department.",
      ] },
      { heading: "Changes and contact", blocks: [
        "We will post changes here and tell account administrators about important ones. Questions: {contactEmail}. This policy takes effect on {effectiveDate}.",
      ] },
    ],
  },
  {
    id: "terms",
    title: "Terms of service",
    summary: "The agreement between your organisation and us for using EnergyX.",
    sections: [
      { heading: "The agreement", blocks: [
        "These terms are between {name} ({registration}) and the organisation that subscribes to EnergyX (the \"Customer\"). An order form or enterprise agreement signed with the Customer takes priority over these terms where they differ.",
      ] },
      { heading: "The service", blocks: [
        "EnergyX lets the Customer monitor and analyse energy use across its sites, receive reports and alerts, and ask an AI energy advisor about its data. We may improve the service over time; we will not remove a core feature the Customer pays for during its subscription without notice.",
      ] },
      { heading: "Accounts and people", blocks: [
        "The Customer chooses who gets access and with which role, keeps passwords private, and is responsible for what its users do in the service. Tell us at once at {securityEmail} if an account may have been misused.",
      ] },
      { heading: "Acceptable use", blocks: [[
        "Do not try to get into other customers' data, test our security without written permission, or disrupt the service.",
        "Do not upload unlawful content or data you have no right to share.",
        "Do not resell the service unless we have agreed it in writing.",
      ]] },
      { heading: "Customer data", blocks: [
        "The Customer owns its data. We use it only to provide, secure and support the service, as set out in the Data processing agreement. The Customer is responsible for the accuracy of the readings and settings it provides.",
      ] },
      { heading: "AI analysis and estimates", blocks: [
        "Analyses, forecasts, savings estimates and advisor answers are calculated from the data available and may be incomplete or wrong. They are guidance, not professional engineering, financial or legal advice. Check important decisions with a qualified person.",
      ] },
      { heading: "Fees", blocks: [
        "Fees, billing periods and taxes are set out in the order form. Invoices are payable within 30 days unless the order form says otherwise. We may suspend access after written notice if an invoice is more than 30 days overdue.",
      ] },
      { heading: "Service levels and support", blocks: [
        "Availability, maintenance windows, support response times and service credits are described in our Service levels.",
      ] },
      { heading: "Confidentiality", blocks: [
        "Each party keeps the other's confidential information private and uses it only for this agreement.",
      ] },
      { heading: "Ending the agreement", blocks: [
        "Either party may end the agreement at the end of a subscription term, or earlier if the other seriously breaches it and does not fix the breach within 30 days of notice. After it ends, the Customer has 30 days to ask for a copy of its data; we then delete the Customer's data from the live service within 60 days, and backups expire on their normal schedule.",
      ] },
      { heading: "Liability", blocks: [
        "Neither party is liable for indirect or consequential loss, or loss of profit. Each party's total liability under this agreement is limited to the fees paid by the Customer in the 12 months before the claim. These limits do not apply where the law does not allow them to.",
      ] },
      { heading: "Law and disputes", blocks: [
        "These terms are governed by the law of {governingCountry}, and its courts decide disputes, unless the order form chooses Singapore or Malaysia instead. The parties will first try to resolve a dispute through senior management for 30 days.",
      ] },
      { heading: "Contact", blocks: ["{contactEmail}. These terms take effect on {effectiveDate}."] },
    ],
  },
  {
    id: "data-processing",
    title: "Data processing agreement",
    summary: "How we handle personal data on your organisation's behalf, for your compliance with PDPA in Singapore and Malaysia.",
    sections: [
      { heading: "Roles", blocks: [
        "The Customer decides why and how personal data in EnergyX is used. {name} processes it only on the Customer's behalf, as a data intermediary (Singapore PDPA) or data processor (Malaysia PDPA), and only to provide the service.",
      ] },
      { heading: "Instructions", blocks: [
        "We process personal data only as the Customer instructs through its use of the service and this agreement, and tell the Customer if we believe an instruction breaks the law.",
      ] },
      { heading: "People", blocks: [
        "Only staff who need access to run or support the service can reach Customer data, and they are bound by confidentiality.",
      ] },
      { heading: "Security measures", blocks: [[
        "Encryption in transit (HTTPS) for every connection.",
        "Passwords stored as Argon2 hashes; sign-in attempts rate-limited; sessions expire.",
        "Connection keys encrypted with AES-256; offsite backups encrypted with AES-256.",
        "Each organisation's data kept separate; access limited by role; an audit history of sign-ins and changes.",
        "Nightly backups, with a 24-hour recovery point and 4-hour recovery time target.",
      ]] },
      { heading: "Sub-processors", blocks: [
        "We use Alibaba Cloud (hosting and backups), the AI model providers configured for the Customer, our email provider, and Tuya where the Customer connects Tuya meters. We will give 30 days' notice before adding a sub-processor that handles Customer personal data, and the Customer may object.",
      ] },
      { heading: "Data breaches", blocks: [
        "We tell the Customer without undue delay, and within 48 hours, after becoming aware of a breach affecting its personal data, with what we know and what we are doing, so the Customer can meet its own deadline to notify the regulator (3 days in Singapore, 72 hours in Malaysia).",
      ] },
      { heading: "Helping the Customer", blocks: [
        "We help the Customer answer requests from individuals to access or correct their data, and with security questionnaires and impact assessments, as far as reasonable.",
      ] },
      { heading: "Return and deletion", blocks: [
        "When the agreement ends we return Customer data on request within 30 days, then delete it from the live service within 60 days. Backups expire within 35 days.",
      ] },
      { heading: "Audits", blocks: [
        "We provide our Security overview and answer reasonable security questionnaires. Further audits can be agreed in writing, at the Customer's cost and with reasonable notice.",
      ] },
    ],
  },
  {
    id: "service-levels",
    title: "Service levels",
    summary: "Our uptime promise of 99.5% a month, maintenance windows, support response times and service credits.",
    sections: [
      { heading: "Availability", blocks: [
        "EnergyX will be available at least 99.5% of each calendar month, measured at the sign-in page and the service's health check. That allows about 3 hours 39 minutes of downtime a month.",
      ] },
      { heading: "What does not count", blocks: [[
        "Planned maintenance announced at least 48 hours before, outside 08:00–20:00 Singapore/Malaysia time on working days, up to 4 hours a month.",
        "Problems with the Customer's own internet, devices, or third-party systems such as meter clouds (Tuya) or AI model providers.",
        "Suspension under the Terms of service, or events outside our reasonable control.",
      ]] },
      { heading: "Service credits", blocks: [
        "If availability falls below the promise in a month, the Customer can claim a credit against the next invoice, within 30 days:",
        ["Below 99.5%: 5% of that month's fee.", "Below 99.0%: 10%.", "Below 95.0%: 25%."],
        "Credits are the Customer's only remedy for missed availability.",
      ] },
      { heading: "Support", blocks: [
        "Contact {supportEmail}. We respond within these times, counted in working hours (09:00–18:00 Singapore/Malaysia time, Monday to Friday, excluding public holidays):",
        [
          "Critical (service down for everyone): 2 hours, working on it until restored.",
          "High (a key feature not working, no workaround): 4 hours.",
          "Normal (something wrong, with a workaround): 1 working day.",
          "Questions and requests: 2 working days.",
        ],
      ] },
      { heading: "Backups and recovery", blocks: [
        "Data is backed up every night, with copies kept 7 days on our server and 35 days offsite, encrypted. If the service is lost we aim to restore it within 4 hours, losing at most the last 24 hours of changes; live meter readings for that period are fetched again where the meter cloud still holds them.",
      ] },
    ],
  },
  {
    id: "security",
    title: "Security overview",
    summary: "How EnergyX keeps customer data safe, for IT and procurement teams.",
    sections: [
      { heading: "Hosting", blocks: [
        "EnergyX runs on Alibaba Cloud in {hostingRegion}. The service sits behind a web gateway that accepts only encrypted HTTPS connections, with a certificate renewed automatically.",
      ] },
      { heading: "Encryption", blocks: [[
        "In transit: HTTPS (TLS 1.2 or later) for all traffic, with HTTP Strict Transport Security.",
        "Passwords: never stored, only Argon2id hashes.",
        "Connection keys and tokens (for example meter clouds and AI providers): encrypted with AES-256-GCM.",
        "Backups: copies sent offsite are encrypted with AES-256 before they leave the server.",
      ]] },
      { heading: "Access control", blocks: [[
        "Each customer organisation's projects, people and data are kept separate.",
        "Roles per organisation decide who can read or change reports, facility set-up, hours and rates, notes, live connections and people.",
        "Sign-in attempts are rate-limited; sessions expire, and are ended everywhere when a password changes.",
        "Only named platform administrators can manage organisations.",
      ]] },
      { heading: "Audit history", blocks: [
        "Sign-ins, failed attempts, changes to people and roles, and changes to project settings and data are recorded with who, when and from which IP address. Administrators can search the history and download it.",
      ] },
      { heading: "Application security", blocks: [[
        "Browser protections on every page: Content Security Policy, clickjacking protection, no content-type guessing, strict referrer policy.",
        "Cross-site request forgery protection on every change; cookies are HttpOnly and SameSite.",
        "The API accepts browser requests only from the EnergyX site itself.",
        "AI-generated report pages run in a locked-down sandbox.",
        "Automated tests run on every change; releases are checked before they go live and roll back on their own if checks fail.",
      ]] },
      { heading: "Backups and continuity", blocks: [
        "Nightly consistent backups with 7 days kept on the server and 35 days offsite, encrypted. Recovery point 24 hours, recovery time target 4 hours, with a restore drill every quarter.",
      ] },
      { heading: "Certifications", blocks: [
        "EnergyX does not yet hold a security certification. We are working towards Singapore's CSA Cyber Trust mark and will share our completed security questionnaire on request.",
      ] },
      { heading: "Reporting a security issue", blocks: [
        "Email {securityEmail}. We acknowledge reports within 2 working days and keep you informed until the issue is resolved.",
      ] },
    ],
  },
];
