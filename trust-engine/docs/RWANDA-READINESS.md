# AFT Rwanda Production-Readiness and Regulatory Scope

**Prepared:** 24 November 2026  
**Product scope:** B2B verification infrastructure only  
**Initial market:** Rwanda  
**Expansion:** Other African jurisdictions only after a country-by-country assessment

## Decision boundary

AFT should initially operate as independent B2B verification infrastructure. It may collect and organize business identity, invoice, transaction, delivery and counterparty evidence and return provenance-rich verification records to authorized business and institutional users.

For the initial Rwanda launch, AFT should not hold customer funds, provide payment accounts, initiate or settle payments, lend, finance invoices, make binding credit decisions, issue a credit score, operate as a credit bureau, provide investment advice, perform securities activity, or represent that a Trust Record is a regulatory credit report. These boundaries reduce regulatory ambiguity, but they do not replace a written legal classification from qualified Rwanda counsel and the relevant authority.

The current product already states that AFT is not a lender, bank or credit-rating agency and uses deterministic evidence evaluation rather than an AI credit score. That positioning must become an enforceable product, contract and marketing control, not only interface copy.

## Vision preserved through staged regulation

This boundary is the starting phase, not the product ceiling. The intended AFT platform has three connected pillars: trust infrastructure, financial intelligence and financial connectivity. The roadmap includes financial-data collection from invoices, contracts, delivery records, bank and mobile-money transactions, accounting systems and ERPs; fraud and anomaly detection; cash-flow and payment-behaviour analysis; institutional risk intelligence; APIs for banks, lenders and insurers; and longer-term trade-finance workflows such as receivables financing, factoring and supplier finance.

Those capabilities can be developed in stages without pretending that they are already live or that a current Trust Record is a regulatory credit decision. Early intelligence outputs should be evidence-based, explainable and explicitly advisory. Before AFT uses them to make or materially influence lending, insurance underwriting, investment, credit-rating or payment decisions, the relevant Rwanda classification must be revisited. The same applies if AFT starts collecting regulated credit-reporting data, connecting to live financial accounts, or facilitating financing between businesses and institutions.

The engineering plan should therefore separate the evidence layer from the intelligence layer and from regulated financial workflows. Evidence provenance, consent, purpose limitation, access controls and auditability must flow through all three layers. Country expansion later will require repeating this classification for each jurisdiction rather than assuming that a Rwanda conclusion applies across Africa.

## Rwanda regulatory path

The National Bank of Rwanda's regulatory sandbox is for innovative financial products or services within BNR's licensing scope. BNR states that applicants must show genuine innovation, be in scope, and be ready to test and deploy with adequate product, human and financial resources. Applications are rolling, complete-file evaluation is expected within three months, and an approved test is generally limited to 12 months. [1]

Because AFT's initial scope is intended to be verification infrastructure rather than a payment, lending or funds-holding service, AFT should first obtain a written classification or no-objection view from Rwanda counsel and, where counsel recommends it, engage BNR before describing the product as regulated, approved or certified. If AFT later becomes a credit bureau, Rwanda's credit-reporting regulation becomes directly relevant: it requires a BNR licence, at least FRW 100 million paid-up capital, an application package, an IT audit by a BNR-approved firm, pre-opening clearance and Rwanda data hosting requirements. [2]

If AFT adds capital-markets credit ratings, investment, crowdfunding, securities or wealth-management functionality, the CMA pathway becomes relevant. CMA's fintech sandbox expressly covers credit ratings, RegTech/SupTech and other securities-market activities. That is a separate scope from the initial verification-infrastructure model. [3]

## Data protection gate

Rwanda's Data Protection and Privacy Law applies to personal data processing. The Rwanda Data Protection Office states that organizations processing personal data of individuals residing in Rwanda must register with the supervisory authority as data controllers or processors. The controller/processor role depends on who determines the purposes, data categories and means of processing. AFT may be a controller for purposes and means it determines itself and a processor for processing performed on a customer's instructions. [4]

Before real customer data is loaded, AFT needs a documented data map and role analysis for each product flow. It also needs registration with the Rwanda supervisory authority where required, privacy notices, controller/processor contracts, a data-processing inventory, access and correction procedures, retention rules, breach response, cross-border transfer analysis and a data-residency decision. The current application does not yet implement these controls completely.

## Current readiness assessment

The existing Trust Engine is a strong functional pilot, not a certified production financial-institution system. It has real authentication, tenant isolation, deterministic evidence processing, audit and Trust Record hash chains, API scope enforcement, reports, tests and deployment. It is not yet ready for real regulated-data onboarding because the current deployment still has published demo credentials, no MFA, no password reset or email verification, no malware scanning, in-memory rate limiting, no tested backup restore, no retention/erasure workflow, no field-level read audit, no independent penetration test and no confirmed Rwanda data-residency arrangement.

The current hosted database is managed TiDB in the Manus environment. Its exact data location, backup retention, point-in-time recovery, subprocessors and contractual data-protection terms must be confirmed before Rwanda production use. Do not infer Rwanda residency from the business country field.

## Non-negotiable launch gates

AFT should not onboard real Rwanda financial evidence until all of the following are complete:

1. A Rwanda legal opinion or written regulator engagement classifies the initial service and confirms that AFT is not conducting credit-bureau, payment, lending, banking or capital-markets activity under the proposed scope.
2. AFT's Rwandan legal entity, ownership, responsible officers and contracts are in place.
3. The data-controller/data-processor analysis is complete and required DPO/NCSA registration is filed or confirmed.
4. A privacy notice, terms, customer data-processing agreement, subprocessor schedule, retention schedule and breach-response procedure are approved.
5. All demo accounts and the published demo password are removed or replaced; administrator MFA, email verification and password reset are operational.
6. Production secrets are unique and managed; database backup/PITR settings are confirmed and a restore drill succeeds.
7. Upload malware scanning, provider-host allowlisting, distributed rate limiting, security logging and alerting are operational.
8. An independent security assessment and penetration test are completed, with critical and high findings closed or formally accepted.
9. A country-specific risk assessment, access-control matrix, incident-response plan and business-continuity/disaster-recovery test are approved.
10. A regulator/customer-facing statement clearly says AFT provides evidence verification infrastructure and does not itself certify a business as creditworthy or guarantee payment.

## Implementation sequence

### Stage 0 — scope lock

Freeze the product boundary in code, terms and marketing. Add explicit restrictions preventing users from labeling a Trust Record as a credit score, approval, guarantee or regulatory certificate. Create a decision log for any future feature that could trigger BNR, CMA or credit-bureau classification.

### Stage 1 — identity and governance

Create an organization onboarding and invitation flow rather than public open registration. Add verified work email, administrator approval, MFA for privileged roles, password reset, session/device management and administrator review of new grants. Record consent, terms version and privacy-notice version in the audit trail.

### Stage 2 — Rwanda data-protection controls

Create a data inventory and processing-activity records. Add retention policies, legal holds, export/access requests, correction requests, deletion/anonymization workflows and breach-event records. Add explicit country and transfer metadata for each document and person record. Confirm hosting and subprocessors contractually before production data entry.

### Stage 3 — technical hardening

Add malware scanning and quarantine for uploads, SSRF-safe provider configuration, centralized rate limiting, immutable security logs, alerting, backup verification, restore automation and stale-job recovery. Add browser E2E, dependency vulnerability scanning, load testing and independent penetration testing.

### Stage 4 — controlled pilot

Use synthetic data first, then a small number of contractually approved Rwanda businesses under written pilot terms. Do not expose the product as a licensed credit bureau or financial institution. Establish incident, support, access-review and audit-review routines, then obtain the regulator/counsel view before expanding functionality.

### Stage 5 — country expansion

For each additional African country, repeat the classification, data-protection, residency, outsourcing, licensing, consumer-protection, tax and incident-reporting assessment. Do not reuse Rwanda's legal conclusion automatically.

## Immediate next build priorities

The first engineering tranche should be: remove public demo access from the production environment; add invitation-only onboarding; add email verification, password reset and MFA; add consent and policy-version records; add data-retention and subject-request workflows; add malware scanning/quarantine; replace in-memory rate limiting; and add a production backup/restore verification job.

These controls should be implemented in a separate production-hardening checkpoint and tested against the real application before any customer onboarding. The current public demo should remain clearly labeled as a synthetic evaluation environment until those gates are met.

## References

[1]: https://www.bnr.rw/regulatorysandbox "National Bank of Rwanda Regulatory Sandbox"
[2]: https://rwandalii.org/akn/rw/act/reg/2019/27 "Rwanda Regulation relating to Credit Reporting System"
[3]: https://www.cma.rw/fintech-innovations/fintech-regulatory-sandbox/overview "Rwanda Capital Market Authority Fintech Regulatory Sandbox"
[4]: https://dpo.gov.rw/guidance/data-controllers/determining-your-role-are-you-a-data-controller-or-data-processor "Rwanda Data Protection Office controller and processor guidance"
