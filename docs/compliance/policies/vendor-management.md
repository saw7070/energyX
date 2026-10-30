# Vendor Management Policy

**Owner:** Operations lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly · **Maps to:** CC9.2

## Onboarding

1. **Tier the vendor.** High: has customer data or production access. Medium: has internal data. Low: neither.
2. **Due diligence for High and Medium vendors:**
   - an assurance report (SOC 2 Type II or ISO 27001) or a security questionnaire
   - a DPA
   - where the data is processed
   - its own sub-processors
   - its breach-notice terms
3. **Approval.** The Operations lead approves, and the DPO too if personal data is involved. Add the vendor to the register.
4. **Customer notice.** A new sub-processor of customer personal data needs 30 days' notice to customers (DPA).

## Register (initial)

| Vendor | Purpose | Data | Location | Tier |
|---|---|---|---|---|
| Alibaba Cloud (ECS, OSS) | Hosting, backups | All customer data | Singapore (confirm the OSS region) | High |
| Tuya IoT cloud | Meter data | Readings, device IDs | [per customer account] | High |
| DeepSeek | LLM | Questions, energy figures, site details | [confirm; may be outside SG] | High |
| Alibaba Model Studio (DashScope) | LLM | As above | International endpoint by default (Phase 1) | High |
| OpenAI-compatible providers (configured) | LLM | As above | Varies by provider | High |
| [SMTP provider] | Email | Names, emails, reports | [ ] | Medium |
| GitHub | Code, CI | No customer data | US | Medium |

## AI model providers

- **Business or API terms only,** with no training on customer data. Record how long each provider keeps prompts.
- **Region.** Record the processing region for each endpoint and prefer Singapore or regional ones. Cross-border transfers must meet the PDPA Transfer Limitation Obligation and be disclosed in the privacy policy.
- **Customer control.** Customers are told which provider they use, and can switch AI off or cap it (`apps/api/src/energy/energy-ai-governance.ts`).
- **Never send** credentials or account details.
- **Re-review** whenever a provider changes its terms, region or model family.

## Ongoing

- Review High-tier vendors every year: refresh their reports and check their incidents and our CUECs.
- Review Medium-tier vendors every 2 years.
- At offboarding, revoke credentials and confirm data deletion.
