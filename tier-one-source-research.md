# Tier-1 Evidence Source Research

## Verified trusted domains and relevant material

| Domain | Evidence focus | Source |
|---|---|---|
| `kubernetes.io` | Deployments support controlled rollouts, rollout status checks, and rollback to an earlier revision when a deployment is unstable. [1] | Kubernetes documentation |
| `sre.google` | Production changes should use staged rollouts, monitored progress, and rollback first when unexpected behavior appears. [2] | Google SRE guidance |
| `docs.stripe.com` | Webhook endpoints receive asynchronous payment events; handlers must verify signed payloads and respond quickly before complex work. [3] | Stripe documentation |
| `docs.aws.amazon.com` | Reliability guidance covers resilient architecture, consistent change management, and proven failure recovery. [4] | AWS documentation |

## Implementation decision

Evidence retrieval should first query a bounded set of Tier-1 domains tailored to the research question, then query the open web only if fewer than two usable Tier-1 sources are retained. Tier-1 sources remain subject to the same HTTPS, title, and snippet checks as every other source. The critic should check Tier-1 coverage by branch, not just across the combined source set.

## Fintech and cross-border payments additions

| Domain | Evidence focus | Source |
|---|---|---|
| `fsb.org` | The G20 cross-border payments roadmap identifies cost, speed, access, transparency, interoperability, and regulatory alignment as material cross-border payment concerns. [5] | Financial Stability Board |
| `bankofengland.co.uk` | Cross-border payments depend on interbank/correspondent-bank arrangements and face data, compliance, operating-hour, funding, and transaction-chain frictions. [6] | Bank of England |
| `ofac.treasury.gov` | A sanctions compliance program should include management commitment, risk assessment, internal controls, testing/auditing, and training. [7] | U.S. Treasury OFAC |
| `bsaaml.ffiec.gov` | Higher-risk payment activity requires a risk-based compliance program, screening controls, independent testing, accountable personnel, and supporting training. [8] | FFIEC BSA/AML Manual |

For payment, wallet, cross-border, KYC, AML, sanctions, settlement, reconciliation, or customer-funds queries, retrieval should prioritise these regulatory and payment-system domains alongside applicable engineering sources. This enriches evidence quality but does not constitute legal or regulatory advice.

## References

[1]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes — Deployments"
[2]: https://sre.google/sre-book/service-best-practices/ "Google SRE — Production Services Best Practices"
[3]: https://docs.stripe.com/webhooks "Stripe — Receive Stripe events in your webhook endpoint"
[4]: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html "AWS Well-Architected Framework — Reliability Pillar"
[5]: https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/ "Financial Stability Board — Cross-border Payments"
[6]: https://www.bankofengland.co.uk/payments/cross-border-payments "Bank of England — Cross-border payments"
[7]: https://ofac.treasury.gov/media/16331/download?inline "U.S. Treasury OFAC — A Framework for OFAC Compliance Commitments"
[8]: https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01 "FFIEC BSA/AML Manual — Office of Foreign Assets Control"
